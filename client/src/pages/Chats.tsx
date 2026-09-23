import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, MODE_ICON, type Match } from "../api";
import { getSocket } from "../socket";
import Avatar from "../components/Avatar";

export default function Chats() {
  const [matches, setMatches] = useState<Match[] | null>(null);
  const load = () => api<Match[]>("/matches").then(setMatches);

  useEffect(() => {
    load();
    const s = getSocket();
    s?.on("message", load);
    s?.on("match", load);
    s?.on("match:closed", load);
    return () => {
      s?.off("message", load);
      s?.off("match", load);
      s?.off("match:closed", load);
    };
  }, []);

  return (
    <div className="page stack">
      <header className="pagehead">
        <h2>Chats</h2>
      </header>
      {matches === null ? (
        <p className="muted">Loading…</p>
      ) : matches.length === 0 ? (
        <div className="empty card">
          <div className="big">💬</div>
          <p>No matches yet. Wave at someone on your trip!</p>
        </div>
      ) : (
        matches.map((m) => (
          <Link key={m.id} to={`/chats/${m.id}`} className="card chatrow">
            <Avatar name={m.with.name} />
            <div className="grow ellipsis">
              <b>{m.with.name}</b>
              <div className="muted small ellipsis">
                {m.lastMessage ? `${m.lastMessage.mine ? "You: " : ""}${m.lastMessage.body}` : "Say hi"}
              </div>
            </div>
            <span className="small muted">
              {MODE_ICON[m.trip.mode]} {m.trip.number}
            </span>
          </Link>
        ))
      )}
    </div>
  );
}
