import { useEffect, useState } from "react";
import { api } from "../api";
import { getSocket } from "../socket";

export type Seat = { user: number | null; name: string; bot: boolean };
export type PlaySession = {
  id: number;
  kind: "chess" | "ludo" | "tictactoe" | "connect4";
  title: string;
  status: "waiting" | "active" | "done";
  tripKey: string | null;
  matchId: number | null;
  seats: Seat[];
  maxPlayers: number;
  minPlayers: number;
  womenOnly: boolean;
  state: any;
  turn: number;
  winners: number[];
  resultText: string | null;
  version: number;
  createdBy: number;
};

export function usePlaySession(id: number) {
  const [s, setS] = useState<PlaySession | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    api<PlaySession>(`/play/${id}`)
      .then((x) => alive && setS(x))
      .catch((e) => alive && setError(e.message));
    const sock = getSocket();
    const onUpdate = (x: PlaySession) => x.id === id && setS(x);
    sock?.on("play:update", onUpdate);
    // fallback polling in case a socket event is missed on a flaky network
    const t = setInterval(() => api<PlaySession>(`/play/${id}`).then((x) => alive && setS(x)).catch(() => {}), 8000);
    return () => {
      alive = false;
      sock?.off("play:update", onUpdate);
      clearInterval(t);
    };
  }, [id]);
  return { s, setS, error };
}

export const GAME_INFO: Record<string, { icon: string; title: string; players: string; blurb: string }> = {
  chess: { icon: "♟️", title: "Chess", players: "2 players", blurb: "The classic. Checkmate wins." },
  ludo: { icon: "🎲", title: "Ludo", players: "2 to 4 players", blurb: "Roll a 6 to start. First to bring all 4 home wins." },
  tictactoe: { icon: "❌", title: "Tic-tac-toe", players: "2 players", blurb: "Three in a row. Quick one." },
  connect4: { icon: "🔴", title: "Connect 4", players: "2 players", blurb: "Drop discs, get four in a line." },
};
