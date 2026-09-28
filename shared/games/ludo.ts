import { clone, type Engine, type Rng } from "./types";

// Classic Indian Ludo, 2 to 4 players.
//  - Roll a 6 to bring a token out. A 6 gives another roll (three 6s in a row lose the turn).
//  - Landing on an opponent sends it home, except on safe squares (starts and stars). Capturing gives another roll.
//  - Tokens walk 51 squares, then 5 squares up their home column, then home (exact roll needed).
//  - First player to bring all 4 tokens home wins.

export const COLORS = ["red", "green", "yellow", "blue"] as const;
export const START = [0, 13, 26, 39]; // track index where each color enters
export const SAFE = new Set([0, 8, 13, 21, 26, 34, 39, 47]);
export const HOME = 56; // progress value of a finished token (0..50 track, 51..55 home column)

export type LudoState = {
  colors: number[]; // color index for each seat
  tokens: number[][]; // per seat, 4 tokens: -1 = in yard, 0..55 on the way, 56 = home
  turn: number;
  phase: "roll" | "move";
  dice: number | null;
  sixes: number;
  winner: number | null;
  last: { seat: number; token: number; from: number; to: number; captured: boolean } | null;
  log: string[];
};
export type LudoMove = { type: "roll" } | { type: "move"; token: number };

/** Absolute track square (0..51) of a progress value for a color, or null if not on the shared track. */
export function trackSquare(color: number, p: number) {
  return p >= 0 && p <= 50 ? (START[color] + p) % 52 : null;
}

export function movable(s: LudoState, seat: number, dice: number) {
  return s.tokens[seat]
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => (p === -1 ? dice === 6 : p !== HOME && p + dice <= HOME))
    .map(({ i }) => i);
}

function nextSeat(s: LudoState, seat: number) {
  return (seat + 1) % s.tokens.length;
}

const name = (s: LudoState, seat: number) => COLORS[s.colors[seat]];

export const ludo: Engine<LudoState, LudoMove> = {
  kind: "ludo",
  title: "Ludo",
  icon: "🎲",
  minPlayers: 2,
  maxPlayers: 4,
  init(players) {
    const colors = players === 2 ? [0, 2] : players === 3 ? [0, 1, 2] : [0, 1, 2, 3];
    return {
      colors,
      tokens: colors.map(() => [-1, -1, -1, -1]),
      turn: 0,
      phase: "roll",
      dice: null,
      sixes: 0,
      winner: null,
      last: null,
      log: [],
    };
  },
  turn: (s) => (s.winner !== null ? -1 : s.turn),
  check(s, seat, m) {
    if (s.winner !== null) return "Game over";
    if (seat !== s.turn) return "Not your turn";
    if (m?.type === "roll") return s.phase === "roll" ? null : "Move a token first";
    if (m?.type === "move") {
      if (s.phase !== "move" || s.dice === null) return "Roll the dice first";
      return movable(s, seat, s.dice).includes(m.token) ? null : "That token can't move";
    }
    return "Bad move";
  },
  apply(s, seat, m, rng) {
    const n = clone(s);
    if (m.type === "roll") {
      const d = 1 + Math.floor(rng() * 6);
      n.dice = d;
      n.sixes = d === 6 ? n.sixes + 1 : 0;
      n.log = [...n.log.slice(-20), `${name(n, seat)} rolled ${d}`];
      if (n.sixes === 3) {
        n.log.push(`${name(n, seat)} rolled three 6s, turn lost`);
        n.sixes = 0;
        n.dice = null;
        n.turn = nextSeat(n, seat);
        return n;
      }
      if (movable(n, seat, d).length === 0) {
        // nothing to move: pass (a 6 still gives another roll only if a move was possible)
        n.dice = null;
        n.sixes = 0;
        n.turn = nextSeat(n, seat);
        return n;
      }
      n.phase = "move";
      return n;
    }
    // move
    const d = n.dice!;
    const from = n.tokens[seat][m.token];
    const to = from === -1 ? 0 : from + d;
    n.tokens[seat][m.token] = to;
    let captured = false;
    const sq = trackSquare(n.colors[seat], to);
    if (sq !== null && !SAFE.has(sq)) {
      n.tokens.forEach((toks, other) => {
        if (other === seat) return;
        toks.forEach((p, i) => {
          if (trackSquare(n.colors[other], p) === sq) {
            toks[i] = -1;
            captured = true;
            n.log.push(`${name(n, seat)} captured ${name(n, other)}!`);
          }
        });
      });
    }
    n.last = { seat, token: m.token, from, to, captured };
    if (n.tokens[seat].every((p) => p === HOME)) {
      n.winner = seat;
      n.log.push(`${name(n, seat)} wins!`);
    }
    const again = d === 6 || captured || to === HOME;
    n.phase = "roll";
    n.dice = null;
    if (!again) {
      n.sixes = 0;
      n.turn = nextSeat(n, seat);
    }
    return n;
  },
  result(s) {
    return s.winner !== null ? { over: true, winners: [s.winner], text: `${COLORS[s.colors[s.winner]]} brought all tokens home` } : { over: false, winners: [] };
  },
  bot(s, seat, rng: Rng) {
    if (s.phase === "roll") return { type: "roll" };
    const d = s.dice!;
    const opts = movable(s, seat, d);
    const color = s.colors[seat];
    let best = opts[0];
    let bestScore = -Infinity;
    for (const t of opts) {
      const from = s.tokens[seat][t];
      const to = from === -1 ? 0 : from + d;
      const sq = trackSquare(color, to);
      let score = rng();
      if (to === HOME) score += 50;
      if (from === -1) score += 30;
      if (sq !== null && !SAFE.has(sq)) {
        const hits = s.tokens.some((toks, o) => o !== seat && toks.some((p) => trackSquare(s.colors[o], p) === sq));
        if (hits) score += 60;
      }
      if (sq !== null && SAFE.has(sq)) score += 10;
      if (to > 50) score += 15; // safe in the home column
      score += to / 10; // prefer advancing tokens further along
      if (score > bestScore) [best, bestScore] = [t, score];
    }
    return { type: "move", token: best };
  },
};

