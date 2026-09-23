import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { db, publicUser, selfUser, tripKey, isBlocked, type TripRow, type UserRow } from "./db.js";
import { requireAuth, requestOtp, checkOtp, signToken, type AuthedRequest } from "./auth.js";
import { isVisible, vibeScore } from "./vibe.js";
import { makePrompt, viewGame, isComplete, type GameType } from "./games.js";
import { emitToUser, matchPlayers } from "./realtime.js";
import { isDemoUser, demoReplyText, demoGameAnswer } from "./demo.js";

export const api = Router();

export const me = (req: Request) => (req as AuthedRequest).user;
export const bad = (res: Response, msg: string, code = 400) => res.status(code).json({ error: msg });

export function parse<T extends z.ZodTypeAny>(schema: T, body: unknown, res: Response): z.infer<T> | null {
  const r = schema.safeParse(body);
  if (!r.success) {
    bad(res, r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", "));
    return null;
  }
  return r.data;
}

export const getUser = (id: number) => db.prepare("SELECT * FROM users WHERE id=?").get(id) as UserRow | undefined;

function tripFromKey(key: string) {
  const [mode, number, date] = key.split("|");
  return { mode, number, date };
}

// ---------- Auth ----------
const phoneSchema = z.string().regex(/^\+?\d{10,13}$/, "enter a valid phone number");

api.post("/auth/request-otp", (req, res) => {
  const body = parse(z.object({ phone: phoneSchema }), req.body, res);
  if (!body) return;
  const devCode = requestOtp(body.phone);
  res.json({ ok: true, devCode });
});

api.post("/auth/verify", (req, res) => {
  const body = parse(z.object({ phone: phoneSchema, code: z.string().length(6) }), req.body, res);
  if (!body) return;
  if (!checkOtp(body.phone, body.code)) return bad(res, "Wrong or expired code", 401);
  let user = db.prepare("SELECT * FROM users WHERE phone=?").get(body.phone) as UserRow | undefined;
  if (!user) {
    const r = db.prepare("INSERT INTO users (phone) VALUES (?)").run(body.phone);
    user = getUser(Number(r.lastInsertRowid))!;
  }
  res.json({ token: signToken(user.id), user: selfUser(user) });
});

api.use(requireAuth);

// ---------- Profile ----------
api.get("/me", (req, res) => res.json(selfUser(me(req))));

const profileSchema = z.object({
  name: z.string().trim().min(1).max(40),
  age: z.number().int().min(18, "you must be 18 or older").max(99),
  gender: z.enum(["woman", "man", "nonbinary"]),
  city: z.string().trim().max(40).optional().default(""),
  bio: z.string().trim().max(200).optional().default(""),
  interests: z.array(z.string().trim().min(1).max(30)).max(15).default([]),
  intent: z.enum(["friends", "dating", "chat"]).default("friends"),
  showMe: z.enum(["everyone", "women", "men"]).default("everyone"),
  womenOnly: z.boolean().default(false),
  hidden: z.boolean().default(false),
});

api.put("/me", (req, res) => {
  const b = parse(profileSchema, req.body, res);
  if (!b) return;
  if (b.womenOnly && b.gender !== "woman") return bad(res, "Women only mode is for women");
  db.prepare(
    `UPDATE users SET name=?, age=?, gender=?, city=?, bio=?, interests=?, intent=?, show_me=?, women_only=?, hidden=? WHERE id=?`
  ).run(b.name, b.age, b.gender, b.city, b.bio, JSON.stringify(b.interests), b.intent, b.showMe, b.womenOnly ? 1 : 0, b.hidden ? 1 : 0, me(req).id);
  res.json(selfUser(getUser(me(req).id)!));
});

api.delete("/me", (req, res) => {
  // Right to erasure: remove the account and everything linked to it.
  const id = me(req).id;
  db.prepare("DELETE FROM users WHERE id=?").run(id);
  db.prepare("DELETE FROM blocks WHERE blocker_id=? OR blocked_id=?").run(id, id);
  res.json({ ok: true });
});

