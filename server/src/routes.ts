import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { db, publicUser, selfUser, tripKey, isBlocked, type TripRow, type UserRow } from "./db.js";
import { requireAuth, requestOtp, checkOtp, signToken, verifyFirebaseToken, firebaseConfig, DEV_OTP, type AuthedRequest } from "./auth.js";
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

export const getUser = (id: number) => db.prepare("SELECT * FROM users WHERE id=?").get<UserRow>(id);

function tripFromKey(key: string) {
  const [mode, number, date] = key.split("|");
  return { mode, number, date };
}

// ---------- Auth ----------
const phoneSchema = z.string().regex(/^\+?\d{10,13}$/, "enter a valid phone number");

/** Public: tells the app which login to use (Firebase SMS in production, dev code locally). */
api.get("/config", (_req, res) => {
  res.json({ firebase: firebaseConfig() });
});

async function loginByPhone(phone: string) {
  let user = await db.prepare("SELECT * FROM users WHERE phone=?").get<UserRow>(phone);
  if (!user) {
    const r = await db.prepare("INSERT INTO users (phone) VALUES (?) ON CONFLICT (phone) DO NOTHING RETURNING id").get<{ id: number }>(phone);
    user = r ? await getUser(r.id) : await db.prepare("SELECT * FROM users WHERE phone=?").get<UserRow>(phone);
  }
  return { token: signToken(user!.id), user: selfUser(user!) };
}

api.post("/auth/request-otp", async (req, res) => {
  if (firebaseConfig()) return bad(res, "Use phone sign in from the app");
  if (!DEV_OTP) return bad(res, "Login is not set up yet: add the FIREBASE_* settings on the server.", 503);
  const body = parse(z.object({ phone: phoneSchema }), req.body, res);
  if (!body) return;
  const devCode = await requestOtp(body.phone);
  res.json({ ok: true, devCode });
});

api.post("/auth/verify", async (req, res) => {
  if (firebaseConfig()) return bad(res, "Use phone sign in from the app");
  const body = parse(z.object({ phone: phoneSchema, code: z.string().length(6) }), req.body, res);
  if (!body) return;
  if (!(await checkOtp(body.phone, body.code))) return bad(res, "Wrong or expired code", 401);
  res.json(await loginByPhone(body.phone));
});

/** Firebase phone login: the app sends the Firebase ID token, we check it with Google's keys. */
api.post("/auth/firebase", async (req, res) => {
  const body = parse(z.object({ idToken: z.string().min(20) }), req.body, res);
  if (!body) return;
  const phone = await verifyFirebaseToken(body.idToken);
  if (!phone) return bad(res, "Phone verification failed, please try again", 401);
  res.json(await loginByPhone(phone.replace(/^\+91/, "")));
});

api.use(requireAuth);

// ---------- Profile ----------
api.get("/me", (req, res) => {
  res.json(selfUser(me(req)));
});

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

api.put("/me", async (req, res) => {
  const b = parse(profileSchema, req.body, res);
  if (!b) return;
  if (b.womenOnly && b.gender !== "woman") return bad(res, "Women only mode is for women");
  await db
    .prepare(`UPDATE users SET name=?, age=?, gender=?, city=?, bio=?, interests=?, intent=?, show_me=?, women_only=?, hidden=? WHERE id=?`)
    .run(b.name, b.age, b.gender, b.city, b.bio, JSON.stringify(b.interests), b.intent, b.showMe, b.womenOnly ? 1 : 0, b.hidden ? 1 : 0, me(req).id);
  res.json(selfUser((await getUser(me(req).id))!));
});

