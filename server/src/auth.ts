import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";
import { db, type UserRow } from "./db.js";

const SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
export const DEV_OTP = process.env.NODE_ENV !== "production";

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

export function requestOtp(phone: string) {
  // In dev every code is 123456 so you can test quickly.
  // In production plug in an SMS provider (MSG91, Twilio, Firebase Auth) here.
  const code = DEV_OTP ? "123456" : String(Math.floor(100000 + Math.random() * 900000));
  db.prepare("INSERT OR REPLACE INTO otps (phone, code, expires_at) VALUES (?,?,?)").run(
    phone,
    code,
    Date.now() + 5 * 60_000
  );
  if (!DEV_OTP) {
    // TODO: sendSms(phone, `Your YoFellow code is ${code}`)
  }
  return DEV_OTP ? code : undefined;
}

export function checkOtp(phone: string, code: string) {
  const row = db.prepare("SELECT * FROM otps WHERE phone=?").get(phone) as
    | { code: string; expires_at: number }
    | undefined;
  if (!row || row.code !== code || row.expires_at < Date.now()) return false;
  db.prepare("DELETE FROM otps WHERE phone=?").run(phone);
  return true;
}

export type AuthedRequest = Request & { user: UserRow };

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const uid = verifyToken(token);
  const user = uid ? (db.prepare("SELECT * FROM users WHERE id=?").get(uid) as UserRow | undefined) : undefined;
  if (!user) return res.status(401).json({ error: "Please log in again" });
  (req as AuthedRequest).user = user;
  next();
}