// ---------- Trips ----------
const tripSchema = z.object({
  mode: z.enum(["train", "flight", "bus", "metro"]),
  number: z.string().trim().min(2).max(20),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  coach: z.string().trim().max(10).optional().default(""),
  intent: z.enum(["friends", "dating", "chat"]).optional(),
  from: z.string().trim().max(40).optional().default(""),
  to: z.string().trim().max(40).optional().default(""),
});

export function tripOut(t: TripRow) {
  const count = (
    db.prepare("SELECT COUNT(DISTINCT user_id) c FROM trips WHERE trip_key=? AND user_id<>?").get(t.trip_key, t.user_id) as { c: number }
  ).c;
  return {
    id: t.id,
    mode: t.mode,
    number: t.number,
    date: t.date,
    coach: t.coach,
    intent: t.intent,
    from: t.from_place,
    to: t.to_place,
    othersOnTrip: count,
  };
}

api.get("/trips", (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const rows = db
    .prepare("SELECT * FROM trips WHERE user_id=? AND date>=? ORDER BY date ASC")
    .all(me(req).id, shiftDate(today, -1)) as TripRow[];
  res.json(rows.map(tripOut));
});

function shiftDate(d: string, days: number) {
  const x = new Date(d + "T00:00:00Z");
  x.setUTCDate(x.getUTCDate() + days);
  return x.toISOString().slice(0, 10);
}

