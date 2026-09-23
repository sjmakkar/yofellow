// Phone login. Two modes, picked by the server's /api/config:
//  - Firebase (production): Firebase sends the real SMS and gives us an ID token,
//    which the server verifies. The Firebase SDK is loaded only in this mode.
//  - Dev: the server accepts code 123456 for any number (local only).
import { api, type Me } from "../api";

type FirebaseCfg = { apiKey: string; authDomain: string; projectId: string; appId?: string };
type Confirm = { confirm: (code: string) => Promise<{ user: { getIdToken: () => Promise<string> } }> };

let cfgPromise: Promise<FirebaseCfg | null> | null = null;
export function loginMode() {
  cfgPromise ??= api<{ firebase: FirebaseCfg | null }>("/config")
    .then((r) => r.firebase)
    .catch(() => null);
  return cfgPromise;
}

/** Indian numbers without a country code get +91. */
export function toE164(raw: string) {
  const p = raw.replace(/[\s()-]/g, "");
  if (p.startsWith("+")) return p;
  if (p.length === 10) return `+91${p}`;
  if (p.length === 12 && p.startsWith("91")) return `+${p}`;
  return p;
}

let pending: Confirm | null = null;
let verifier: { clear: () => void } | null = null;

/** Step 1: send the SMS. Returns a dev code when running locally. */
export async function sendCode(phone: string, recaptchaElementId: string): Promise<{ devCode?: string }> {
  const cfg = await loginMode();
  if (!cfg) return api<{ devCode?: string }>("/auth/request-otp", { body: { phone: phone.replace(/[\s-]/g, "") } });

  const [{ initializeApp, getApps }, { getAuth, RecaptchaVerifier, signInWithPhoneNumber }] = await Promise.all([
    import("firebase/app"),
    import("firebase/auth"),
  ]);
  const app = getApps()[0] || initializeApp(cfg);
  const auth = getAuth(app);
  auth.useDeviceLanguage();
  verifier?.clear();
  const v = new RecaptchaVerifier(auth, recaptchaElementId, { size: "invisible" });
  verifier = v;
  try {
    pending = (await signInWithPhoneNumber(auth, toE164(phone), v)) as unknown as Confirm;
  } catch (e) {
    v.clear();
    verifier = null;
    throw new Error(firebaseMessage(e));
  }
  return {};
}

/** Step 2: check the code and log in to our server. */
export async function confirmCode(phone: string, code: string): Promise<{ token: string; user: Me }> {
  const cfg = await loginMode();
  if (!cfg) return api("/auth/verify", { body: { phone: phone.replace(/[\s-]/g, ""), code } });
  if (!pending) throw new Error("Please request a new code");
  let idToken: string;
  try {
    const cred = await pending.confirm(code);
    idToken = await cred.user.getIdToken();
  } catch (e) {
    throw new Error(firebaseMessage(e));
  }
  return api("/auth/firebase", { body: { idToken } });
}

function firebaseMessage(e: unknown) {
  const c = (e as { code?: string }).code || "";
  if (c.includes("invalid-verification-code")) return "Wrong code, please check the SMS";
  if (c.includes("code-expired")) return "Code expired, please request a new one";
  if (c.includes("too-many-requests")) return "Too many attempts. Please wait a bit and try again";
  if (c.includes("invalid-phone-number")) return "Please enter a valid phone number";
  if (c.includes("quota-exceeded")) return "SMS limit reached for today, please try later";
  return "Could not verify your number. Please try again";
}
