import jwt from "jsonwebtoken";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Request, Response, NextFunction } from "express";
import { db, type UserRow } from "./db.js";

const PROD = process.env.NODE_ENV === "production";
if (PROD && (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32)) {
  throw new Error("Set JWT_SECRET to a long random string (32+ characters) in production");
}
const SECRET = process.env.JWT_SECRET || "dev-secret-change-me";

/** Dev login: every code is 123456. Only when not in production and Firebase is not set up. */
export const DEV_OTP = !PROD;

export function signToken(userId: number) {
  return jwt.sign({ uid: userId }, SECRET, { expiresIn: "30d" });
}

export function verifyToken(token: string): number | null {
  try {
    const p = jwt.verify(token, SECRET) as { uid: number };
    return p.uid;
  } catch {
    return null;
  }
}

// ---------- Firebase phone auth ----------
// The app does the SMS step with Firebase. It sends us the Firebase ID token and
// we check it against Google's public keys. No Firebase service account needed.
export function firebaseConfig() {
  const { FIREBASE_API_KEY, FIREBASE_AUTH_DOMAIN, FIREBASE_PROJECT_ID, FIREBASE_APP_ID } = process.env;
  if (!FIREBASE_API_KEY || !FIREBASE_PROJECT_ID) return null;
  return {
    apiKey: FIREBASE_API_KEY,
    authDomain: FIREBASE_AUTH_DOMAIN || `${FIREBASE_PROJECT_ID}.firebaseapp.com`,
    projectId: FIREBASE_PROJECT_ID,
    appId: FIREBASE_APP_ID || undefined,
  };
}

const GOOGLE_KEYS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com")
);

/** Returns the verified phone number (+91...) or null. */
export async function verifyFirebaseToken(idToken: string): Promise<string | null> {
  const cfg = firebaseConfig();
  if (!cfg) return null;
  try {
    const { payload } = await jwtVerify(idToken, GOOGLE_KEYS, {
      issuer: `https://securetoken.google.com/${cfg.projectId}`,
      audience: cfg.projectId,
    });
    const phone = payload.phone_number;
    return typeof phone === "string" && payload.sub ? phone : null;
  } catch {
    return null;
  }
}

// ---------- Dev OTP (local only) ----------
export async function requestOtp(phone: string) {
  if (!DEV_OTP) throw new Error("SMS login is not configured. Set the FIREBASE_* variables.");
  const code = "123456";
  await db
    .prepare("INSERT INTO otps (phone, code, expires_at) VALUES (?,?,?) ON CONFLICT (phone) DO UPDATE SET code = EXCLUDED.code, expires_at = EXCLUDED.expires_at")
    .run(phone, code, Date.now() + 5 * 60_000);
  return code;
}

export async function checkOtp(phone: string, code: string) {
  if (!DEV_OTP) return false;
  const row = await db.prepare("SELECT * FROM otps WHERE phone=?").get<{ code: string; expires_at: number }>(phone);
  if (!row || row.code !== code || row.expires_at < Date.now()) return false;
  await db.prepare("DELETE FROM otps WHERE phone=?").run(phone);
  return true;
}

export type AuthedRequest = Request & { user: UserRow };

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const uid = verifyToken(token);
  const user = uid ? await db.prepare("SELECT * FROM users WHERE id=?").get<UserRow>(uid) : undefined;
  if (!user) return res.status(401).json({ error: "Please log in again" });
  (req as AuthedRequest).user = user;
  next();
}
