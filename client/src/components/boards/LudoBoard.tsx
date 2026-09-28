import { COLORS, HOME, SAFE, TRACK, HOME_COLUMN, START, YARD, cellOf, movable, type LudoState, type LudoMove } from "../../../../shared/games/ludo";
import type { BoardProps } from "./types";

const HEX = ["#e53935", "#43a047", "#f9c80e", "#1e88e5"];
const DICE = ["", "⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];

function baseColor(r: number, c: number): string | null {
  if (r < 6 && c < 6) return HEX[0];
  if (r < 6 && c > 8) return HEX[1];
  if (r > 8 && c > 8) return HEX[2];
  if (r > 8 && c < 6) return HEX[3];
  return null;
}

export default function LudoBoard({ state, mySeat, turn, onMove, seats, busy }: BoardProps<LudoState, LudoMove>) {
  const myTurn = mySeat !== null && mySeat === turn && !busy;
  const canMove = myTurn && state.phase === "move" && state.dice !== null ? new Set(movable(state, mySeat!, state.dice)) : new Set<number>();

  // which grid cells are part of the path, home columns, start and safe squares
  const special = new Map<string, { color?: string; safe?: boolean; path?: boolean }>();
  TRACK.forEach(([r, c], i) => special.set(`${r},${c}`, { path: true, safe: SAFE.has(i), color: START.includes(i) ? HEX[START.indexOf(i)] : undefined }));
  HOME_COLUMN.forEach((col, ci) => col.forEach(([r, c]) => special.set(`${r},${c}`, { path: true, color: HEX[ci] })));

  const spots = new Set(YARD.flat().map(([r, c]) => `${r},${c}`));

  // tokens per cell
  const tokensAt = new Map<string, { seat: number; token: number; color: number }[]>();
  state.tokens.forEach((toks, seat) =>
    toks.forEach((p, token) => {
      const [r, c] = cellOf(state.colors[seat], p, token);
      const k = `${r},${c}`;
      tokensAt.set(k, [...(tokensAt.get(k) || []), { seat, token, color: state.colors[seat] }]);
    })
  );

  const cells = [];
  for (let r = 0; r < 15; r++)
    for (let c = 0; c < 15; c++) {
      const k = `${r},${c}`;
      const sp = special.get(k);
      const base = baseColor(r, c);
      const center = r >= 6 && r <= 8 && c >= 6 && c <= 8;
      const toks = tokensAt.get(k) || [];
      const spot = spots.has(k);
      const bg = center ? "transparent" : sp?.color ? sp.color : sp?.path ? "var(--card)" : base ? base : "transparent";
      cells.push(
        <div key={k} className={`lc ${sp?.path ? "path" : ""} ${spot ? "spot" : ""} ${center ? "center" : ""}`} style={{ background: spot ? "var(--card)" : bg }}>
          {sp?.safe && !sp.color && <span className="star">★</span>}
          {toks.map((t, i) => {
            const clickable = t.seat === mySeat && canMove.has(t.token);
            return (
              <button
                key={`${t.seat}-${t.token}`}
                className={`tok ${clickable ? "can" : ""} ${state.last && state.last.seat === t.seat && state.last.token === t.token ? "moved" : ""}`}
                style={{ background: HEX[t.color], transform: toks.length > 1 ? `translate(${(i % 2) * 6 - 3}px, ${Math.floor(i / 2) * 6 - 3}px) scale(.8)` : undefined }}
                disabled={!clickable}
                onClick={() => onMove({ type: "move", token: t.token })}
                aria-label={`${COLORS[t.color]} token ${t.token + 1}`}
              />
            );
          })}
        </div>
      );
    }

  const turnColor = state.colors[turn] ?? 0;
  return (
    <div className="ludo-wrap">
      <div className="ludo">
        {cells}
        <div className="ludo-home" />
      </div>
      <div className="ludo-bar">
        <div className="ludo-players">
          {seats.map((s, i) => (
            <span key={i} className={`lp ${i === turn ? "on" : ""}`} style={{ borderColor: HEX[state.colors[i]] }}>
              <i style={{ background: HEX[state.colors[i]] }} />
              {s.name}
              <small>{state.tokens[i].filter((p) => p === HOME).length}/4 home</small>
            </span>
          ))}
        </div>
        <button className="dice" style={{ borderColor: HEX[turnColor] }} disabled={!(myTurn && state.phase === "roll")} onClick={() => onMove({ type: "roll" })}>
          <span>{state.dice ? DICE[state.dice] : "🎲"}</span>
          <small>{myTurn ? (state.phase === "roll" ? "Tap to roll" : "Pick a token") : `${seats[turn]?.name ?? ""}'s turn`}</small>
        </button>
        <p className="small muted ludo-log">{state.log.slice(-2).join(" · ")}</p>
      </div>
    </div>
  );
}
