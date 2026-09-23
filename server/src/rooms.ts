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

const dayBefore = () => new Date(Date.now() - 86400000).toISOString().slice(0, 10);

// ---------- server signing key: vouches for device keys so phones can trust them offline ----------
let serverKeyCache: { secret: string; pubkey: string } | null = null;
async function serverKeys() {
  if (serverKeyCache) return serverKeyCache;
  let row = await db.prepare("SELECT secret, pubkey FROM server_keys WHERE id=1").get<{ secret: string; pubkey: string }>();
  if (!row) {
    const kp = newKeypair();
    await db.prepare("INSERT INTO server_keys (id, secret, pubkey) VALUES (1,?,?) ON CONFLICT (id) DO NOTHING").run(kp.secretKey, kp.publicKey);
    row = await db.prepare("SELECT secret, pubkey FROM server_keys WHERE id=1").get<{ secret: string; pubkey: string }>();
  }
  serverKeyCache = row!;
  return serverKeyCache;
}
export const certFor = async (user: number, pubkey: string): Promise<KeyCert> => signCert(user, pubkey, (await serverKeys()).secret);

// ---------- rooms ----------
export async function ensureRooms(trip: Pick<TripRow, "trip_key" | "coach" | "mode" | "number">) {
  const ins = db.prepare("INSERT INTO rooms (trip_key, kind, coach, name) VALUES (?,?,?,?) ON CONFLICT DO NOTHING");
  const label = ({ train: "Whole train", flight: "Whole flight", bus: "Whole bus", metro: "Whole line" } as Record<string, string>)[trip.mode] || "Everyone";
  await ins.run(trip.trip_key, "train", "", label);
  await ins.run(trip.trip_key, "women", "", "Women only");
  if (trip.coach) await ins.run(trip.trip_key, "coach", trip.coach.toUpperCase(), `Coach ${trip.coach.toUpperCase()}`);
}

function tripOnKey(userId: number, tripKey: string) {
  return db.prepare("SELECT * FROM trips WHERE user_id=? AND trip_key=?").get<TripRow>(userId, tripKey);
}

/** Room if this user may read and post in it, else null. */
export async function roomAccess(user: UserRow, roomId: number) {
  const room = await db.prepare("SELECT * FROM rooms WHERE id=?").get<RoomRow>(roomId);
  if (!room) return null;
  const trip = await tripOnKey(user.id, room.trip_key);
  if (!trip) return null;
  if (room.kind === "coach" && (trip.coach || "").toUpperCase() !== room.coach) return null;
  if (room.kind === "women" && user.gender !== "woman") return null;
  return room;
}
setRoomAccess(async (uid, roomId) => {
  const u = await getUser(uid);
  return !!(u && (await roomAccess(u, roomId)));
});

export function isArchived(room: RoomRow) {
  const date = room.trip_key.split("|")[2];
  return date < dayBefore(); // read only from the second day after the journey
}

async function memberCount(room: RoomRow) {
  const q =
    room.kind === "coach"
      ? db.prepare("SELECT COUNT(DISTINCT user_id) c FROM trips WHERE trip_key=? AND UPPER(coach)=?").get<{ c: number }>(room.trip_key, room.coach)
      : room.kind === "women"
      ? db.prepare("SELECT COUNT(DISTINCT t.user_id) c FROM trips t JOIN users u ON u.id=t.user_id WHERE t.trip_key=? AND u.gender='woman'").get<{ c: number }>(room.trip_key)
      : room.kind === "topic"
      ? db.prepare("SELECT COUNT(DISTINCT sender_id) c FROM room_messages WHERE room_id=?").get<{ c: number }>(room.id)
      : db.prepare("SELECT COUNT(DISTINCT user_id) c FROM trips WHERE trip_key=?").get<{ c: number }>(room.trip_key);
  return (await q)?.c ?? 0;
}

async function roomOut(room: RoomRow) {
  const last = await db
    .prepare("SELECT body, sender_name FROM room_messages WHERE room_id=? AND hidden=0 ORDER BY id DESC LIMIT 1")
    .get<{ body: string; sender_name: string }>(room.id);
  return {
    id: room.id,
    kind: room.kind,
    name: room.name,
    coach: room.coach || null,
    members: await memberCount(room),
    archived: isArchived(room),
    last: last ? `${last.sender_name}: ${last.body}` : null,
  };
}

