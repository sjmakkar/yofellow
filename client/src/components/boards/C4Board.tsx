import { COLS, type C4State, type C4Move } from "../../../../shared/games/connect4";
import type { BoardProps } from "./types";

export default function C4Board({ state, mySeat, turn, onMove, busy }: BoardProps<C4State, C4Move>) {
  const canPlay = mySeat !== null && mySeat === turn && !busy;
  const win = new Set((state.win || []).map(([r, c]) => `${r},${c}`));
  return (
    <div className="c4">
      {Array.from({ length: COLS }, (_, c) => (
        <button key={c} className="c4-col" disabled={!canPlay || state.grid[0][c] !== null} onClick={() => onMove({ col: c })} aria-label={`Drop in column ${c + 1}`}>
          {state.grid.map((row, r) => {
            const v = row[c];
            const last = state.last && state.last[0] === r && state.last[1] === c;
            return <span key={r} className={`c4-cell ${v === 0 ? "p0" : v === 1 ? "p1" : ""} ${win.has(`${r},${c}`) ? "win" : ""} ${last ? "last" : ""}`} />;
          })}
        </button>
      ))}
    </div>
  );
}
