// Cab sharing after the journey. Someone posts where they are headed after
// arrival; co-travellers ask to join; the owner accepts. Accepted people get a
// private cab group chat that stays open after the trip, so the bond can continue.
import { z } from "zod";
import { db, isBlocked, publicUser, type UserRow } from "./db.js";
import { api, me, bad, parse, getUser, myTrip } from "./routes.js";
import { emitToUser } from "./realtime.js";
import { roomOut, type RoomRow } from "./rooms.js";
import { limit } from "./limits.js";
import { track } from "./events.js";
import { notify } from "./push.js";

type Cab = {
  id: number;
  trip_key: string;
  owner_id: number;
  drop_area: string;
  leave_when: string;
  seats: number;
  women_only: number;
  note: string | null;
  fare: number | null;
  vehicle: string | null;
  status: "open" | "closed";
  room_id: number;
  created_at: string;
};
type Member = { user_id: number; status: "pending" | "accepted" | "declined" };

const words = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2));
/** Rough "same direction" score from the drop area names (0..1). */
function similarity(a: string, b: string) {
  const A = words(a), B = words(b);
  if (!A.size || !B.size) return 0;
  const shared = [...A].filter((w) => B.has(w)).length;
  return shared / Math.min(A.size, B.size);
}

async function members(cabId: number) {
  return db.prepare("SELECT user_id, status FROM cab_members WHERE cab_id=? ORDER BY created_at").all<Member>(cabId);
}

async function cabView(c: Cab, viewer: UserRow, myDrop?: string) {
  const ms = await members(c.id);
  const accepted = ms.filter((m) => m.status === "accepted" && m.user_id !== c.owner_id);
  const owner = await getUser(c.owner_id);
  const isOwner = viewer.id === c.owner_id;
  const mine = ms.find((m) => m.user_id === viewer.id)?.status ?? (isOwner ? "owner" : null);
  const inGroup = isOwner || mine === "accepted";
  const people = inGroup
    ? await Promise.all(accepted.map(async (m) => publicUser((await getUser(m.user_id))!)))
    : [];
  const requests = isOwner
    ? await Promise.all(ms.filter((m) => m.status === "pending").map(async (m) => publicUser((await getUser(m.user_id))!)))
    : [];
  const riders = accepted.length + 1;
  return {
    id: c.id,
    owner: owner ? publicUser(owner) : null,
    dropArea: c.drop_area,
    leaveWhen: c.leave_when,
    seats: c.seats,
    seatsLeft: Math.max(0, c.seats - accepted.length),
    womenOnly: !!c.women_only,
    note: c.note,
    status: c.status,
    mine, // 'owner' | 'pending' | 'accepted' | 'declined' | null
    riders,
    people, // accepted co-riders (only shown to the group)
    requests, // pending requests (only shown to the owner)
    fare: c.fare,
    perPerson: c.fare ? Math.ceil(c.fare / riders) : null,
    vehicle: inGroup ? c.vehicle : null,
    roomId: inGroup ? c.room_id : null,
    match: myDrop ? Math.round(similarity(myDrop, c.drop_area) * 100) : null,
  };
}

async function visible(c: Cab, u: UserRow) {
  if (c.owner_id === u.id) return true;
  if (c.women_only && u.gender !== "woman") return false;
  return !(await isBlocked(u.id, c.owner_id));
}

const loadCab = (id: number) => db.prepare("SELECT * FROM cab_shares WHERE id=?").get<Cab>(id);

async function notifyGroup(c: Cab, event: string) {
  const ms = await members(c.id);
  const ids = new Set([c.owner_id, ...ms.filter((m) => m.status !== "declined").map((m) => m.user_id)]);
  for (const id of ids) emitToUser(id, event, { cabId: c.id, tripKey: c.trip_key });
}

