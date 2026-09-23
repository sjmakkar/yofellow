// Per journey group rooms, the offline sync endpoint, device keys for the mesh,
// and the crowd sourced signal map.
import { z } from "zod";
import { db, isBlocked, routeOf, type TripRow, type UserRow } from "./db.js";
import { api, me, bad, parse, getUser, myTrip, travellersFor, tripOut, sendDm, doWave, answerGame } from "./routes.js";
import { emitToRoom, setRoomAccess } from "./realtime.js";
import { checkGroupMessage, verifyEnvelope, newKeypair, signCert, type Envelope, type KeyCert } from "../../shared/mesh.js";
import { demoGroupReply } from "./demo.js";

export type RoomRow = { id: number; trip_key: string; kind: "train" | "coach" | "women" | "topic"; coach: string; name: string; created_by: number | null };
type RoomMsgRow = { id: number; uuid: string; room_id: number; sender_id: number; body: string; client_ts: number; sig: string; sender_name: string; hidden: number; created_at: string };

const today = () => new Date().toISOString().slice(0, 10);
const dayBefore = () => new Date(Date.now() - 86400000).toISOString().slice(0, 10);

// ---------- server signing key: vouches for device keys so phones can trust them offline ----------
db.exec("CREATE TABLE IF NOT EXISTS server_keys (id INTEGER PRIMARY KEY CHECK (id = 1), secret TEXT NOT NULL, pubkey TEXT NOT NULL)");
function serverKeys() {
  let row = db.prepare("SELECT secret, pubkey FROM server_keys WHERE id=1").get() as { secret: string; pubkey: string } | undefined;
  if (!row) {
    const kp = newKeypair();
    db.prepare("INSERT INTO server_keys (id, secret, pubkey) VALUES (1,?,?)").run(kp.secretKey, kp.publicKey);
    row = { secret: kp.secretKey, pubkey: kp.publicKey };
  }
  return row;
}
export const certFor = (user: number, pubkey: string): KeyCert => signCert(user, pubkey, serverKeys().secret);

// ---------- rooms ----------
export function ensureRooms(trip: Pick<TripRow, "trip_key" | "coach" | "mode" | "number">) {
  const ins = db.prepare("INSERT OR IGNORE INTO rooms (trip_key, kind, coach, name) VALUES (?,?,?,?)");
  const label = { train: "Whole train", flight: "Whole flight", bus: "Whole bus", metro: "Whole line" }[trip.mode] || "Everyone";
  ins.run(trip.trip_key, "train", "", label);
  ins.run(trip.trip_key, "women", "", "Women only");
  if (trip.coach) ins.run(trip.trip_key, "coach", trip.coach.toUpperCase(), `Coach ${trip.coach.toUpperCase()}`);
}

function tripOnKey(userId: number, tripKey: string) {
  return db.prepare("SELECT * FROM trips WHERE user_id=? AND trip_key=?").get(userId, tripKey) as TripRow | undefined;
}

/** Room if this user may read and post in it, else null. */
export function roomAccess(user: UserRow, roomId: number) {
  const room = db.prepare("SELECT * FROM rooms WHERE id=?").get(roomId) as RoomRow | undefined;
  if (!room) return null;
  const trip = tripOnKey(user.id, room.trip_key);
  if (!trip) return null;
  if (room.kind === "coach" && (trip.coach || "").toUpperCase() !== room.coach) return null;
  if (room.kind === "women" && user.gender !== "woman") return null;
  return room;
}
setRoomAccess((uid, roomId) => {
  const u = getUser(uid);
  return !!(u && roomAccess(u, roomId));
});

export function isArchived(room: RoomRow) {
  const date = room.trip_key.split("|")[2];
  return date < dayBefore(); // read only from the second day after the journey
}

function memberCount(room: RoomRow) {
  const q =
    room.kind === "coach"
      ? db.prepare("SELECT COUNT(DISTINCT user_id) c FROM trips WHERE trip_key=? AND UPPER(coach)=?").get(room.trip_key, room.coach)
      : room.kind === "women"
      ? db.prepare("SELECT COUNT(DISTINCT t.user_id) c FROM trips t JOIN users u ON u.id=t.user_id WHERE t.trip_key=? AND u.gender='woman'").get(room.trip_key)
      : room.kind === "topic"
      ? db.prepare("SELECT COUNT(DISTINCT sender_id) c FROM room_messages WHERE room_id=?").get(room.id)
      : db.prepare("SELECT COUNT(DISTINCT user_id) c FROM trips WHERE trip_key=?").get(room.trip_key);
  return (q as { c: number }).c;
}