export async function roomsFor(user: UserRow, trip: TripRow) {
  await ensureRooms(trip);
  const rows = await db
    .prepare("SELECT * FROM rooms WHERE trip_key=? ORDER BY CASE kind WHEN 'train' THEN 0 WHEN 'coach' THEN 1 WHEN 'women' THEN 2 ELSE 3 END, id")
    .all<RoomRow>(trip.trip_key);
  const out = [];
  for (const r of rows) if (await roomAccess(user, r.id)) out.push(await roomOut(r));
  return out;
}

const certCache = new Map<string, KeyCert | undefined>();
async function roomMsgOut(m: RoomMsgRow) {
  // Full envelope plus a key certificate, so a phone that got this online can
  // re-share it over the mesh and offline phones can still verify it.
  const env = { id: m.uuid, room: m.room_id, sender: m.sender_id, name: m.sender_name, body: m.body, ts: m.client_ts, hops: 0, ttl: 12, sig: m.sig };
  if (!certCache.has(m.uuid)) {
    const key = (await keysOf(m.sender_id)).find((k) => verifyEnvelope(env, [k]));
    certCache.set(m.uuid, key ? await certFor(m.sender_id, key) : undefined);
  }
  return { serverId: m.id, ...env, cert: certCache.get(m.uuid) };
}

async function roomMessages(viewer: UserRow, roomId: number, after = 0, limit = 200) {
  const rows = await db
    .prepare(
      `SELECT * FROM (SELECT * FROM room_messages WHERE room_id=? AND id>? AND hidden=0 ORDER BY id DESC LIMIT ?) recent
       WHERE sender_id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id=? UNION SELECT blocker_id FROM blocks WHERE blocked_id=?)
       ORDER BY id ASC`
    )
    .all<RoomMsgRow>(roomId, after, limit, viewer.id, viewer.id);
  return Promise.all(rows.map(roomMsgOut));
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

export async function keysOf(userId: number) {
  const rows = await db.prepare("SELECT pubkey FROM device_keys WHERE user_id=?").all<{ pubkey: string }>(userId);
  return rows.map((r) => r.pubkey);
}

type Msg = Awaited<ReturnType<typeof roomMsgOut>>;

export async function ingestEnvelope(raw: unknown, uploaderId: number): Promise<{ error: string } | { message: Msg; duplicate: boolean }> {
  const p = envSchema.safeParse(raw);
  if (!p.success) return { error: "Bad message format" };
  const e = p.data as Envelope;
  const dup = await db.prepare("SELECT * FROM room_messages WHERE uuid=?").get<RoomMsgRow>(e.id);
  if (dup) return { message: await roomMsgOut(dup), duplicate: true };

  const sender = await getUser(e.sender);
  if (!sender) return { error: "Unknown sender" };
  const room = await roomAccess(sender, e.room);
  if (!room) return { error: "Sender is not in this room" };
  if (isArchived(room)) return { error: "This room is archived" };
  // A relaying phone can only upload for rooms of journeys it is on too.
  if (uploaderId !== sender.id) {
    if (!(await tripOnKey(uploaderId, room.trip_key))) return { error: "Relay not on this journey" };
    // Coach and women rooms never travel over the mesh, so relays cannot carry them.
    if (room.kind !== "train" && room.kind !== "topic") return { error: "This room is not relayed" };
  }
  if (!verifyEnvelope(e, await keysOf(sender.id))) return { error: "Signature check failed" };
  const mod = checkGroupMessage(e.body);
  if (mod) return { error: mod };
  if (Math.abs(e.ts - Date.now()) > 3 * 86400000) return { error: "Message time is off" };
  const burst = await db.prepare("SELECT 1 FROM room_messages WHERE room_id=? AND sender_id=? AND ABS(client_ts - ?) < 1000").get(room.id, sender.id, e.ts);
  if (burst) return { error: "Slow mode: one message per second" };

  const row = await db
    .prepare(
      "INSERT INTO room_messages (uuid, room_id, sender_id, body, client_ts, sig, sender_name, relayed_by) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT (uuid) DO NOTHING RETURNING *"
    )
    .get<RoomMsgRow>(e.id, room.id, sender.id, e.body, e.ts, e.sig, e.name, uploaderId === sender.id ? null : uploaderId);
  if (!row) {
    // Another phone uploaded the same message a moment earlier.
    const other = await db.prepare("SELECT * FROM room_messages WHERE uuid=?").get<RoomMsgRow>(e.id);
    return { message: await roomMsgOut(other!), duplicate: true };
  }
  const out = await roomMsgOut(row);
  emitToRoom(room.id, "room:message", out);
  if (uploaderId === sender.id) demoGroupReply(room, sender.id, ingestEnvelope).catch(console.error);
  return { message: out, duplicate: false };
}

// ---------- signal map ----------
const sampleSchema = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), online: z.boolean(), ts: z.number().int() });

