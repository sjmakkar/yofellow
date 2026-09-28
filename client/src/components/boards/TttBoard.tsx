import type { TttState, TttMove } from "../../../../shared/games/tictactoe";
import type { BoardProps } from "./types";

export default function TttBoard({ state, mySeat, turn, onMove, busy }: BoardProps<TttState, TttMove>) {
  const canPlay = mySeat !== null && mySeat === turn && !busy;
  return (
    <div className="ttt">
      {state.board.map((v, i) => (
        <button key={i} className={`ttt-cell ${v === 0 ? "x" : v === 1 ? "o" : ""}`} disabled={!canPlay || v !== null} onClick={() => onMove({ cell: i })}>
          {v === 0 ? "✕" : v === 1 ? "◯" : ""}
        </button>
      ))}
    </div>
  );
}