api.post("/trips", (req, res) => {
  const b = parse(tripSchema, req.body, res);
  if (!b) return;
  const u = me(req);
  if (!u.name || !u.age) return bad(res, "Finish your profile first");
  const key = tripKey(b.mode, b.number, b.date);
  const existing = db.prepare("SELECT id FROM trips WHERE user_id=? AND trip_key=?").get(u.id, key);
  if (existing) return bad(res, "You already added this trip");
  const weekCount = (db.prepare("SELECT COUNT(*) c FROM trips WHERE user_id=? AND created_at > datetime('now','-7 days')").get(u.id) as { c: number }).c;
  if (weekCount >= 10) return bad(res, "Trip limit reached for this week");
  const r = db
    .prepare("INSERT INTO trips (user_id, mode, number, date, coach, intent, from_place, to_place, trip_key) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(u.id, b.mode, b.number.toUpperCase(), b.date, b.coach.toUpperCase(), b.intent || u.intent, b.from, b.to, key);
  res.json(tripOut(db.prepare("SELECT * FROM trips WHERE id=?").get(r.lastInsertRowid) as TripRow));
});

api.delete("/trips/:id", (req, res) => {
  db.prepare("DELETE FROM trips WHERE id=? AND user_id=?").run(Number(req.params.id), me(req).id);
  res.json({ ok: true });
});

export function travellersFor(u: UserRow, trip: TripRow) {
  const others = db
    .prepare("SELECT t.* FROM trips t JOIN users u ON u.id=t.user_id WHERE t.trip_key=? AND t.user_id<>?")
    .all(trip.trip_key, u.id) as TripRow[];
  const viewer = { user: u, trip };
  return others
    .map((t) => ({ user: getUser(t.user_id)!, trip: t }))
    .filter((c) => isVisible(viewer, c) && !isBlocked(u.id, c.user.id))
    .map((c) => {
      const v = vibeScore(viewer, c);
      const iWaved = !!db.prepare("SELECT 1 FROM waves WHERE from_id=? AND to_id=? AND trip_key=?").get(u.id, c.user.id, trip.trip_key);
      const theyWaved = !!db.prepare("SELECT 1 FROM waves WHERE from_id=? AND to_id=? AND trip_key=?").get(c.user.id, u.id, trip.trip_key);
      const match = findMatch(u.id, c.user.id, trip.trip_key);
      return {
        user: publicUser(c.user),
        intent: c.trip.intent,
        vibe: v.score,
        shared: v.shared,
        sameCoach: v.sameCoach,
        sameCity: v.sameCity,
        iWaved,
        theyWaved,
        matchId: match?.id ?? null,
      };
    })
    .sort((a, b) => b.vibe - a.vibe);
}

export function myTrip(userId: number, tripId: number) {
  return db.prepare("SELECT * FROM trips WHERE id=? AND user_id=?").get(tripId, userId) as TripRow | undefined;
}

api.get("/trips/:id/travellers", (req, res) => {
  const u = me(req);
  const trip = myTrip(u.id, Number(req.params.id));
  if (!trip) return bad(res, "Trip not found", 404);
  res.json({ trip: tripOut(trip), travellers: travellersFor(u, trip) });
});

// ---------- Waves and matches ----------
function findMatch(a: number, b: number, key: string) {
  const [x, y] = a < b ? [a, b] : [b, a];
  return db.prepare("SELECT * FROM matches WHERE a_id=? AND b_id=? AND trip_key=? AND closed=0").get(x, y, key) as
    | { id: number }
    | undefined;
}

export function doWave(u: UserRow, toId: number, tripId: number): { error: string; code: number } | { matched: boolean; matchId?: number } {
  const trip = myTrip(u.id, tripId);
  if (!trip) return { error: "Trip not found", code: 404 };
  const theirTrip = db.prepare("SELECT * FROM trips WHERE user_id=? AND trip_key=?").get(toId, trip.trip_key) as TripRow | undefined;
  const them = getUser(toId);
  if (!theirTrip || !them) return { error: "That traveller is not on this trip", code: 404 };
  if (isBlocked(u.id, them.id) || !isVisible({ user: u, trip }, { user: them, trip: theirTrip })) return { error: "Not available", code: 403 };

  const recent = (db.prepare("SELECT COUNT(*) c FROM waves WHERE from_id=? AND created_at > datetime('now','-1 hour')").get(u.id) as { c: number }).c;
  if (recent >= 30) return { error: "Slow down a little, try again later", code: 429 };

  db.prepare("INSERT OR IGNORE INTO waves (from_id, to_id, trip_key) VALUES (?,?,?)").run(u.id, them.id, trip.trip_key);
  if (isDemoUser(them.phone)) {
    db.prepare("INSERT OR IGNORE INTO waves (from_id, to_id, trip_key) VALUES (?,?,?)").run(them.id, u.id, trip.trip_key);
  }
  const mutual = db.prepare("SELECT 1 FROM waves WHERE from_id=? AND to_id=? AND trip_key=?").get(them.id, u.id, trip.trip_key);
  if (!mutual) {
    emitToUser(them.id, "wave", { from: publicUser(u), tripId: theirTrip.id });
    return { matched: false };
  }
  let match = findMatch(u.id, them.id, trip.trip_key);
  if (!match) {
    const [x, y] = u.id < them.id ? [u.id, them.id] : [them.id, u.id];
    const r = db.prepare("INSERT INTO matches (a_id, b_id, trip_key) VALUES (?,?,?)").run(x, y, trip.trip_key);
    match = { id: Number(r.lastInsertRowid) };
    db.prepare("INSERT INTO messages (match_id, sender_id, kind, body) VALUES (?,?,?,?)").run(match.id, u.id, "system", "You matched! Say hi or start a game to break the ice.");
  }
  emitToUser(them.id, "match", { matchId: match.id, with: publicUser(u) });
  return { matched: true, matchId: match.id };
}

api.post("/waves", (req, res) => {
  const b = parse(z.object({ toId: z.number().int(), tripId: z.number().int() }), req.body, res);
  if (!b) return;
  const r = doWave(me(req), b.toId, b.tripId);
  if ("error" in r) return bad(res, r.error, r.code);
  res.json(r);
});

function matchOut(m: { id: number; a_id: number; b_id: number; trip_key: string; a_meet: number; b_meet: number }, uid: number) {
  const otherId = m.a_id === uid ? m.b_id : m.a_id;
  const other = getUser(otherId)!;
  const last = db.prepare("SELECT * FROM messages WHERE match_id=? ORDER BY id DESC LIMIT 1").get(m.id) as
    | { body: string; kind: string; created_at: string; sender_id: number }
    | undefined;
  const iMeet = m.a_id === uid ? m.a_meet : m.b_meet;
  const theyMeet = m.a_id === uid ? m.b_meet : m.a_meet;
  return {
    id: m.id,
    with: publicUser(other),
    trip: tripFromKey(m.trip_key),
    lastMessage: last ? { body: last.kind === "game" ? "Started a game" : last.body, at: last.created_at, mine: last.sender_id === uid } : null,
    meet: { me: !!iMeet, them: !!theyMeet, revealed: iMeet && theyMeet ? meetInfo(m, uid) : null },
  };
}

function meetInfo(m: { a_id: number; b_id: number; trip_key: string }, uid: number) {
  const otherId = m.a_id === uid ? m.b_id : m.a_id;
  const t = db.prepare("SELECT coach FROM trips WHERE user_id=? AND trip_key=?").get(otherId, m.trip_key) as { coach: string } | undefined;
  return { theirCoach: t?.coach || "Not shared" };
}

function getMatchFor(req: Request, res: Response) {
  const uid = me(req).id;
  const m = db
    .prepare("SELECT * FROM matches WHERE id=? AND closed=0 AND (a_id=? OR b_id=?)")
    .get(Number(req.params.id), uid, uid) as
    | { id: number; a_id: number; b_id: number; trip_key: string; a_meet: number; b_meet: number }
    | undefined;
  if (!m) {
    bad(res, "Chat not found", 404);
    return null;
  }
  return m;
}

api.get("/matches", (req, res) => {
  const uid = me(req).id;
  const rows = db
    .prepare(
      `SELECT m.* FROM matches m
       LEFT JOIN (SELECT match_id, MAX(id) mx FROM messages GROUP BY match_id) l ON l.match_id=m.id
       WHERE m.closed=0 AND (m.a_id=? OR m.b_id=?) ORDER BY l.mx DESC`
    )
    .all(uid, uid) as Parameters<typeof matchOut>[0][];
  res.json(rows.map((m) => matchOut(m, uid)));
});

api.get("/matches/:id", (req, res) => {
  const m = getMatchFor(req, res);
  if (m) res.json(matchOut(m, me(req).id));
});

type MsgRow = { id: number; match_id: number; sender_id: number; kind: string; body: string; created_at: string; uuid: string | null };

function messageOut(msg: MsgRow, players: number[]) {
  const base = { id: msg.id, uuid: msg.uuid, matchId: msg.match_id, senderId: msg.sender_id, kind: msg.kind, body: msg.body, at: msg.created_at };
  if (msg.kind !== "game") return base;
  const g = db.prepare("SELECT * FROM games WHERE id=?").get(Number(msg.body)) as Parameters<typeof viewGame>[0];
  return { ...base, game: viewGame(g, players) };
}

api.get("/matches/:id/messages", (req, res) => {
  const m = getMatchFor(req, res);
  if (!m) return;
  const rows = db.prepare("SELECT * FROM messages WHERE match_id=? ORDER BY id ASC LIMIT 500").all(m.id) as MsgRow[];
  res.json(rows.map((r) => messageOut(r, [m.a_id, m.b_id])));
});

function pushMessage(matchId: number, senderId: number, kind: string, body: string, players: number[], uuid: string | null = null) {
  if (uuid) {
    const existing = db.prepare("SELECT * FROM messages WHERE uuid=?").get(uuid) as MsgRow | undefined;
    if (existing) return messageOut(existing, players); // idempotent retry from the offline outbox
  }
  const r = db.prepare("INSERT INTO messages (match_id, sender_id, kind, body, uuid) VALUES (?,?,?,?,?)").run(matchId, senderId, kind, body, uuid);
  const row = db.prepare("SELECT * FROM messages WHERE id=?").get(r.lastInsertRowid) as MsgRow;
  for (const p of players) emitToUser(p, "message", messageOut(row, players));
  return messageOut(row, players);
}

export function sendDm(u: UserRow, matchId: number, body: string, uuid: string | null) {
  const m = db.prepare("SELECT * FROM matches WHERE id=? AND closed=0 AND (a_id=? OR b_id=?)").get(matchId, u.id, u.id) as
    | { id: number; a_id: number; b_id: number }
    | undefined;
  if (!m) return { error: "Chat not found" };
  const text = body.trim().slice(0, 1000);
  if (!text) return { error: "Message is empty" };
  const out = pushMessage(m.id, u.id, "text", text, [m.a_id, m.b_id], uuid);
  const other = getUser(m.a_id === u.id ? m.b_id : m.a_id);
  if (other && isDemoUser(other.phone)) {
    setTimeout(() => emitToUser(u.id, "typing", { matchId: m.id, userId: other.id }), 600);
    setTimeout(() => pushMessage(m.id, other.id, "text", demoReplyText(), [m.a_id, m.b_id]), 2000);
  }
  return { message: out };
}

api.post("/matches/:id/messages", (req, res) => {
  const b = parse(z.object({ body: z.string().trim().min(1).max(1000), uuid: z.string().uuid().optional() }), req.body, res);
  if (!b) return;
  const r = sendDm(me(req), Number(req.params.id), b.body, b.uuid ?? null);
  if ("error" in r) return bad(res, r.error!, 404);
  res.json(r.message);
});

// ---------- Games ----------
api.post("/matches/:id/games", (req, res) => {
  const m = getMatchFor(req, res);
  if (!m) return;
  const b = parse(
    z.object({
      type: z.enum(["wyr", "this_or_that", "trivia", "deep_q", "two_truths"]),
      statements: z.array(z.string()).optional(),
      lie: z.number().int().optional(),
    }),
    req.body,
    res
  );
  if (!b) return;
  let prompt;
  try {
    prompt = makePrompt(b.type as GameType, b);
  } catch (e) {
    return bad(res, (e as Error).message);
  }
  const uid = me(req).id;
  const answers = b.type === "two_truths" ? { [uid]: "creator" } : {};
  const r = db
    .prepare("INSERT INTO games (match_id, creator_id, type, prompt, answers) VALUES (?,?,?,?,?)")
    .run(m.id, uid, b.type, JSON.stringify(prompt), JSON.stringify(answers));
  res.json(pushMessage(m.id, uid, "game", String(r.lastInsertRowid), [m.a_id, m.b_id]));
  const other = getUser(m.a_id === uid ? m.b_id : m.a_id);
  if (other && isDemoUser(other.phone)) botPlays(Number(r.lastInsertRowid), other.id);
});

type GameRow = Parameters<typeof viewGame>[0] & { match_id: number };

export function answerGame(gameId: number, uid: number, answer: number | string) {
  const g = db.prepare("SELECT * FROM games WHERE id=?").get(gameId) as GameRow | undefined;
  if (!g) return { error: "Game not found" };
  const players = matchPlayers(g.match_id, uid);
  if (!players) return { error: "Game not found" };
  const answers = JSON.parse(g.answers || "{}");
  if (answers[uid] !== undefined) return { error: "You already answered" };
  if (g.type === "two_truths" && g.creator_id === uid) return { error: "Wait for their guess" };
  answers[uid] = answer;
  db.prepare("UPDATE games SET answers=? WHERE id=?").run(JSON.stringify(answers), g.id);
  const view = viewGame({ ...g, answers: JSON.stringify(answers) }, players);
  for (const p of players) emitToUser(p, "game", { matchId: g.match_id, game: view });
  return { view, players, game: g };
}

function botPlays(gameId: number, botId: number, delay = 2500) {
  setTimeout(() => {
    const g = db.prepare("SELECT * FROM games WHERE id=?").get(gameId) as GameRow | undefined;
    if (g) answerGame(gameId, botId, demoGameAnswer(g.type, JSON.parse(g.prompt)));
  }, delay);
}

api.post("/games/:id/answer", (req, res) => {
  const b = parse(z.object({ answer: z.union([z.number().int(), z.string().trim().min(1).max(300)]) }), req.body, res);
  if (!b) return;
  const r = answerGame(Number(req.params.id), me(req).id, b.answer);
  if ("error" in r) return bad(res, r.error!);
  res.json(r.view);
});

// ---------- Meet up (mutual seat reveal) ----------
api.post("/matches/:id/meet", (req, res) => {
  const m = getMatchFor(req, res);
  if (!m) return;
  const uid = me(req).id;
  const b = parse(z.object({ want: z.boolean() }), req.body, res);
  if (!b) return;
  const col = m.a_id === uid ? "a_meet" : "b_meet";
  db.prepare(`UPDATE matches SET ${col}=? WHERE id=?`).run(b.want ? 1 : 0, m.id);
  const otherUser = getUser(m.a_id === uid ? m.b_id : m.a_id);
  if (b.want && otherUser && isDemoUser(otherUser.phone)) {
    db.prepare(`UPDATE matches SET ${col === "a_meet" ? "b_meet" : "a_meet"}=1 WHERE id=?`).run(m.id);
  }
  const fresh = db.prepare("SELECT * FROM matches WHERE id=?").get(m.id) as typeof m;
  const players = [m.a_id, m.b_id];
  if (fresh.a_meet && fresh.b_meet && b.want) {
    pushMessage(m.id, uid, "system", "You both agreed to meet. Coach details are now visible. Meet in a public area and trust your instincts.", players);
  }
  for (const p of players) emitToUser(p, "meet", matchOut(fresh, p));
  res.json(matchOut(fresh, uid));
});

// ---------- Safety ----------
api.post("/users/:id/block", (req, res) => {
  const uid = me(req).id;
  const other = Number(req.params.id);
  db.prepare("INSERT OR IGNORE INTO blocks (blocker_id, blocked_id) VALUES (?,?)").run(uid, other);
  const closed = db
    .prepare("SELECT id FROM matches WHERE closed=0 AND ((a_id=? AND b_id=?) OR (a_id=? AND b_id=?))")
    .all(uid, other, other, uid) as { id: number }[];
  db.prepare("UPDATE matches SET closed=1 WHERE (a_id=? AND b_id=?) OR (a_id=? AND b_id=?)").run(uid, other, other, uid);
  for (const c of closed) {
    emitToUser(uid, "match:closed", { matchId: c.id });
    emitToUser(other, "match:closed", { matchId: c.id });
  }
  res.json({ ok: true });
});

api.post("/users/:id/report", (req, res) => {
  const uid = me(req).id;
  const other = Number(req.params.id);
  const b = parse(z.object({ reason: z.string().trim().min(1).max(500) }), req.body, res);
  if (!b) return;
  db.prepare("INSERT INTO reports (reporter_id, reported_id, reason) VALUES (?,?,?)").run(uid, other, b.reason);
  const distinct = (db.prepare("SELECT COUNT(DISTINCT reporter_id) c FROM reports WHERE reported_id=?").get(other) as { c: number }).c;
  if (distinct >= 3) db.prepare("UPDATE users SET hidden=1 WHERE id=?").run(other); // auto hide pending review
  res.json({ ok: true });
});
