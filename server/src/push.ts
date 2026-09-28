// Web push notifications. Keys are created once and kept in the database, so
// there is nothing to configure. Works on Android/desktop browsers, and on
// iPhone when the app is added to the home screen (iOS 16.4+).
import webpush from "web-push";
import { z } from "zod";
import { db } from "./db.js";
import { isWatching } from "./realtime.js";

let keys: { public_key: string; private_key: string } | null = null;

export async function vapidKeys() {
  if (keys) return keys;
  let row = await db.prepare("SELECT public_key, private_key FROM vapid_keys WHERE id=1").get<{ public_key: string; private_key: string }>();
  if (!row) {
    const k = webpush.generateVAPIDKeys();
    await db.prepare("INSERT INTO vapid_keys (id, public_key, private_key) VALUES (1,?,?) ON CONFLICT (id) DO NOTHING").run(k.publicKey, k.privateKey);
    row = await db.prepare("SELECT public_key, private_key FROM vapid_keys WHERE id=1").get<{ public_key: string; private_key: string }>();
  }
  keys = row!;
  webpush.setVapidDetails(`mailto:${process.env.SUPPORT_EMAIL || "support@yofellow.app"}`, keys.public_key, keys.private_key);
  return keys;
}

export const subSchema = z.object({
  endpoint: z.string().url().max(1000),
  keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }),
});

export async function saveSubscription(userId: number, sub: z.infer<typeof subSchema>) {
  await db
    .prepare(
      "INSERT INTO push_subs (endpoint, user_id, p256dh, auth) VALUES (?,?,?,?) ON CONFLICT (endpoint) DO UPDATE SET user_id=EXCLUDED.user_id, p256dh=EXCLUDED.p256dh, auth=EXCLUDED.auth"
    )
    .run(sub.endpoint, userId, sub.keys.p256dh, sub.keys.auth);
}

export async function removeSubscription(userId: number, endpoint: string) {
  await db.prepare("DELETE FROM push_subs WHERE endpoint=? AND user_id=?").run(endpoint, userId);
}

export type PushPayload = { title: string; body: string; url: string; tag?: string };

/**
 * Notify a user on all their devices. Skipped only when they are looking at that
 * exact screen right now (e.g. the open chat). `ifAppHidden`: also skip when the app
 * is on screen at all, for events the app already shows as an in-app toast.
 */
export async function notify(userId: number, p: PushPayload, opts: { evenIfOnline?: boolean; ifAppHidden?: boolean } = {}) {
  try {
    if (!opts.evenIfOnline && isWatching(userId, opts.ifAppHidden ? undefined : p.url)) return 0;
    await vapidKeys();
    const subs = await db.prepare("SELECT endpoint, p256dh, auth FROM push_subs WHERE user_id=?").all<{ endpoint: string; p256dh: string; auth: string }>(userId);
    let sent = 0;
    await Promise.all(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(p), { TTL: 3600, urgency: "normal" });
          sent++;
        } catch (e: any) {
          // 404/410: the browser dropped this subscription, forget it
          if (e?.statusCode === 404 || e?.statusCode === 410) await db.prepare("DELETE FROM push_subs WHERE endpoint=?").run(s.endpoint);
          else console.error("push failed", e?.statusCode || e?.message);
        }
      })
    );
    return sent;
  } catch (e) {
    console.error("notify failed", (e as Error).message);
    return 0;
  }
}