function roomOut(room: RoomRow) {
  const last = db.prepare("SELECT body, sender_name FROM room_messages WHERE room_id=? AND hidden=0 ORDER BY id DESC LIMIT 1").get(room.id) as
    | { body: string; sender_name: string }
    | undefined;
  return {
    id: room.id,
    kind: room.kind,
    name: room.name,
    coach: room.coach || null,
    members: memberCount(room),
    archived: isArchived(room),
    last: last ? `${last.sender_name}: ${last.body}` : null,
  };
}

export function roomsFor(user: UserRow, trip: TripRow) {
  ensureRooms(trip);
  const rows = db.prepare("SELECT * FROM rooms WHERE trip_key=? ORDER BY CASE kind WHEN 'train' THEN 0 WHEN 'coach' THEN 1 WHEN 'women' THEN 2 ELSE 3 END, id").all(trip.trip_key) as RoomRow[];
  return rows.filter((r) => roomAccess(user, r.id)).map(roomOut);
}

const certCache = new Map<string, KeyCert | undefined>();
function roomMsgOut(m: RoomMsgRow) {
  // Full envelope plus a key certificate, so a phone that got this online can
  // re-share it over the mesh and offline phones can still verify it.
  const env = { id: m.uuid, room: m.room_id, sender: m.sender_id, name: m.sender_name, body: m.body, ts: m.client_ts, hops: 0, ttl: 12, sig: m.sig };
  if (!certCache.has(m.uuid)) {
    const key = keysOf(m.sender_id).find((k) => verifyEnvelope(env, [k]));
    certCache.set(m.uuid, key ? certFor(m.sender_id, key) : undefined);
  }
  return { serverId: m.id, ...env, cert: certCache.get(m.uuid) };
}

function roomMessages(viewer: UserRow, roomId: number, after = 0, limit = 200) {
  const rows = db
    .prepare("SELECT * FROM (SELECT * FROM room_messages WHERE room_id=? AND id>? AND hidden=0 ORDER BY id DESC LIMIT ?) ORDER BY id ASC")
    .all(roomId, after, limit) as RoomMsgRow[];
  return rows.filter((m) => !isBlocked(viewer.id, m.sender_id)).map(roomMsgOut);
}

// ---------- ingest a signed group message (own post, or relayed from the mesh) ----------
const envSchema = z.object({
  id: z.string().uuid(),
  room: z.number().int(),
  sender: z.number().int(),
  name: z.string().min(1).max(40),
  body: z.string().min(1).max(500),
  ts: z.number().int(),
  hops: z.number().int().min(0).max(50),
  ttl: z.number().int().min(0).max(50),
  sig: z.string().min(10).max(200),
});

export function keysOf(userId: number) {
  return (db.prepare("SELECT pubkey FROM device_keys WHERE user_id=?").all(userId) as { pubkey: string }[]).map((r) => r.pubkey);
}

export function ingestEnvelope(raw: unknown, uploaderId: number): { error: string } | { message: ReturnType<typeof roomMsgOut>; duplicate: boolean } {
  const p = envSchema.safeParse(raw);
  if (!p.success) return { error: "Bad message format" };
  const e = p.data as Envelope;
  const dup = db.prepare("SELECT * FROM room_messages WHERE uuid=?").get(e.id) as RoomMsgRow | undefined;
  if (dup) return { message: roomMsgOut(dup), duplicate: true };

  const sender = getUser(e.sender);
  if (!sender) return { error: "Unknown sender" };
  const room = roomAccess(sender, e.room);
  if (!room) return { error: "Sender is not in this room" };
  if (isArchived(room)) return { error: "This room is archived" };
  // A relaying phone can only upload for rooms of journeys it is on too.
  if (uploaderId !== sender.id) {
    if (!tripOnKey(uploaderId, room.trip_key)) return { error: "Relay not on this journey" };
    // Coach and women rooms never travel over the mesh, so relays cannot carry them.
    if (room.kind !== "train" && room.kind !== "topic") return { error: "This room is not relayed" };
  }
  if (!verifyEnvelope(e, keysOf(sender.id))) return { error: "Signature check failed" };
  const mod = checkGroupMessage(e.body);
  if (mod) return { error: mod };
  if (Math.abs(e.ts - Date.now()) > 3 * 86400000) return { error: "Message time is off" };
  const burst = db.prepare("SELECT 1 FROM room_messages WHERE room_id=? AND sender_id=? AND ABS(client_ts-?) < 1000").get(room.id, sender.id, e.ts);
  if (burst) return { error: "Slow mode: one message per second" };

  const r = db
    .prepare("INSERT INTO room_messages (uuid, room_id, sender_id, body, client_ts, sig, sender_name, relayed_by) VALUES (?,?,?,?,?,?,?,?)")
    .run(e.id, room.id, sender.id, e.body, e.ts, e.sig, e.name, uploaderId === sender.id ? null : uploaderId);
  const row = db.prepare("SELECT * FROM room_messages WHERE id=?").get(r.lastInsertRowid) as RoomMsgRow;
  const out = roomMsgOut(row);
  emitToRoom(room.id, "room:message", out);
  if (uploaderId === sender.id) demoGroupReply(room, sender.id, ingestEnvelope);
  return { message: out, duplicate: false };
}

