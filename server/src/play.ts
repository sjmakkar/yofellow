// Multiplayer board games. The server is the referee: every move is checked with
// the same rules the app uses, then sent live to all players.
//  - In a private chat: both people are seated and the game starts at once.
//  - On a journey: an open table anyone on the same trip can join (Ludo up to 4).
//  - Empty seats can be filled with computer players.
import { z } from "zod";
import { db, isBlocked, type UserRow } from "./db.js";
import { api, me, bad, parse, getUser, myTrip, pushMessage } from "./routes.js";
import { emitToUser, emitToRoom } from "./realtime.js";
import { isDemoUser } from "./demo.js";
import { ENGINES } from "../../shared/games/index.js";
import { limit } from "./limits.js";
import { track } from "./events.js";
import { notify } from "./push.js";

type Seat = { user: number | null; name: string; bot: boolean };
type Row = {
  id: number;
  kind: string;
  trip_key: string | null;
  match_id: number | null;
  seats: string;
  max_players: number;
  women_only: number;
  state: string | null;
  status: "waiting" | "active" | "done";
  winners: string;
  result_text: string | null;
  version: number;
  created_by: number;
  updated_at: string;
};

const rng = () => Math.random();
const BOT_NAMES = ["Chotu (computer)", "Pinky (computer)", "Bablu (computer)"];

function view(r: Row) {
  const seats = JSON.parse(r.seats) as Seat[];
  const state = r.state ? JSON.parse(r.state) : null;
  const e = ENGINES[r.kind];
  return {
    id: r.id,
    kind: r.kind,
    title: e?.title ?? r.kind,
    status: r.status,
    tripKey: r.trip_key,
    matchId: r.match_id,
    seats,
    maxPlayers: r.max_players,
    minPlayers: e?.minPlayers ?? 2,
    womenOnly: !!r.women_only,
    state,
    turn: state && r.status === "active" ? e.turn(state) : -1,
    winners: JSON.parse(r.winners || "[]") as number[],
    resultText: r.result_text,
    version: r.version,
    createdBy: r.created_by,
    updatedAt: r.updated_at,
  };
}
export type PlayView = ReturnType<typeof view>;

const load = (id: number) => db.prepare("SELECT * FROM play_sessions WHERE id=?").get<Row>(id);

/** Save only if nobody changed it meanwhile (two moves at once cannot both win). */
async function save(r: Row, patch: Partial<Row>) {
  const next = { ...r, ...patch };
  const res = await db
    .prepare(
      "UPDATE play_sessions SET seats=?, state=?, status=?, winners=?, result_text=?, version=version+1, updated_at=now() WHERE id=? AND version=? RETURNING *"
    )
    .get<Row>(next.seats, next.state, next.status, next.winners, next.result_text, r.id, r.version);
  return res ?? null;
}

async function broadcast(r: Row) {
  const v = view(r);
  for (const s of v.seats) if (s.user && !s.bot) emitToUser(s.user, "play:update", v);
  if (r.trip_key) {
    const room = await db.prepare("SELECT id FROM rooms WHERE trip_key=? AND kind='train'").get<{ id: number }>(r.trip_key);
    if (room) emitToRoom(room.id, "play:lobby", { tripKey: r.trip_key });
  }
}

/** Can this user see / join this session? */
async function canSee(u: UserRow, r: Row) {
  const seats = JSON.parse(r.seats) as Seat[];
  if (seats.some((s) => s.user === u.id)) return true;
  if (r.match_id) return false;
  if (!r.trip_key) return false;
  const onTrip = await db.prepare("SELECT 1 FROM trips WHERE user_id=? AND trip_key=?").get(u.id, r.trip_key);
  if (!onTrip) return false;
  if (r.women_only && u.gender !== "woman") return false;
  for (const s of seats) if (s.user && !s.bot && (await isBlocked(u.id, s.user))) return false;
  return true;
}

async function startGame(r: Row, fillBots: boolean) {
  const e = ENGINES[r.kind];
  let seats = JSON.parse(r.seats) as Seat[];
  if (fillBots) {
    let b = 0;
    while (seats.length < r.max_players) seats.push({ user: null, name: BOT_NAMES[b++ % BOT_NAMES.length], bot: true });
  }
  if (seats.length < e.minPlayers) return { error: `Needs at least ${e.minPlayers} players` };
  // shuffle seat order so the creator doesn't always go first (keeps fairness in ludo/chess colours)
  seats = seats.map((s) => ({ s, k: Math.random() })).sort((a, b) => a.k - b.k).map((x) => x.s);
  const state = e.init(seats.length, rng);
  const saved = await save(r, { seats: JSON.stringify(seats), state: JSON.stringify(state), status: "active" });
  if (!saved) return { error: "Someone changed the table, try again" };
  await broadcast(saved);
  scheduleBots(saved.id);
  return { row: saved };
}

