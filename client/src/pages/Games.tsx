import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useApp } from "../App";
import { GAME_INFO, type PlaySession } from "../lib/play";
import { getSocket } from "../socket";

export default function Games() {
  const { me } = useApp();
  const [mine, setMine] = useState<PlaySession[]>([]);

  useEffect(() => {
    const load = () => api<PlaySession[]>("/play/mine").then(setMine).catch(() => {});
    load();
    const s = getSocket();
    s?.on("play:update", load);
    return () => {
      s?.off("play:update", load);
    };
  }, []);

  return (
    <div className="page stack">
      <header className="pagehead">
        <h2>Games</h2>
        <p className="muted">Play with people on your journey, or on your own. Solo games work offline.</p>
      </header>

      {mine.length > 0 && (
        <>
          <span className="label">Your games</span>
          {mine.map((g) => {
            const myTurn = g.status === "active" && g.seats[g.turn]?.user === me?.id;
            return (
              <Link key={g.id} to={`/play/${g.id}`} className="card chatrow">
                <span className="gicon">{GAME_INFO[g.kind].icon}</span>
                <div className="grow">
                  <b>{g.title}</b>
                  <div className="muted small ellipsis">{g.seats.map((s) => s.name).join(" vs ")}</div>
                </div>
                <span className={`pill ${myTurn ? "live" : ""}`}>{g.status === "waiting" ? "Waiting" : myTurn ? "Your turn" : "Their turn"}</span>
              </Link>
            );
          })}
        </>
      )}

      <span className="label">Play solo (vs computer)</span>
      <div className="gamegrid">
        {Object.entries(GAME_INFO).map(([k, g]) => (
          <Link key={k} to={`/solo/${k}`} className="gametile">
            <span className="gicon">{g.icon}</span>
            <b>{g.title}</b>
            <small>{k === "ludo" ? "vs 1 to 3 computers" : "vs computer"}</small>
          </Link>
        ))}
        <Link to="/solo/trivia" className="gametile">
          <span className="gicon">🧠</span>
          <b>Travel trivia</b>
          <small>10 questions</small>
        </Link>
        <Link to="/solo/scramble" className="gametile">
          <span className="gicon">🔤</span>
          <b>Word scramble</b>
          <small>Cities and travel words</small>
        </Link>
      </div>

      <div className="card">
        <b>Play with people</b>
        <p className="muted small">Open a trip and use its 🎮 Games tab to start a table anyone on your journey can join, or start a game from any private chat with the 🎲 button.</p>
      </div>
    </div>
  );
}
