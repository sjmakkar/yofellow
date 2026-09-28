import ChessBoard from "./ChessBoard";
import LudoBoard from "./LudoBoard";
import TttBoard from "./TttBoard";
import C4Board from "./C4Board";
import type { BoardProps } from "./types";

export default function GameBoard({ kind, ...p }: BoardProps & { kind: string }) {
  if (kind === "chess") return <ChessBoard {...p} />;
  if (kind === "ludo") return <LudoBoard {...p} />;
  if (kind === "tictactoe") return <TttBoard {...p} />;
  if (kind === "connect4") return <C4Board {...p} />;
  return <p>Unknown game</p>;
}
