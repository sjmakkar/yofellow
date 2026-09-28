import { clone, type Engine } from "./types";

export type TttState = { board: (0 | 1 | null)[]; next: 0 | 1; moves: number };
export type TttMove = { cell: number };

const LINES = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];

function winner(b: TttState["board"]): 0 | 1 | null {
  for (const [a, c, d] of LINES) if (b[a] !== null && b[a] === b[c] && b[a] === b[d]) return b[a];
  return null;
}

function minimax(b: TttState["board"], me: 0 | 1, turn: 0 | 1, depth: number): number {
  const w = winner(b);
  if (w !== null) return w === me ? 10 - depth : depth - 10;
  if (b.every((x) => x !== null)) return 0;
  const scores = b.map((x, i) => {
    if (x !== null) return null;
    const nb = [...b];
    nb[i] = turn;
    return minimax(nb, me, (1 - turn) as 0 | 1, depth + 1);
  }).filter((x): x is number => x !== null);
  return turn === me ? Math.max(...scores) : Math.min(...scores);
}

export const tictactoe: Engine<TttState, TttMove> = {
  kind: "tictactoe",
  title: "Tic-tac-toe",
  icon: "❌",
  minPlayers: 2,
  maxPlayers: 2,
  init: () => ({ board: Array(9).fill(null), next: 0, moves: 0 }),
  turn: (s) => (tictactoe.result(s).over ? -1 : s.next),
  check(s, seat, m) {
    if (tictactoe.result(s).over) return "Game over";
    if (seat !== s.next) return "Not your turn";
    if (!Number.isInteger(m?.cell) || m.cell < 0 || m.cell > 8) return "Bad move";
    if (s.board[m.cell] !== null) return "That square is taken";
    return null;
  },
  apply(s, seat, m) {
    const n = clone(s);
    n.board[m.cell] = seat as 0 | 1;
    n.next = (1 - seat) as 0 | 1;
    n.moves++;
    return n;
  },
  result(s) {
    const w = winner(s.board);
    if (w !== null) return { over: true, winners: [w], text: "Three in a row" };
    if (s.board.every((x) => x !== null)) return { over: true, winners: [], draw: true, text: "Draw" };
    return { over: false, winners: [] };
  },
  bot(s, seat, rng) {
    const free = s.board.map((x, i) => (x === null ? i : -1)).filter((i) => i >= 0);
    // Slightly beatable: 20% of the time play a random square.
    if (rng() < 0.2) return { cell: free[Math.floor(rng() * free.length)] };
    let best = free[0];
    let bestScore = -Infinity;
    for (const i of free) {
      const nb = [...s.board];
      nb[i] = seat as 0 | 1;
      const sc = minimax(nb, seat as 0 | 1, (1 - seat) as 0 | 1, 1);
      if (sc > bestScore) [best, bestScore] = [i, sc];
    }
    return { cell: best };
  },
};