// ---------- routes ----------
api.get("/trips/:id/cabs", async (req, res) => {
  const u = me(req);
  const trip = await myTrip(u.id, Number(req.params.id));
  if (!trip) return bad(res, "Trip not found", 404);
  const rows = await db.prepare("SELECT * FROM cab_shares WHERE trip_key=? AND status='open' ORDER BY id DESC").all<Cab>(trip.trip_key);
  const mine = rows.find((c) => c.owner_id === u.id);
  const out = [];
  for (const c of rows) if (await visible(c, u)) out.push(await cabView(c, u, mine?.drop_area));
  // same direction first, then newest
  out.sort((a, b) => (a.mine === "owner" ? -1 : b.mine === "owner" ? 1 : (b.match ?? 0) - (a.match ?? 0)));
  res.json(out);
});

const postSchema = z.object({
  dropArea: z.string().trim().min(2).max(80),
  leaveWhen: z.string().trim().min(2).max(40),
  seats: z.number().int().min(1).max(6),
  womenOnly: z.boolean().default(false),
  note: z.string().trim().max(200).optional().default(""),
});

api.post("/trips/:id/cabs", limit("cabpost", 5, 24 * 3600_000), async (req, res) => {
  const u = me(req);
  const trip = await myTrip(u.id, Number(req.params.id));
  if (!trip) return bad(res, "Trip not found", 404);
  const b = parse(postSchema, req.body, res);
  if (!b) return;
  if (b.womenOnly && u.gender !== "woman") return bad(res, "Women only rides can be posted by women");
  const existing = await db.prepare("SELECT id FROM cab_shares WHERE trip_key=? AND owner_id=? AND status='open'").get(trip.trip_key, u.id);
  if (existing) return bad(res, "You already have a cab share on this trip");
  const room = await db
    .prepare("INSERT INTO rooms (trip_key, kind, coach, name, created_by) VALUES (?,?,?,?,?) RETURNING *")
    .get<RoomRow>(trip.trip_key, "cab", `cab-${u.id}-${Date.now()}`, `Cab to ${b.dropArea}`.slice(0, 40), u.id);
  const cab = await db
    .prepare(
      "INSERT INTO cab_shares (trip_key, owner_id, drop_area, leave_when, seats, women_only, note, room_id) VALUES (?,?,?,?,?,?,?,?) RETURNING *"
    )
    .get<Cab>(trip.trip_key, u.id, b.dropArea, b.leaveWhen, b.seats, b.womenOnly ? 1 : 0, b.note, room!.id);
  track(u.id, "cab_posted");
  res.json(await cabView(cab!, u));
});

api.post("/cabs/:id/request", limit("cabreq", 20, 3600_000), async (req, res) => {
  const u = me(req);
  const c = await loadCab(Number(req.params.id));
  if (!c || c.status !== "open" || !(await visible(c, u))) return bad(res, "Cab not found", 404);
  if (c.owner_id === u.id) return bad(res, "This is your cab");
  const onTrip = await db.prepare("SELECT 1 FROM trips WHERE user_id=? AND trip_key=?").get(u.id, c.trip_key);
  if (!onTrip) return bad(res, "You are not on this journey", 403);
  await db.prepare("INSERT INTO cab_members (cab_id, user_id, status) VALUES (?,?,'pending') ON CONFLICT (cab_id, user_id) DO NOTHING").run(c.id, u.id);
  emitToUser(c.owner_id, "cab:request", { cabId: c.id, from: publicUser(u), tripKey: c.trip_key });
  const ownerTrip = await db.prepare("SELECT id FROM trips WHERE user_id=? AND trip_key=?").get<{ id: number }>(c.owner_id, c.trip_key);
  notify(c.owner_id, { title: `🚕 ${u.name} wants to share your cab`, body: `To ${c.drop_area}. Open the Cab tab to accept.`, url: ownerTrip ? `/trips/${ownerTrip.id}` : "/", tag: `cab-${c.id}` }, { ifAppHidden: true });
  track(u.id, "cab_requested");
  res.json(await cabView(c, u));
});