export async function ingestSignal(u: UserRow, tripId: number, samples: unknown) {
  const trip = await myTrip(u.id, tripId);
  if (!trip) return { error: "Trip not found" };
  const p = z.array(sampleSchema).max(300).safeParse(samples);
  if (!p.success) return { error: "Bad samples" };
  const route = routeOf(trip.trip_key);
  await db.insertMany(
    "signal_samples",
    ["user_id", "route", "date", "lat", "lng", "online", "ts"],
    p.data.map((s) => [u.id, route, trip.date, s.lat, s.lng, s.online ? 1 : 0, s.ts])
  );
  return { saved: p.data.length };
}

export async function signalFor(tripKey: string) {
  const since = Date.now() - 60 * 86400000;
  const rows = await db
    .prepare("SELECT user_id, date, lat, lng, online, ts FROM signal_samples WHERE route=? AND ts>? ORDER BY ts LIMIT 20000")
    .all<{ user_id: number; date: string; lat: number; lng: number; online: number; ts: number }>(routeOf(tripKey), since);
  // compact: [run, ts, lat, lng, online]
  return rows.map((r) => [`${r.user_id}|${r.date}`, r.ts, +r.lat.toFixed(4), +r.lng.toFixed(4), r.online] as const);
}

// ---------- routes ----------
api.put("/me/key", async (req, res) => {
  const b = parse(z.object({ pubkey: z.string().regex(/^[A-Za-z0-9+/]{43}=$/, "bad key") }), req.body, res);
  if (!b) return;
  await db.prepare("INSERT INTO device_keys (user_id, pubkey) VALUES (?,?) ON CONFLICT DO NOTHING").run(me(req).id, b.pubkey);
  res.json({ ok: true, cert: await certFor(me(req).id, b.pubkey), serverKey: (await serverKeys()).pubkey });
});

api.get("/trips/:id/rooms", async (req, res) => {
  const trip = await myTrip(me(req).id, Number(req.params.id));
  if (!trip) return bad(res, "Trip not found", 404);
  res.json(await roomsFor(me(req), trip));
});

api.post("/trips/:id/rooms", async (req, res) => {
  const u = me(req);
  const trip = await myTrip(u.id, Number(req.params.id));
  if (!trip) return bad(res, "Trip not found", 404);
  const b = parse(z.object({ name: z.string().trim().min(3).max(40) }), req.body, res);
  if (!b) return;
  const mod = checkGroupMessage(b.name);
  if (mod) return bad(res, mod);
  const count = await db.prepare("SELECT COUNT(*) c FROM rooms WHERE trip_key=? AND kind='topic'").get<{ c: number }>(trip.trip_key);
  if ((count?.c ?? 0) >= 20) return bad(res, "This journey already has 20 topic rooms");
  const room = await db
    .prepare("INSERT INTO rooms (trip_key, kind, coach, name, created_by) VALUES (?,?,?,?,?) RETURNING *")
    .get<RoomRow>(trip.trip_key, "topic", "", b.name, u.id);
  res.json(await roomOut(room!));
});

api.get("/rooms/:id/messages", async (req, res) => {
  const u = me(req);
  const room = await roomAccess(u, Number(req.params.id));
  if (!room) return bad(res, "Room not found", 404);
  res.json({ room: await roomOut(room), messages: await roomMessages(u, room.id, Number(req.query.after) || 0) });
});

api.post("/room-messages/:uuid/report", async (req, res) => {
  const u = me(req);
  const b = parse(z.object({ reason: z.string().trim().min(1).max(300) }), req.body, res);
  if (!b) return;
  const m = await db.prepare("SELECT * FROM room_messages WHERE uuid=?").get<RoomMsgRow>(String(req.params.uuid));
  if (!m || !(await roomAccess(u, m.room_id))) return bad(res, "Message not found", 404);
  await db.prepare("INSERT INTO message_reports (message_uuid, reporter_id, reason) VALUES (?,?,?) ON CONFLICT DO NOTHING").run(m.uuid, u.id, b.reason);
  const n = await db.prepare("SELECT COUNT(*) c FROM message_reports WHERE message_uuid=?").get<{ c: number }>(m.uuid);
  if ((n?.c ?? 0) >= 3) await db.prepare("UPDATE room_messages SET hidden=1 WHERE uuid=?").run(m.uuid);
  res.json({ ok: true });
});