// ---------- board geometry for drawing (15 x 15 grid) ----------
export const TRACK: [number, number][] = [
  [6, 1], [6, 2], [6, 3], [6, 4], [6, 5],
  [5, 6], [4, 6], [3, 6], [2, 6], [1, 6], [0, 6],
  [0, 7], [0, 8],
  [1, 8], [2, 8], [3, 8], [4, 8], [5, 8],
  [6, 9], [6, 10], [6, 11], [6, 12], [6, 13], [6, 14],
  [7, 14], [8, 14],
  [8, 13], [8, 12], [8, 11], [8, 10], [8, 9],
  [9, 8], [10, 8], [11, 8], [12, 8], [13, 8], [14, 8],
  [14, 7], [14, 6],
  [13, 6], [12, 6], [11, 6], [10, 6], [9, 6],
  [8, 5], [8, 4], [8, 3], [8, 2], [8, 1], [8, 0],
  [7, 0], [6, 0],
];
export const HOME_COLUMN: [number, number][][] = [
  [[7, 1], [7, 2], [7, 3], [7, 4], [7, 5]], // red
  [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7]], // green
  [[7, 13], [7, 12], [7, 11], [7, 10], [7, 9]], // yellow
  [[13, 7], [12, 7], [11, 7], [10, 7], [9, 7]], // blue
];
export const YARD: [number, number][][] = [
  [[1, 1], [1, 4], [4, 1], [4, 4]],
  [[1, 10], [1, 13], [4, 10], [4, 13]],
  [[10, 10], [10, 13], [13, 10], [13, 13]],
  [[10, 1], [10, 4], [13, 1], [13, 4]],
];

/** Grid cell for a token, for drawing. */
export function cellOf(color: number, p: number, tokenIndex: number): [number, number] {
  if (p === -1) return YARD[color][tokenIndex];
  if (p === HOME) return [7, 7];
  if (p > 50) return HOME_COLUMN[color][p - 51];
  return TRACK[(START[color] + p) % 52];
}