async function applyMove(r: Row, seat: number, move: unknown): Promise<{ error: string } | { row: Row }> {
  const e = ENGINES[r.kind];
  const state = JSON.parse(r.state!);
  const err = e.check(state, seat, move);
  if (err) return { error: err };
  const next = e.apply(state, seat, move, rng);
  const res = e.result(next);
  const saved = await save(r, {
    state: JSON.stringify(next),
    status: res.over ? "done" : "active",
    winners: JSON.stringify(res.winners),
    result_text: res.over ? res.text || (res.draw ? "Draw" : "Game over") : null,
  });
  if (!saved) return { error: "The board changed, try again" };
  await broadcast(saved);
  if (res.over) track(null, "game_finished", { kind: r.kind, players: JSON.parse(r.seats).length });
  if (!res.over) scheduleBots(saved.id);
  return { row: saved };
}

// ---------- computer players (and demo travellers in dev) ----------
const botTimers = new Map<number, ReturnType<typeof setTimeout>>();
async function isBotSeat(s: Seat) {
  if (s.bot) return true;
  if (!s.user) return false;
  const u = await getUser(s.user);
  return !!u && isDemoUser(u.phone);
}

function scheduleBots(id: number) {
  if (botTimers.has(id)) return;
  botTimers.set(
    id,
    setTimeout(async () => {
      botTimers.delete(id);
      try {
        const r = await load(id);
        if (!r || r.status !== "active") return;
        const e = ENGINES[r.kind];
        const state = JSON.parse(r.state!);
        const seat = e.turn(state);
        const seats = JSON.parse(r.seats) as Seat[];
        if (seat < 0 || !(await isBotSeat(seats[seat]))) return;
        await applyMove(r, seat, e.bot(state, seat, rng));
      } catch (err) {
        console.error("bot move failed", err);
      }
    }, 900)
  );
}

// ---------- routes ----------
const createSchema = z.object({
  kind: z.enum(["chess", "ludo", "tictactoe", "connect4"]),
  matchId: z.number().int().optional(),
  tripId: z.number().int().optional(),
  players: z.number().int().min(2).max(4).optional(),
});

api.post("/play", limit("playcreate", 20, 3600_000), async (req, res) => {
  const b = parse(createSchema, req.body, res);
  if (!b) return;
  const u = me(req);
  const e = ENGINES[b.kind];
  const maxPlayers = Math.min(e.maxPlayers, Math.max(e.minPlayers, b.players ?? e.maxPlayers));

  if (b.matchId) {
    const m = await db
      .prepare("SELECT * FROM matches WHERE id=? AND closed=0 AND (a_id=? OR b_id=?)")
      .get<{ id: number; a_id: number; b_id: number }>(b.matchId, u.id, u.id);
    if (!m) return bad(res, "Chat not found", 404);
    const other = (await getUser(m.a_id === u.id ? m.b_id : m.a_id))!;
    const seats: Seat[] = [
      { user: u.id, name: u.name || "You", bot: false },
      { user: other.id, name: other.name || "Friend", bot: false },
    ];
    const row = await db
      .prepare("INSERT INTO play_sessions (kind, match_id, seats, max_players, status, created_by) VALUES (?,?,?,?,?,?) RETURNING *")
      .get<Row>(b.kind, m.id, JSON.stringify(seats), 2, "waiting", u.id);
    const started = await startGame(row!, false);
    if ("error" in started) return bad(res, started.error!);
    await pushMessage(m.id, u.id, "play", String(row!.id), [m.a_id, m.b_id]);
    notify(other.id, { title: `🎮 ${u.name} invited you to ${e.title}`, body: "Tap to play.", url: `/play/${row!.id}`, tag: `play-${row!.id}` });
    track(u.id, "game_started", { kind: b.kind, where: "chat" });
    return res.json(view(started.row));
  }

  if (b.tripId) {
    const trip = await myTrip(u.id, b.tripId);
    if (!trip) return bad(res, "Trip not found", 404);
    const open = await db
      .prepare("SELECT COUNT(*) c FROM play_sessions WHERE created_by=? AND status='waiting'")
      .get<{ c: number }>(u.id);
    if ((open?.c ?? 0) >= 3) return bad(res, "You already have 3 open tables");
    const seats: Seat[] = [{ user: u.id, name: u.name || "You", bot: false }];
    const row = await db
      .prepare("INSERT INTO play_sessions (kind, trip_key, seats, max_players, women_only, status, created_by) VALUES (?,?,?,?,?,?,?) RETURNING *")
      .get<Row>(b.kind, trip.trip_key, JSON.stringify(seats), maxPlayers, u.women_only ? 1 : 0, "waiting", u.id);
    await broadcast(row!);
    track(u.id, "game_started", { kind: b.kind, where: "trip" });
    return res.json(view(row!));
  }
  bad(res, "Pick a chat or a trip");
});

