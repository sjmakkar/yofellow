// Demo bots: seeded users (phones starting 900000000) wave back, reply and play games,
// so one person can test the full flow alone. Turned off when DEMO_BOTS=0 or in production.
import { db } from "./db.js";

export const DEMO_BOTS = process.env.DEMO_BOTS !== "0" && process.env.NODE_ENV !== "production";

export function isDemoUser(phone: string) {
  return DEMO_BOTS && /^900000000\d$/.test(phone);
}

const REPLIES = [
  "Haha nice! Where are you headed?",
  "Same here, this journey is so long. What are you up to?",
  "Oh that's cool. I am just watching the fields go by honestly",
  "Want to play a game? Tap the dice button",
  "Tell me one fun fact about you",
  "I love that. What's your go to travel snack?",
];

export function demoReplyText() {
  return REPLIES[Math.floor(Math.random() * REPLIES.length)];
}

export function demoGameAnswer(type: string, prompt: any): number | string {
  if (type === "deep_q") return "Honestly just going home to see family, and eating a lot of mom's food";
  if (type === "two_truths") return Math.floor(Math.random() * 3);
  if (type === "trivia") return Math.floor(Math.random() * (prompt.options?.length || 4));
  return Math.floor(Math.random() * 2);
}

export function demoPhone(userId: number) {
  const r = db.prepare("SELECT phone FROM users WHERE id=?").get(userId) as { phone: string } | undefined;
  return r?.phone || "";
}

// ---------- demo travellers in group rooms ----------
import { newKeypair, signEnvelope, uuid } from "../../shared/mesh.js";

db.exec("CREATE TABLE IF NOT EXISTS demo_keys (user_id INTEGER PRIMARY KEY, secret TEXT NOT NULL, pubkey TEXT NOT NULL)");

/** Demo users sign group messages like real phones do. */
export function demoSecret(userId: number) {
  let row = db.prepare("SELECT secret FROM demo_keys WHERE user_id=?").get(userId) as { secret: string } | undefined;
  if (!row) {
    const kp = newKeypair();
    db.prepare("INSERT INTO demo_keys (user_id, secret, pubkey) VALUES (?,?,?)").run(userId, kp.secretKey, kp.publicKey);
    db.prepare("INSERT OR IGNORE INTO device_keys (user_id, pubkey) VALUES (?,?)").run(userId, kp.publicKey);
    row = { secret: kp.secretKey };
  }
  return row.secret;
}

export function demoEnvelope(userId: number, name: string, roomId: number, body: string, ts = Date.now()) {
  return signEnvelope({ id: uuid(), room: roomId, sender: userId, name, body, ts, hops: 0, ttl: 12 }, demoSecret(userId));
}

const GROUP_LINES = [
  "Anyone know if the pantry has veg thali today?",
  "Train is running 20 min late as per NTES",
  "Anyone getting down at Kota? Could share an auto",
  "Network is terrible after this station, heads up",
  "Who's up for antakshari in the group later? 😄",
  "Charging point in my bay is working if anyone needs",
  "What's everyone reading or watching on this trip?",
];

export function demoGroupReply(
  room: { id: number; trip_key: string; kind: string },
  fromUser: number,
  ingest: (env: unknown, uploader: number) => unknown
) {
  if (!DEMO_BOTS || (room.kind !== "train" && room.kind !== "topic")) return;
  if (Math.random() > 0.6) return;
  const bots = db
    .prepare("SELECT u.id, u.name, u.phone FROM trips t JOIN users u ON u.id=t.user_id WHERE t.trip_key=? AND u.id<>?")
    .all(room.trip_key, fromUser) as { id: number; name: string; phone: string }[];
  const demo = bots.filter((b) => isDemoUser(b.phone));
  if (!demo.length) return;
  const bot = demo[Math.floor(Math.random() * demo.length)];
  const line = GROUP_LINES[Math.floor(Math.random() * GROUP_LINES.length)];
  setTimeout(() => ingest(demoEnvelope(bot.id, bot.name, room.id, line), bot.id), 2500);
}
