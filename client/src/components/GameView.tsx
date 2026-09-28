import GameBoard from "./boards/GameBoard";

type Props = {
  kind: string;
  title: string;
  seats: { name: string; bot?: boolean }[];
  state: any;
  mySeat: number | null;
  turn: number;
  status: "waiting" | "active" | "done";
  winners: number[];
  resultText: string | null;
  onMove: (m: any) => void;
  busy?: boolean;
  thinking?: boolean;
  actions?: React.ReactNode;
};

const SIDE: Record<string, string[]> = {
  chess: ["White", "Black"],
  tictactoe: ["✕", "◯"],
  connect4: ["Red", "Yellow"],
};

export default function GameView(p: Props) {
  const sides = SIDE[p.kind];
  const iWon = p.mySeat !== null && p.winners.includes(p.mySeat);
  let status = "";
  if (p.status === "done") status = p.winners.length === 0 ? `Draw. ${p.resultText ?? ""}` : iWon ? `You won! 🎉 ${p.resultText ?? ""}` : `${p.winners.map((w) => p.seats[w]?.name).join(", ")} won. ${p.resultText ?? ""}`;
  else if (p.turn === p.mySeat) status = "Your turn";
  else if (p.turn >= 0) status = `${p.seats[p.turn]?.name ?? "Opponent"} is ${p.thinking || p.seats[p.turn]?.bot ? "thinking…" : "playing…"}`;

  return (
    <div className="gameview stack">
      {p.kind !== "ludo" && (
        <div className="players">
          {p.seats.map((s, i) => (
            <span key={i} className={`pl ${i === p.turn && p.status === "active" ? "on" : ""} ${p.winners.includes(i) ? "won" : ""}`}>
              {sides && <b>{sides[i]}</b>} {s.name}
              {i === p.mySeat && " (you)"}
            </span>
          ))}
        </div>
      )}
      <div className={`gstatus ${p.status === "done" ? (iWon ? "win" : "over") : p.turn === p.mySeat ? "mine" : ""}`}>{status}</div>
      <GameBoard kind={p.kind} state={p.state} mySeat={p.status === "active" ? p.mySeat : null} turn={p.turn} onMove={p.onMove} seats={p.seats} busy={p.busy} />
      {p.actions && <div className="row">{p.actions}</div>}
    </div>
  );
}