/** Open and running tables on this journey. */
api.get("/trips/:id/play", async (req, res) => {
  const u = me(req);
  const trip = await myTrip(u.id, Number(req.params.id));
  if (!trip) return bad(res, "Trip not found", 404);
  const rows = await db
    .prepare("SELECT * FROM play_sessions WHERE trip_key=? AND (status IN ('waiting','active') OR updated_at > now() - interval '30 minutes') ORDER BY id DESC LIMIT 30")
    .all<Row>(trip.trip_key);
  const out = [];
  for (const r of rows) if (await canSee(u, r)) out.push(view(r));
  res.json(out);
});

/** My games in progress, anywhere. */
api.get("/play/mine", async (req, res) => {
  const u = me(req);
  const rows = await db
    .prepare("SELECT * FROM play_sessions WHERE status IN ('waiting','active') AND seats LIKE ? ORDER BY updated_at DESC LIMIT 30")
    .all<Row>(`%"user":${u.id},%`);
  res.json(rows.filter((r) => (JSON.parse(r.seats) as Seat[]).some((s) => s.user === u.id)).map(view));
});

api.get("/play/:id", async (req, res) => {
  const r = await load(Number(req.params.id));
  if (!r || !(await canSee(me(req), r))) return bad(res, "Game not found", 404);
  if (r.status === "active") scheduleBots(r.id); // resume computer turns after a server restart
  res.json(view(r));
});

api.post("/play/:id/join", async (req, res) => {
  const u = me(req);
  const r = await load(Number(req.params.id));
  if (!r || !(await canSee(u, r))) return bad(res, "Game not found", 404);
  if (r.status !== "waiting") return bad(res, "This game already started");
  const seats = JSON.parse(r.seats) as Seat[];
  if (seats.some((s) => s.user === u.id)) return res.json(view(r));
  if (seats.length >= r.max_players) return bad(res, "Table is full");
  seats.push({ user: u.id, name: u.name || "Player", bot: false });
  const saved = await save(r, { seats: JSON.stringify(seats) });
  if (!saved) return bad(res, "Someone else just joined, try again", 409);
  if (seats.length >= r.max_players) {
    const started = await startGame(saved, false);
    if ("error" in started) return bad(res, started.error!);
    return res.json(view(started.row));
  }
  await broadcast(saved);
  res.json(view(saved));
});

api.post("/play/:id/start", async (req, res) => {
  const u = me(req);
  const b = parse(z.object({ fillBots: z.boolean().default(false) }), req.body ?? {}, res);
  if (!b) return;
  const r = await load(Number(req.params.id));
  if (!r || r.created_by !== u.id) return bad(res, "Only the host can start", 403);
  if (r.status !== "waiting") return bad(res, "Already started");
  const started = await startGame(r, b.fillBots);
  if ("error" in started) return bad(res, started.error!);
  res.json(view(started.row));
});

api.post("/play/:id/move", async (req, res) => {
  const u = me(req);
  const b = parse(z.object({ move: z.any(), version: z.number().int().optional() }), req.body, res);
  if (!b) return;
  const r = await load(Number(req.params.id));
  if (!r) return bad(res, "Game not found", 404);
  if (r.status !== "active") return bad(res, "This game is not running");
  const seats = JSON.parse(r.seats) as Seat[];
  const seat = seats.findIndex((s) => s.user === u.id);
  if (seat < 0) return bad(res, "You are not playing in this game", 403);
  const out = await applyMove(r, seat, b.move);
  if ("error" in out) return bad(res, out.error, 409);
  res.json(view(out.row));
});

/** Leave: a waiting table frees your seat; in a running game you resign (in Ludo a computer takes over). */
api.post("/play/:id/leave", async (req, res) => {
  const u = me(req);
  const r = await load(Number(req.params.id));
  if (!r) return bad(res, "Game not found", 404);
  const seats = JSON.parse(r.seats) as Seat[];
  const seat = seats.findIndex((s) => s.user === u.id);
  if (seat < 0) return bad(res, "You are not in this game", 403);
  let saved: Row | null;
  if (r.status === "waiting") {
    const rest = seats.filter((s) => s.user !== u.id);
    saved = rest.length
      ? await save(r, { seats: JSON.stringify(rest) })
      : await save(r, { status: "done", result_text: "Table closed" });
  } else if (r.status === "active") {
    const humans = seats.filter((s) => !s.bot && s.user !== u.id);
    if (r.kind === "ludo" && seats.length > 2 && humans.length > 0) {
      seats[seat] = { user: null, name: `${seats[seat].name} (computer)`, bot: true };
      saved = await save(r, { seats: JSON.stringify(seats) });
      if (saved) scheduleBots(saved.id);
    } else {
      const winners = seats.map((_, i) => i).filter((i) => i !== seat);
      saved = await save(r, { status: "done", winners: JSON.stringify(winners), result_text: `${seats[seat].name} resigned` });
    }
  } else saved = r;
  if (!saved) return bad(res, "Try again", 409);
  await broadcast(saved);
  res.json(view(saved));
});