// ---------- signal map ----------
const sampleSchema = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), online: z.boolean(), ts: z.number().int() });

export function ingestSignal(u: UserRow, tripId: number, samples: unknown) {
  const trip = myTrip(u.id, tripId);
  if (!trip) return { error: "Trip not found" };
  const p = z.array(sampleSchema).max(300).safeParse(samples);
  if (!p.success) return { error: "Bad samples" };
  const ins = db.prepare("INSERT INTO signal_samples (user_id, route, date, lat, lng, online, ts) VALUES (?,?,?,?,?,?,?)");
  const route = routeOf(trip.trip_key);
  db.transaction(() => p.data.forEach((s) => ins.run(u.id, route, trip.date, s.lat, s.lng, s.online ? 1 : 0, s.ts)))();
  return { saved: p.data.length };
}

export function signalFor(tripKey: string) {
  const since = Date.now() - 60 * 86400000;
  const rows = db
    .prepare("SELECT user_id, date, lat, lng, online, ts FROM signal_samples WHERE route=? AND ts>? ORDER BY ts LIMIT 20000")
    .all(routeOf(tripKey), since) as { user_id: number; date: string; lat: number; lng: number; online: number; ts: number }[];
  // compact: [run, ts, lat, lng, online]
  return rows.map((r) => [`${r.user_id}|${r.date}`, r.ts, +r.lat.toFixed(4), +r.lng.toFixed(4), r.online] as const);
}

// ---------- routes ----------
api.put("/me/key", (req, res) => {
  const b = parse(z.object({ pubkey: z.string().regex(/^[A-Za-z0-9+/]{43}=$/, "bad key") }), req.body, res);
  if (!b) return;
  db.prepare("INSERT OR IGNORE INTO device_keys (user_id, pubkey) VALUES (?,?)").run(me(req).id, b.pubkey);
  res.json({ ok: true, cert: certFor(me(req).id, b.pubkey), serverKey: serverKeys().pubkey });
});

api.get("/trips/:id/rooms", (req, res) => {
  const trip = myTrip(me(req).id, Number(req.params.id));
  if (!trip) return bad(res, "Trip not found", 404);
  res.json(roomsFor(me(req), trip));
});

api.post("/trips/:id/rooms", (req, res) => {
  const u = me(req);
  const trip = myTrip(u.id, Number(req.params.id));
  if (!trip) return bad(res, "Trip not found", 404);
  const b = parse(z.object({ name: z.string().trim().min(3).max(40) }), req.body, res);
  if (!b) return;
  const mod = checkGroupMessage(b.name);
  if (mod) return bad(res, mod);
  const count = (db.prepare("SELECT COUNT(*) c FROM rooms WHERE trip_key=? AND kind='topic'").get(trip.trip_key) as { c: number }).c;
  if (count >= 20) return bad(res, "This journey already has 20 topic rooms");
  const r = db.prepare("INSERT INTO rooms (trip_key, kind, coach, name, created_by) VALUES (?,?,?,?,?)").run(trip.trip_key, "topic", "", b.name, u.id);
  res.json(roomOut(db.prepare("SELECT * FROM rooms WHERE id=?").get(r.lastInsertRowid) as RoomRow));
});

api.get("/rooms/:id/messages", (req, res) => {
  const u = me(req);
  const room = roomAccess(u, Number(req.params.id));
  if (!room) return bad(res, "Room not found", 404);
  res.json({ room: roomOut(room), messages: roomMessages(u, room.id, Number(req.query.after) || 0) });
});

