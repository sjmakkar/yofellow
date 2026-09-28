import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, MODE_ICON, type Match } from "../api";
import { getSocket } from "../socket";
import Avatar from "../components/Avatar";

type CabGroupRow = { id: number; dropArea: string; riders: number; room: { id: number; name: string; last: string | null } | null };

export default function Chats() {
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [cabs, setCabs] = useState<CabGroupRow[]>([]);
  useEffect(() => {
    api<CabGroupRow[]>("/cabs/mine").then(setCabs).catch(() => {});
  }, []);
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
      {cabs.filter((c) => c.room).map((c) => (
        <Link key={c.id} to={`/groups/${c.room!.id}`} className="card chatrow">
          <div className="avatar cabav">🚕</div>
          <div className="grow ellipsis">
            <b>{c.room!.name}</b>
            <div className="muted small ellipsis">{c.room!.last || `${c.riders} riders`}</div>
          </div>
          <span className="small muted">Cab group</span>
        </Link>
      ))}
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
