import { Chess, type Square } from "chess.js";
import type { Engine } from "./types";

// Seat 0 plays white, seat 1 plays black. chess.js enforces every rule
// (check, castling, en passant, promotion, draws).
export type ChessState = { fen: string; history: string[]; last: [string, string] | null; resultText?: string };
export type ChessMove = { from: string; to: string; promotion?: "q" | "r" | "b" | "n" };

const VALUE: Record<string, number> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };

/** Material + centre bonus. Cheap: no move generation. */
function material(c: Chess, forWhite: boolean) {
  let s = 0;
  const board = c.board();
  for (let r = 0; r < 8; r++)
    for (let f = 0; f < 8; f++) {
      const p = board[r][f];
      if (!p) continue;
      const center = 3.5 - Math.max(Math.abs(r - 3.5), Math.abs(f - 3.5));
      const v = VALUE[p.type] + (p.type === "k" ? 0 : center * 6);
      s += p.color === "w" ? v : -v;
    }
  return forWhite ? s : -s;
}

/** Small alpha-beta search. Mate and stalemate are detected when a side has no moves. */
function search(c: Chess, depth: number, a: number, b: number, forWhite: boolean, maximizing: boolean): number {
  if (depth === 0) return material(c, forWhite);
  const moves = c.moves({ verbose: true });
  if (moves.length === 0) {
    if (!c.inCheck()) return 0; // stalemate
    return maximizing ? -99999 - depth : 99999 + depth; // side to move is mated
  }
  moves.sort((x, y) => (y.captured ? VALUE[y.captured] : 0) - (x.captured ? VALUE[x.captured] : 0));
  let v = maximizing ? -Infinity : Infinity;
  for (const m of moves) {
    c.move(m);
    const r = search(c, depth - 1, a, b, forWhite, !maximizing);
    c.undo();
    if (maximizing) {
      v = Math.max(v, r);
      a = Math.max(a, v);
    } else {
      v = Math.min(v, r);
      b = Math.min(b, v);
    }
    if (a >= b) break;
  }
  return v;
}

export const chess: Engine<ChessState, ChessMove> = {
  kind: "chess",
  title: "Chess",
  icon: "♟️",
  minPlayers: 2,
  maxPlayers: 2,
  init: () => ({ fen: new Chess().fen(), history: [], last: null }),
  turn(s) {
    const c = new Chess(s.fen);
    if (c.isGameOver() || s.resultText) return -1;
    return c.turn() === "w" ? 0 : 1;
  },
  check(s, seat, m) {
    const c = new Chess(s.fen);
    if (c.isGameOver()) return "Game over";
    if ((c.turn() === "w" ? 0 : 1) !== seat) return "Not your turn";
    try {
      c.move({ from: m.from, to: m.to, promotion: m.promotion || "q" });
      return null;
    } catch {
      return "Illegal move";
    }
  },
  apply(s, _seat, m) {
    const c = new Chess(s.fen);
    const mv = c.move({ from: m.from, to: m.to, promotion: m.promotion || "q" });
    return { fen: c.fen(), history: [...s.history, mv.san], last: [m.from, m.to] };
  },
  result(s) {
    const c = new Chess(s.fen);
    if (c.isCheckmate()) return { over: true, winners: [c.turn() === "w" ? 1 : 0], text: "Checkmate" };
    if (c.isStalemate()) return { over: true, winners: [], draw: true, text: "Stalemate" };
    if (c.isThreefoldRepetition()) return { over: true, winners: [], draw: true, text: "Draw by repetition" };
    if (c.isInsufficientMaterial()) return { over: true, winners: [], draw: true, text: "Draw, not enough pieces" };
    if (c.isDraw()) return { over: true, winners: [], draw: true, text: "Draw (50 move rule)" };
    return { over: false, winners: [] };
  },
  bot(s, seat, rng) {
    const c = new Chess(s.fen);
    const forWhite = seat === 0;
    const moves = c.moves({ verbose: true });
    let best = moves[0];
    let bestV = -Infinity;
    for (const m of moves) {
      c.move(m);
      // look at the opponent's best reply (2 plies): quick on phones, still punishes blunders
      const v = search(c, 1, -Infinity, Infinity, forWhite, false) + rng() * 15; // a little variety
      c.undo();
      if (v > bestV) [best, bestV] = [m, v];
    }
    return { from: best.from, to: best.to, promotion: (best.promotion as ChessMove["promotion"]) || undefined };
  },
};

/** Legal target squares for the piece on `from` (for highlighting in the UI). */
export function targets(fen: string, from: string): string[] {
  const c = new Chess(fen);
  return c.moves({ square: from as Square, verbose: true }).map((m) => m.to);
}

export function boardOf(fen: string) {
  return new Chess(fen).board();
}

export function inCheck(fen: string) {
  return new Chess(fen).inCheck();
}
