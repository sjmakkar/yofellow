import { clone, type Engine } from "./types";

export const ROWS = 6;
export const COLS = 7;
export type C4State = { grid: (0 | 1 | null)[][]; next: 0 | 1; last: [number, number] | null; win: [number, number][] | null };
export type C4Move = { col: number };

const DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];

function findWin(g: C4State["grid"]): [number, number][] | null {
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) {
      const p = g[r][c];
      if (p === null) continue;
      for (const [dr, dc] of DIRS) {
        const cells: [number, number][] = [[r, c]];
        for (let k = 1; k < 4; k++) {
          const rr = r + dr * k, cc = c + dc * k;
          if (rr < 0 || rr >= ROWS || cc < 0 || cc >= COLS || g[rr][cc] !== p) break;
          cells.push([rr, cc]);
        }
        if (cells.length === 4) return cells;
      }
    }
  return null;
}

function drop(g: C4State["grid"], col: number, p: 0 | 1) {
  for (let r = ROWS - 1; r >= 0; r--) if (g[r][col] === null) {
    g[r][col] = p;
    return r;
  }
  return -1;
}

function score(g: C4State["grid"], me: 0 | 1) {
  // Count open windows of 4 weighted by how many of our pieces are in them.
  let s = 0;
  for (let r = 0; r < ROWS; r++) if (g[r][3] === me) s += 3;
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      for (const [dr, dc] of DIRS) {
        let mine = 0, theirs = 0, ok = true;
        for (let k = 0; k < 4; k++) {
          const rr = r + dr * k, cc = c + dc * k;
          if (rr < 0 || rr >= ROWS || cc < 0 || cc >= COLS) { ok = false; break; }
          const v = g[rr][cc];
          if (v === me) mine++;
          else if (v !== null) theirs++;
        }
        if (!ok || (mine && theirs)) continue;
        s += mine === 3 ? 20 : mine === 2 ? 5 : 0;
        s -= theirs === 3 ? 25 : theirs === 2 ? 4 : 0;
      }
  return s;
}

function search(g: C4State["grid"], me: 0 | 1, turn: 0 | 1, depth: number, a: number, b: number): number {
  const w = findWin(g);
  if (w) return g[w[0][0]][w[0][1]] === me ? 100000 + depth : -100000 - depth;
  if (depth === 0 || g[0].every((x) => x !== null)) return score(g, me);
  const order = [3, 2, 4, 1, 5, 0, 6];
  if (turn === me) {
    let v = -Infinity;
    for (const c of order) {
      if (g[0][c] !== null) continue;
      const r = drop(g, c, turn);
      v = Math.max(v, search(g, me, (1 - turn) as 0 | 1, depth - 1, a, b));
      g[r][c] = null;
      a = Math.max(a, v);
      if (a >= b) break;
    }
    return v;
  }
  let v = Infinity;
  for (const c of order) {
    if (g[0][c] !== null) continue;
    const r = drop(g, c, turn);
    v = Math.min(v, search(g, me, (1 - turn) as 0 | 1, depth - 1, a, b));
    g[r][c] = null;
    b = Math.min(b, v);
    if (a >= b) break;
  }
  return v;
}

export const connect4: Engine<C4State, C4Move> = {
  kind: "connect4",
  title: "Connect 4",
  icon: "🔴",
  minPlayers: 2,
  maxPlayers: 2,
  init: () => ({ grid: Array.from({ length: ROWS }, () => Array(COLS).fill(null)), next: 0, last: null, win: null }),
  turn: (s) => (connect4.result(s).over ? -1 : s.next),
  check(s, seat, m) {
    if (connect4.result(s).over) return "Game over";
    if (seat !== s.next) return "Not your turn";
    if (!Number.isInteger(m?.col) || m.col < 0 || m.col >= COLS) return "Bad move";
    if (s.grid[0][m.col] !== null) return "That column is full";
    return null;
  },
  apply(s, seat, m) {
    const n = clone(s);
    const r = drop(n.grid, m.col, seat as 0 | 1);
    n.last = [r, m.col];
    n.next = (1 - seat) as 0 | 1;
    n.win = findWin(n.grid);
    return n;
  },
  result(s) {
    if (s.win) return { over: true, winners: [s.grid[s.win[0][0]][s.win[0][1]] as number], text: "Four in a row" };
    if (s.grid[0].every((x) => x !== null)) return { over: true, winners: [], draw: true, text: "Board full, draw" };
    return { over: false, winners: [] };
  },
  bot(s, seat, rng) {
    const g = clone(s.grid);
    let best = -1, bestV = -Infinity;
    for (const c of [3, 2, 4, 1, 5, 0, 6]) {
      if (g[0][c] !== null) continue;
      const r = drop(g, c, seat as 0 | 1);
      const v = search(g, seat as 0 | 1, (1 - seat) as 0 | 1, 4, -Infinity, Infinity) + rng() * 2;
      g[r][c] = null;
      if (v > bestV) [best, bestV] = [c, v];
    }
    return { col: best };
  },
};