api.delete("/me", async (req, res) => {
  // Right to erasure: remove the account and everything linked to it.
  const id = me(req).id;
  await db.prepare("DELETE FROM blocks WHERE blocker_id=? OR blocked_id=?").run(id, id);
  await db.prepare("DELETE FROM users WHERE id=?").run(id);
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

export async function tripOut(t: TripRow) {
  const r = await db.prepare("SELECT COUNT(DISTINCT user_id) c FROM trips WHERE trip_key=? AND user_id<>?").get<{ c: number }>(t.trip_key, t.user_id);
  return {
    id: t.id,
    mode: t.mode,
    number: t.number,
    date: t.date,
    coach: t.coach,
    intent: t.intent,
    from: t.from_place,
    to: t.to_place,
    othersOnTrip: r?.c ?? 0,
  };
}

function shiftDate(d: string, days: number) {
  const x = new Date(d + "T00:00:00Z");
  x.setUTCDate(x.getUTCDate() + days);
  return x.toISOString().slice(0, 10);
}

api.get("/trips", async (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const rows = await db.prepare("SELECT * FROM trips WHERE user_id=? AND date>=? ORDER BY date ASC").all<TripRow>(me(req).id, shiftDate(today, -1));
  res.json(await Promise.all(rows.map(tripOut)));
});

api.post("/trips", async (req, res) => {
  const b = parse(tripSchema, req.body, res);
  if (!b) return;
  const u = me(req);
  if (!u.name || !u.age) return bad(res, "Finish your profile first");
  const key = tripKey(b.mode, b.number, b.date);
  const existing = await db.prepare("SELECT id FROM trips WHERE user_id=? AND trip_key=?").get(u.id, key);
  if (existing) return bad(res, "You already added this trip");
  const week = await db.prepare("SELECT COUNT(*) c FROM trips WHERE user_id=? AND created_at > now() - interval '7 days'").get<{ c: number }>(u.id);
  if ((week?.c ?? 0) >= 10) return bad(res, "Trip limit reached for this week");
  const trip = await db
    .prepare("INSERT INTO trips (user_id, mode, number, date, coach, intent, from_place, to_place, trip_key) VALUES (?,?,?,?,?,?,?,?,?) RETURNING *")
    .get<TripRow>(u.id, b.mode, b.number.toUpperCase(), b.date, b.coach.toUpperCase(), b.intent || u.intent, b.from, b.to, key);
  res.json(await tripOut(trip!));
});

api.delete("/trips/:id", async (req, res) => {
  await db.prepare("DELETE FROM trips WHERE id=? AND user_id=?").run(Number(req.params.id), me(req).id);
  res.json({ ok: true });
});

export async function travellersFor(u: UserRow, trip: TripRow) {
  const others = await db
    .prepare("SELECT t.* FROM trips t JOIN users u ON u.id=t.user_id WHERE t.trip_key=? AND t.user_id<>?")
    .all<TripRow>(trip.trip_key, u.id);
  const viewer = { user: u, trip };
  const out = [];
  for (const t of others) {
    const user = await getUser(t.user_id);
    if (!user) continue;
    const c = { user, trip: t };
    if (!isVisible(viewer, c) || (await isBlocked(u.id, user.id))) continue;
    const v = vibeScore(viewer, c);
    const iWaved = !!(await db.prepare("SELECT 1 FROM waves WHERE from_id=? AND to_id=? AND trip_key=?").get(u.id, user.id, trip.trip_key));
    const theyWaved = !!(await db.prepare("SELECT 1 FROM waves WHERE from_id=? AND to_id=? AND trip_key=?").get(user.id, u.id, trip.trip_key));
    const match = await findMatch(u.id, user.id, trip.trip_key);
    out.push({
      user: publicUser(user),
      intent: t.intent,
      vibe: v.score,
      shared: v.shared,
      sameCoach: v.sameCoach,
      sameCity: v.sameCity,
      iWaved,
      theyWaved,
      matchId: match?.id ?? null,
    });
  }
  return out.sort((a, b) => b.vibe - a.vibe);
}

export function myTrip(userId: number, tripId: number) {
  return db.prepare("SELECT * FROM trips WHERE id=? AND user_id=?").get<TripRow>(tripId, userId);
}

api.get("/trips/:id/travellers", async (req, res) => {
  const u = me(req);
  const trip = await myTrip(u.id, Number(req.params.id));
  if (!trip) return bad(res, "Trip not found", 404);
  res.json({ trip: await tripOut(trip), travellers: await travellersFor(u, trip) });
});

// ---------- Waves and matches ----------
function findMatch(a: number, b: number, key: string) {
  const [x, y] = a < b ? [a, b] : [b, a];
  return db.prepare("SELECT * FROM matches WHERE a_id=? AND b_id=? AND trip_key=? AND closed=0").get<{ id: number }>(x, y, key);
}

export async function doWave(u: UserRow, toId: number, tripId: number): Promise<{ error: string; code: number } | { matched: boolean; matchId?: number }> {
  const trip = await myTrip(u.id, tripId);
  if (!trip) return { error: "Trip not found", code: 404 };
  const theirTrip = await db.prepare("SELECT * FROM trips WHERE user_id=? AND trip_key=?").get<TripRow>(toId, trip.trip_key);
  const them = await getUser(toId);
  if (!theirTrip || !them) return { error: "That traveller is not on this trip", code: 404 };
  if ((await isBlocked(u.id, them.id)) || !isVisible({ user: u, trip }, { user: them, trip: theirTrip })) return { error: "Not available", code: 403 };

  const recent = await db.prepare("SELECT COUNT(*) c FROM waves WHERE from_id=? AND created_at > now() - interval '1 hour'").get<{ c: number }>(u.id);
  if ((recent?.c ?? 0) >= 30) return { error: "Slow down a little, try again later", code: 429 };

  await db.prepare("INSERT INTO waves (from_id, to_id, trip_key) VALUES (?,?,?) ON CONFLICT DO NOTHING").run(u.id, them.id, trip.trip_key);
  if (isDemoUser(them.phone)) {
    await db.prepare("INSERT INTO waves (from_id, to_id, trip_key) VALUES (?,?,?) ON CONFLICT DO NOTHING").run(them.id, u.id, trip.trip_key);
  }
  const mutual = await db.prepare("SELECT 1 FROM waves WHERE from_id=? AND to_id=? AND trip_key=?").get(them.id, u.id, trip.trip_key);
  if (!mutual) {
    emitToUser(them.id, "wave", { from: publicUser(u), tripId: theirTrip.id });
    return { matched: false };
  }
  let match = await findMatch(u.id, them.id, trip.trip_key);
  if (!match) {
    const [x, y] = u.id < them.id ? [u.id, them.id] : [them.id, u.id];
    match = await db
      .prepare("INSERT INTO matches (a_id, b_id, trip_key) VALUES (?,?,?) ON CONFLICT (a_id, b_id, trip_key) DO UPDATE SET closed=0 RETURNING id")
      .get<{ id: number }>(x, y, trip.trip_key);
    await db.prepare("INSERT INTO messages (match_id, sender_id, kind, body) VALUES (?,?,?,?)").run(match!.id, u.id, "system", "You matched! Say hi or start a game to break the ice.");
  }
  emitToUser(them.id, "match", { matchId: match!.id, with: publicUser(u) });
  return { matched: true, matchId: match!.id };
}

api.post("/waves", async (req, res) => {
  const b = parse(z.object({ toId: z.number().int(), tripId: z.number().int() }), req.body, res);
  if (!b) return;
  const r = await doWave(me(req), b.toId, b.tripId);
  if ("error" in r) return bad(res, r.error, r.code);
  res.json(r);
});

type MatchRow = { id: number; a_id: number; b_id: number; trip_key: string; a_meet: number; b_meet: number };

async function matchOut(m: MatchRow, uid: number) {
  const otherId = m.a_id === uid ? m.b_id : m.a_id;
  const other = (await getUser(otherId))!;
  const last = await db
    .prepare("SELECT * FROM messages WHERE match_id=? ORDER BY id DESC LIMIT 1")
    .get<{ body: string; kind: string; created_at: string; sender_id: number }>(m.id);
  const iMeet = m.a_id === uid ? m.a_meet : m.b_meet;
  const theyMeet = m.a_id === uid ? m.b_meet : m.a_meet;
  return {
    id: m.id,
    with: publicUser(other),
    trip: tripFromKey(m.trip_key),
    lastMessage: last ? { body: last.kind === "game" ? "Started a game" : last.body, at: last.created_at, mine: last.sender_id === uid } : null,
    meet: { me: !!iMeet, them: !!theyMeet, revealed: iMeet && theyMeet ? await meetInfo(m, uid) : null },
  };
}

async function meetInfo(m: { a_id: number; b_id: number; trip_key: string }, uid: number) {
  const otherId = m.a_id === uid ? m.b_id : m.a_id;
  const t = await db.prepare("SELECT coach FROM trips WHERE user_id=? AND trip_key=?").get<{ coach: string }>(otherId, m.trip_key);
  return { theirCoach: t?.coach || "Not shared" };
}

async function getMatchFor(req: Request, res: Response) {
  const uid = me(req).id;
  const m = await db.prepare("SELECT * FROM matches WHERE id=? AND closed=0 AND (a_id=? OR b_id=?)").get<MatchRow>(Number(req.params.id), uid, uid);
  if (!m) {
    bad(res, "Chat not found", 404);
    return null;
  }
  return m;
}

api.get("/matches", async (req, res) => {
  const uid = me(req).id;
  const rows = await db
    .prepare(
      `SELECT m.* FROM matches m
       LEFT JOIN (SELECT match_id, MAX(id) mx FROM messages GROUP BY match_id) l ON l.match_id=m.id
       WHERE m.closed=0 AND (m.a_id=? OR m.b_id=?) ORDER BY l.mx DESC NULLS LAST`
    )
    .all<MatchRow>(uid, uid);
  res.json(await Promise.all(rows.map((m) => matchOut(m, uid))));
});

api.get("/matches/:id", async (req, res) => {
  const m = await getMatchFor(req, res);
  if (m) res.json(await matchOut(m, me(req).id));
});

type MsgRow = { id: number; match_id: number; sender_id: number; kind: string; body: string; created_at: string; uuid: string | null };

async function messageOut(msg: MsgRow, players: number[]) {
  const base = { id: msg.id, uuid: msg.uuid, matchId: msg.match_id, senderId: msg.sender_id, kind: msg.kind, body: msg.body, at: msg.created_at };
  if (msg.kind !== "game") return base;
  const g = await db.prepare("SELECT * FROM games WHERE id=?").get<Parameters<typeof viewGame>[0]>(Number(msg.body));
  return { ...base, game: viewGame(g!, players) };
}

api.get("/matches/:id/messages", async (req, res) => {
  const m = await getMatchFor(req, res);
  if (!m) return;
  const rows = await db.prepare("SELECT * FROM messages WHERE match_id=? ORDER BY id ASC LIMIT 500").all<MsgRow>(m.id);
  res.json(await Promise.all(rows.map((r) => messageOut(r, [m.a_id, m.b_id]))));
});

async function pushMessage(matchId: number, senderId: number, kind: string, body: string, players: number[], uuid: string | null = null) {
  if (uuid) {
    const existing = await db.prepare("SELECT * FROM messages WHERE uuid=?").get<MsgRow>(uuid);
    if (existing) return messageOut(existing, players); // idempotent retry from the offline outbox
  }
  const row = await db
    .prepare("INSERT INTO messages (match_id, sender_id, kind, body, uuid) VALUES (?,?,?,?,?) RETURNING *")
    .get<MsgRow>(matchId, senderId, kind, body, uuid);
  const out = await messageOut(row!, players);
  for (const p of players) emitToUser(p, "message", out);
  return out;
}

export async function sendDm(u: UserRow, matchId: number, body: string, uuid: string | null) {
  const m = await db.prepare("SELECT * FROM matches WHERE id=? AND closed=0 AND (a_id=? OR b_id=?)").get<MatchRow>(matchId, u.id, u.id);
  if (!m) return { error: "Chat not found" };
  const text = body.trim().slice(0, 1000);
  if (!text) return { error: "Message is empty" };
  const out = await pushMessage(m.id, u.id, "text", text, [m.a_id, m.b_id], uuid);
  const other = await getUser(m.a_id === u.id ? m.b_id : m.a_id);
  if (other && isDemoUser(other.phone)) {
    setTimeout(() => emitToUser(u.id, "typing", { matchId: m.id, userId: other.id }), 600);
    setTimeout(() => pushMessage(m.id, other.id, "text", demoReplyText(), [m.a_id, m.b_id]).catch(console.error), 2000);
  }
  return { message: out };
}

api.post("/matches/:id/messages", async (req, res) => {
  const b = parse(z.object({ body: z.string().trim().min(1).max(1000), uuid: z.string().uuid().optional() }), req.body, res);
  if (!b) return;
  const r = await sendDm(me(req), Number(req.params.id), b.body, b.uuid ?? null);
  if ("error" in r) return bad(res, r.error!, 404);
  res.json(r.message);
});

// ---------- Games ----------
api.post("/matches/:id/games", async (req, res) => {
  const m = await getMatchFor(req, res);
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
  const g = await db
    .prepare("INSERT INTO games (match_id, creator_id, type, prompt, answers) VALUES (?,?,?,?,?) RETURNING id")
    .get<{ id: number }>(m.id, uid, b.type, JSON.stringify(prompt), JSON.stringify(answers));
  res.json(await pushMessage(m.id, uid, "game", String(g!.id), [m.a_id, m.b_id]));
  const other = await getUser(m.a_id === uid ? m.b_id : m.a_id);
  if (other && isDemoUser(other.phone)) botPlays(g!.id, other.id);
});

type GameRow = Parameters<typeof viewGame>[0] & { match_id: number };

export async function answerGame(gameId: number, uid: number, answer: number | string) {
  const g = await db.prepare("SELECT * FROM games WHERE id=?").get<GameRow>(gameId);
  if (!g) return { error: "Game not found" };
  const players = await matchPlayers(g.match_id, uid);
  if (!players) return { error: "Game not found" };
  const answers = JSON.parse(g.answers || "{}");
  if (answers[uid] !== undefined) return { error: "You already answered" };
  if (g.type === "two_truths" && g.creator_id === uid) return { error: "Wait for their guess" };
  answers[uid] = answer;
  await db.prepare("UPDATE games SET answers=? WHERE id=?").run(JSON.stringify(answers), g.id);
  const view = viewGame({ ...g, answers: JSON.stringify(answers) }, players);
  for (const p of players) emitToUser(p, "game", { matchId: g.match_id, game: view });
  if (isComplete(g.type as GameType, answers, g.creator_id, players)) {
    // clients render the reveal
  }
  return { view, players, game: g };
}

function botPlays(gameId: number, botId: number, delay = 2500) {
  setTimeout(async () => {
    try {
      const g = await db.prepare("SELECT * FROM games WHERE id=?").get<GameRow>(gameId);
      if (g) await answerGame(gameId, botId, demoGameAnswer(g.type, JSON.parse(g.prompt)));
    } catch (e) {
      console.error(e);
    }
  }, delay);
}

api.post("/games/:id/answer", async (req, res) => {
  const b = parse(z.object({ answer: z.union([z.number().int(), z.string().trim().min(1).max(300)]) }), req.body, res);
  if (!b) return;
  const r = await answerGame(Number(req.params.id), me(req).id, b.answer);
  if ("error" in r) return bad(res, r.error!);
  res.json(r.view);
});

// ---------- Meet up (mutual seat reveal) ----------
api.post("/matches/:id/meet", async (req, res) => {
  const m = await getMatchFor(req, res);
  if (!m) return;
  const uid = me(req).id;
  const b = parse(z.object({ want: z.boolean() }), req.body, res);
  if (!b) return;
  const col = m.a_id === uid ? "a_meet" : "b_meet";
  await db.prepare(`UPDATE matches SET ${col}=? WHERE id=?`).run(b.want ? 1 : 0, m.id);
  const otherUser = await getUser(m.a_id === uid ? m.b_id : m.a_id);
  if (b.want && otherUser && isDemoUser(otherUser.phone)) {
    await db.prepare(`UPDATE matches SET ${col === "a_meet" ? "b_meet" : "a_meet"}=1 WHERE id=?`).run(m.id);
  }
  const fresh = (await db.prepare("SELECT * FROM matches WHERE id=?").get<MatchRow>(m.id))!;
  const players = [m.a_id, m.b_id];
  if (fresh.a_meet && fresh.b_meet && b.want) {
    await pushMessage(m.id, uid, "system", "You both agreed to meet. Coach details are now visible. Meet in a public area and trust your instincts.", players);
  }
  for (const p of players) emitToUser(p, "meet", await matchOut(fresh, p));
  res.json(await matchOut(fresh, uid));
});

// ---------- Safety ----------
api.post("/users/:id/block", async (req, res) => {
  const uid = me(req).id;
  const other = Number(req.params.id);
  await db.prepare("INSERT INTO blocks (blocker_id, blocked_id) VALUES (?,?) ON CONFLICT DO NOTHING").run(uid, other);
  const closed = await db
    .prepare("SELECT id FROM matches WHERE closed=0 AND ((a_id=? AND b_id=?) OR (a_id=? AND b_id=?))")
    .all<{ id: number }>(uid, other, other, uid);
  await db.prepare("UPDATE matches SET closed=1 WHERE (a_id=? AND b_id=?) OR (a_id=? AND b_id=?)").run(uid, other, other, uid);
  for (const c of closed) {
    emitToUser(uid, "match:closed", { matchId: c.id });
    emitToUser(other, "match:closed", { matchId: c.id });
  }
  res.json({ ok: true });
});

api.post("/users/:id/report", async (req, res) => {
  const uid = me(req).id;
  const other = Number(req.params.id);
  const b = parse(z.object({ reason: z.string().trim().min(1).max(500) }), req.body, res);
  if (!b) return;
  await db.prepare("INSERT INTO reports (reporter_id, reported_id, reason) VALUES (?,?,?)").run(uid, other, b.reason);
  const distinct = await db.prepare("SELECT COUNT(DISTINCT reporter_id) c FROM reports WHERE reported_id=?").get<{ c: number }>(other);
  if ((distinct?.c ?? 0) >= 3) await db.prepare("UPDATE users SET hidden=1 WHERE id=?").run(other); // auto hide pending review
  res.json({ ok: true });
});
