// Sign in with Google or email + password through Firebase (both free).
// Firebase proves who you are and gives us an ID token; our server checks the token
// and returns its own session. Email accounts must verify their address first.
// Locally (no Firebase settings) a dev login takes any email with no password.
import { api, type Me } from "../api";

type FirebaseCfg = { apiKey: string; authDomain: string; projectId: string; appId?: string };
export type LoginMethod = "google" | "email" | "phone" | "dev";
type Config = { firebase: FirebaseCfg | null; loginMethods?: LoginMethod[] };
type Session = { token: string; user: Me };

let cfgPromise: Promise<Config> | null = null;
export function authConfig() {
  cfgPromise ??= api<Config>("/config").catch((e) => {
    cfgPromise = null;
    throw e;
  });
  return cfgPromise;
}

async function fb() {
  const cfg = (await authConfig()).firebase;
  if (!cfg) throw new Error("Firebase is not set up on the server");
  const [{ initializeApp, getApps }, mod] = await Promise.all([import("firebase/app"), import("firebase/auth")]);
  const app = getApps()[0] || initializeApp(cfg);
  const auth = mod.getAuth(app);
  auth.useDeviceLanguage();
  return { auth, ...mod };
}

/** Thrown when an email account exists but the address is not verified yet. */
export class NeedsVerification extends Error {
  constructor(public email: string) {
    super(`We sent a verification link to ${email}. Open it, then come back here.`);
  }
}

async function toServer(user: { getIdToken: (force?: boolean) => Promise<string> }): Promise<Session> {
  const idToken = await user.getIdToken(true);
  return api<Session>("/auth/firebase", { body: { idToken } });
}

export async function signInWithGoogle(): Promise<Session> {
  const f = await fb();
  try {
    const provider = new f.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    const cred = await f.signInWithPopup(f.auth, provider);
    return await toServer(cred.user);
  } catch (e) {
    throw new Error(message(e));
  }
}

export async function signInWithEmail(email: string, password: string): Promise<Session> {
  const f = await fb();
  let user;
  try {
    user = (await f.signInWithEmailAndPassword(f.auth, email.trim(), password)).user;
  } catch (e) {
    throw new Error(message(e));
  }
  if (!user.emailVerified) {
    await f.sendEmailVerification(user, { url: location.origin }).catch(() => {});
    throw new NeedsVerification(user.email || email);
  }
  return toServer(user);
}

export async function createEmailAccount(name: string, email: string, password: string): Promise<never> {
  const f = await fb();
  try {
    const { user } = await f.createUserWithEmailAndPassword(f.auth, email.trim(), password);
    if (name.trim()) await f.updateProfile(user, { displayName: name.trim() }).catch(() => {});
    await f.sendEmailVerification(user, { url: location.origin });
    throw new NeedsVerification(user.email || email);
  } catch (e) {
    if (e instanceof NeedsVerification) throw e;
    throw new Error(message(e));
  }
}

/** After tapping the link in the email: check again and sign in. */
export async function finishVerification(): Promise<Session> {
  const f = await fb();
  const user = f.auth.currentUser;
  if (!user) throw new Error("Please sign in again with your email and password");
  await user.reload();
  if (!user.emailVerified) throw new Error("Not verified yet. Open the link in the email (check spam too), then tap the button again.");
  return toServer(user);
}

export async function resendVerification() {
  const f = await fb();
  const user = f.auth.currentUser;
  if (!user) throw new Error("Please sign in again");
  try {
    await f.sendEmailVerification(user, { url: location.origin });
  } catch (e) {
    throw new Error(message(e));
  }
}

export async function resetPassword(email: string) {
  const f = await fb();
  try {
    await f.sendPasswordResetEmail(f.auth, email.trim(), { url: location.origin });
  } catch (e) {
    throw new Error(message(e));
  }
}

/**
 * Change the sign in email. Firebase emails a link to the NEW address and only
 * switches once it is clicked, so the account always has a verified email.
 */
export async function changeEmail(newEmail: string, password: string) {
  const f = await fb();
  const user = f.auth.currentUser;
  if (!user || !user.email) throw new Error("Please log out and sign in again first");
  try {
    await f.reauthenticateWithCredential(user, f.EmailAuthProvider.credential(user.email, password));
    await f.verifyBeforeUpdateEmail(user, newEmail.trim(), { url: location.origin });
  } catch (e) {
    throw new Error(message(e));
  }
}

/** Signed in to Firebase on this device? (Needed to change email.) */
export async function firebaseUserEmail() {
  const cfg = (await authConfig().catch(() => null))?.firebase;
  if (!cfg) return null;
  const f = await fb();
  await f.auth.authStateReady();
  return f.auth.currentUser?.email ?? null;
}

export async function firebaseSignOut() {
  try {
    const cfg = (await authConfig()).firebase;
    if (!cfg) return;
    const f = await fb();
    await f.signOut(f.auth);
  } catch {
    /* offline: the local session is cleared anyway */
  }
}

/** Local development only. */
export function devEmailLogin(email: string, name?: string): Promise<Session> {
  return api<Session>("/auth/dev-email", { body: { email, name } });
}

function message(e: unknown) {
  const c = (e as { code?: string }).code || "";
  if (!c) return (e as Error).message || "Something went wrong";
  console.error("Firebase auth error:", c, e);
  if (c.includes("popup-closed-by-user") || c.includes("cancelled-popup-request")) return "Sign in was cancelled";
  if (c.includes("popup-blocked")) return "Your browser blocked the Google window. Allow pop-ups for this site and try again";
  if (c.includes("invalid-credential") || c.includes("wrong-password") || c.includes("user-not-found")) return "Wrong email or password";
  if (c.includes("email-already-in-use")) return "An account with this email already exists. Sign in instead (or use Continue with Google)";
  if (c.includes("weak-password")) return "Password is too weak. Use at least 8 characters";
  if (c.includes("invalid-email")) return "Please enter a valid email address";
  if (c.includes("too-many-requests")) return "Too many attempts. Please wait a few minutes and try again";
  if (c.includes("requires-recent-login")) return "For safety, log out and sign in again, then retry";
  if (c.includes("network-request-failed")) return "No internet connection. Try again when you have network";
  if (c.includes("operation-not-allowed")) return "This sign in method is not turned on in Firebase (Authentication > Sign-in method)";
  if (c.includes("unauthorized-domain")) return "This website is not in Firebase Authorized domains yet";
  if (c.includes("account-exists-with-different-credential")) return "This email already uses another sign in method. Try Continue with Google or your password";
  return `Sign in failed (${c}). Please try again`;
}
