import { useMemo, useState } from "react";
import { boardOf, targets, inCheck, type ChessState, type ChessMove } from "../../../../shared/games/chess";
import type { BoardProps } from "./types";

const GLYPH: Record<string, string> = { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" };
const FILES = "abcdefgh";

export default function ChessBoard({ state, mySeat, turn, onMove, busy }: BoardProps<ChessState, ChessMove>) {
  const [sel, setSel] = useState<string | null>(null);
  const board = useMemo(() => boardOf(state.fen), [state.fen]);
  const check = useMemo(() => inCheck(state.fen), [state.fen]);
  const flip = mySeat === 1; // black at the bottom for the black player
  const myColor = mySeat === 0 ? "w" : mySeat === 1 ? "b" : null;
  const canPlay = mySeat !== null && mySeat === turn && !busy;
  const moves = useMemo(() => (sel ? new Set(targets(state.fen, sel)) : new Set<string>()), [sel, state.fen]);
  const turnColor = state.fen.split(" ")[1];

  function tap(sq: string, piece: { color: string } | null) {
    if (!canPlay) return;
    if (sel && moves.has(sq)) {
      onMove({ from: sel, to: sq, promotion: "q" });
      setSel(null);
      return;
    }
    setSel(piece && piece.color === myColor ? sq : null);
  }

  const rows = flip ? [...board].reverse() : board;
  return (
    <div className="chess">
      {rows.map((row, ri) => {
        const r = flip ? 7 - ri : ri;
        const cells = flip ? [...row].reverse() : row;
        return cells.map((p, ci) => {
          const f = flip ? 7 - ci : ci;
          const sq = `${FILES[f]}${8 - r}`;
          const dark = (r + f) % 2 === 1;
          const isLast = state.last && (state.last[0] === sq || state.last[1] === sq);
          const kingInCheck = check && p?.type === "k" && p.color === turnColor;
          return (
            <button
              key={sq}
              className={`sq ${dark ? "dark" : "light"} ${sel === sq ? "sel" : ""} ${isLast ? "last" : ""} ${kingInCheck ? "check" : ""}`}
              onClick={() => tap(sq, p)}
              aria-label={sq}
            >
              {p && <span className={`pc ${p.color === "w" ? "white" : "black"}`}>{GLYPH[p.type]}</span>}
              {moves.has(sq) && <span className={p ? "cap" : "dot"} />}
              {ci === 0 && <small className="rank">{8 - r}</small>}
              {ri === 7 && <small className="file">{FILES[f]}</small>}
            </button>
          );
        });
      })}
    </div>
  );
}