api.post("/room-messages/:uuid/report", (req, res) => {
  const u = me(req);
  const b = parse(z.object({ reason: z.string().trim().min(1).max(300) }), req.body, res);
  if (!b) return;
  const m = db.prepare("SELECT * FROM room_messages WHERE uuid=?").get(req.params.uuid) as RoomMsgRow | undefined;
  if (!m || !roomAccess(u, m.room_id)) return bad(res, "Message not found", 404);
  db.prepare("INSERT OR IGNORE INTO message_reports (message_uuid, reporter_id, reason) VALUES (?,?,?)").run(m.uuid, u.id, b.reason);
  const n = (db.prepare("SELECT COUNT(*) c FROM message_reports WHERE message_uuid=?").get(m.uuid) as { c: number }).c;
  if (n >= 3) db.prepare("UPDATE room_messages SET hidden=1 WHERE uuid=?").run(m.uuid);
  res.json({ ok: true });
});

/** Everything a phone needs to keep working with no network: download on station Wi-Fi. */
api.get("/trips/:id/pack", (req, res) => {
  const u = me(req);
  const trip = myTrip(u.id, Number(req.params.id));
  if (!trip) return bad(res, "Trip not found", 404);
  const rooms = roomsFor(u, trip).map((r) => ({ ...r, messages: roomMessages(u, r.id) }));
  const travellers = travellersFor(u, trip);
  // Keys of everyone on this journey, so the phone can verify mesh messages offline.
  const people = db.prepare("SELECT DISTINCT user_id FROM trips WHERE trip_key=?").all(trip.trip_key) as { user_id: number }[];
  const keys: Record<number, string[]> = {};
  const names: Record<number, string> = {};
  for (const p of people) {
    keys[p.user_id] = keysOf(p.user_id);
    names[p.user_id] = getUser(p.user_id)?.name || "Traveller";
  }
  const blocked = (db.prepare("SELECT blocked_id id FROM blocks WHERE blocker_id=? UNION SELECT blocker_id FROM blocks WHERE blocked_id=?").all(u.id, u.id) as { id: number }[]).map((r) => r.id);
  res.json({
    savedAt: Date.now(),
    trip: { ...tripOut(trip), key: trip.trip_key },
    rooms,
    travellers,
    keys,
    names,
    blocked,
    serverKey: serverKeys().pubkey,
    signal: signalFor(trip.trip_key),
  });
});

api.post("/signal", (req, res) => {
  const b = parse(z.object({ tripId: z.number().int(), samples: z.array(z.any()) }), req.body, res);
  if (!b) return;
  const r = ingestSignal(me(req), b.tripId, b.samples);
  if ("error" in r) return bad(res, r.error!);
  res.json(r);
});

// ---------- batch sync: the offline outbox flushes here in one request ----------
const opSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("room_msg"), env: z.any() }),
  z.object({ op: z.literal("relay"), env: z.any() }),
  z.object({ op: z.literal("dm_msg"), uuid: z.string().uuid(), matchId: z.number().int(), body: z.string() }),
  z.object({ op: z.literal("game_answer"), gameId: z.number().int(), answer: z.union([z.number().int(), z.string().min(1).max(300)]) }),
  z.object({ op: z.literal("wave"), toId: z.number().int(), tripId: z.number().int() }),
  z.object({ op: z.literal("signal"), tripId: z.number().int(), samples: z.array(z.any()) }),
]);

api.post("/sync", (req, res) => {
  const u = me(req);
  const b = parse(z.object({ ops: z.array(z.any()).max(500) }), req.body, res);
  if (!b) return;
  const results = b.ops.map((raw) => {
    const p = opSchema.safeParse(raw);
    if (!p.success) return { ok: false, error: "Bad operation" };
    const o = p.data;
    try {
      switch (o.op) {
        case "room_msg":
        case "relay": {
          const r = ingestEnvelope(o.env, u.id);
          return "error" in r ? { ok: false, error: r.error } : { ok: true, data: r.message };
        }
        case "dm_msg": {
          const r = sendDm(u, o.matchId, o.body, o.uuid);
          return "error" in r ? { ok: false, error: r.error } : { ok: true, data: r.message };
        }
        case "game_answer": {
          const r = answerGame(o.gameId, u.id, o.answer);
          if ("error" in r) return r.error === "You already answered" ? { ok: true } : { ok: false, error: r.error };
          return { ok: true, data: r.view };
        }
        case "wave": {
          const r = doWave(u, o.toId, o.tripId);
          return "error" in r ? { ok: false, error: r.error } : { ok: true, data: r };
        }
        case "signal": {
          const r = ingestSignal(u, o.tripId, o.samples);
          return "error" in r ? { ok: false, error: r.error } : { ok: true, data: r };
        }
      }
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  });
  res.json({ results, serverTime: Date.now() });
});