/** Everything a phone needs to keep working with no network: download on station Wi-Fi. */
api.get("/trips/:id/pack", async (req, res) => {
  const u = me(req);
  const trip = await myTrip(u.id, Number(req.params.id));
  if (!trip) return bad(res, "Trip not found", 404);
  const roomList = await roomsFor(u, trip);
  const rooms = await Promise.all(roomList.map(async (r) => ({ ...r, messages: await roomMessages(u, r.id) })));
  const travellers = await travellersFor(u, trip);
  // Keys of everyone on this journey, so the phone can verify mesh messages offline.
  const people = await db
    .prepare("SELECT t.user_id, u.name FROM trips t JOIN users u ON u.id=t.user_id WHERE t.trip_key=?")
    .all<{ user_id: number; name: string | null }>(trip.trip_key);
  const keyRows = await db
    .prepare("SELECT k.user_id, k.pubkey FROM device_keys k JOIN trips t ON t.user_id=k.user_id WHERE t.trip_key=?")
    .all<{ user_id: number; pubkey: string }>(trip.trip_key);
  const keys: Record<number, string[]> = {};
  const names: Record<number, string> = {};
  for (const p of people) {
    keys[p.user_id] = [];
    names[p.user_id] = p.name || "Traveller";
  }
  for (const k of keyRows) keys[k.user_id].push(k.pubkey);
  const blocked = (
    await db.prepare("SELECT blocked_id id FROM blocks WHERE blocker_id=? UNION SELECT blocker_id FROM blocks WHERE blocked_id=?").all<{ id: number }>(u.id, u.id)
  ).map((r) => r.id);
  res.json({
    savedAt: Date.now(),
    trip: { ...(await tripOut(trip)), key: trip.trip_key },
    rooms,
    travellers,
    keys,
    names,
    blocked,
    serverKey: (await serverKeys()).pubkey,
    signal: await signalFor(trip.trip_key),
  });
});

api.post("/signal", async (req, res) => {
  const b = parse(z.object({ tripId: z.number().int(), samples: z.array(z.any()) }), req.body, res);
  if (!b) return;
  const r = await ingestSignal(me(req), b.tripId, b.samples);
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

type OpResult = { ok: boolean; error?: string; data?: unknown };

async function runOp(u: UserRow, raw: unknown): Promise<OpResult> {
  const p = opSchema.safeParse(raw);
  if (!p.success) return { ok: false, error: "Bad operation" };
  const o = p.data;
  try {
    switch (o.op) {
      case "room_msg":
      case "relay": {
        const r = await ingestEnvelope(o.env, u.id);
        return "error" in r ? { ok: false, error: r.error } : { ok: true, data: r.message };
      }
      case "dm_msg": {
        const r = await sendDm(u, o.matchId, o.body, o.uuid);
        return "error" in r ? { ok: false, error: r.error } : { ok: true, data: r.message };
      }
      case "game_answer": {
        const r = await answerGame(o.gameId, u.id, o.answer);
        if ("error" in r) return r.error === "You already answered" ? { ok: true } : { ok: false, error: r.error };
        return { ok: true, data: r.view };
      }
      case "wave": {
        const r = await doWave(u, o.toId, o.tripId);
        return "error" in r ? { ok: false, error: r.error } : { ok: true, data: r };
      }
      case "signal": {
        const r = await ingestSignal(u, o.tripId, o.samples);
        return "error" in r ? { ok: false, error: r.error } : { ok: true, data: r };
      }
    }
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

api.post("/sync", async (req, res) => {
  const u = me(req);
  const b = parse(z.object({ ops: z.array(z.any()).max(500) }), req.body, res);
  if (!b) return;
  // In order, one at a time: messages keep their order and slow mode works as expected.
  const results: OpResult[] = [];
  for (const raw of b.ops) results.push(await runOp(u, raw));
  res.json({ results, serverTime: Date.now() });
});