api.post("/cabs/:id/respond", async (req, res) => {
  const u = me(req);
  const b = parse(z.object({ userId: z.number().int(), accept: z.boolean() }), req.body, res);
  if (!b) return;
  const c = await loadCab(Number(req.params.id));
  if (!c || c.owner_id !== u.id) return bad(res, "Only the person who posted can accept", 403);
  if (b.accept) {
    const count = await db.prepare("SELECT COUNT(*) c FROM cab_members WHERE cab_id=? AND status='accepted'").get<{ c: number }>(c.id);
    if ((count?.c ?? 0) >= c.seats) return bad(res, "No seats left");
  }
  await db.prepare("UPDATE cab_members SET status=? WHERE cab_id=? AND user_id=?").run(b.accept ? "accepted" : "declined", c.id, b.userId);
  emitToUser(b.userId, "cab:update", { cabId: c.id, tripKey: c.trip_key, accepted: b.accept });
  if (b.accept) {
    notify(b.userId, { title: "🚕 You're in the cab!", body: `${u.name} accepted you for the ride to ${c.drop_area}.`, url: `/groups/${c.room_id}`, tag: `cab-${c.id}` }, { ifAppHidden: true });
    track(u.id, "cab_accepted");
  } else {
    notify(b.userId, { title: "🚕 Cab share update", body: `The ride to ${c.drop_area} is full or not a match this time. Check other cabs on your trip.`, url: "/", tag: `cab-${c.id}` }, { ifAppHidden: true });
  }
  await notifyGroup(c, "cab:update");
  res.json(await cabView(c, u));
});

api.post("/cabs/:id/leave", async (req, res) => {
  const u = me(req);
  const c = await loadCab(Number(req.params.id));
  if (!c) return bad(res, "Cab not found", 404);
  if (c.owner_id === u.id) {
    await db.prepare("UPDATE cab_shares SET status='closed' WHERE id=?").run(c.id);
  } else {
    await db.prepare("DELETE FROM cab_members WHERE cab_id=? AND user_id=?").run(c.id, u.id);
  }
  await notifyGroup(c, "cab:update");
  res.json({ ok: true });
});

/** Owner sets the fare (shown split per person) and the cab number (for sharing ride details). */
api.post("/cabs/:id/details", async (req, res) => {
  const u = me(req);
  const b = parse(
    z.object({ fare: z.number().int().min(0).max(100000).nullable().optional(), vehicle: z.string().trim().max(20).nullable().optional() }),
    req.body,
    res
  );
  if (!b) return;
  const c = await loadCab(Number(req.params.id));
  if (!c || c.owner_id !== u.id) return bad(res, "Only the person who posted can change this", 403);
  await db
    .prepare("UPDATE cab_shares SET fare=?, vehicle=? WHERE id=?")
    .run(b.fare === undefined ? c.fare : b.fare, b.vehicle === undefined ? c.vehicle : b.vehicle?.toUpperCase() || null, c.id);
  const fresh = (await loadCab(c.id))!;
  await notifyGroup(fresh, "cab:update");
  res.json(await cabView(fresh, u));
});

/** Cab groups I'm in, including past trips: the chat stays open. */
api.get("/cabs/mine", async (req, res) => {
  const u = me(req);
  const rows = await db
    .prepare(
      `SELECT c.* FROM cab_shares c LEFT JOIN cab_members m ON m.cab_id=c.id AND m.user_id=?
       WHERE c.owner_id=? OR m.status='accepted' ORDER BY c.id DESC LIMIT 30`
    )
    .all<Cab>(u.id, u.id);
  const out = [];
  for (const c of rows) {
    const room = await db.prepare("SELECT * FROM rooms WHERE id=?").get<RoomRow>(c.room_id);
    out.push({ ...(await cabView(c, u)), room: room ? await roomOut(room) : null });
  }
  res.json(out);
});
