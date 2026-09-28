import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, type Room } from "../api";
import GroupRoom from "../components/GroupRoom";

/** A cab group chat, reachable any time (also after the journey is over). */
export default function CabGroup() {
  const roomId = Number(useParams().id);
  const [room, setRoom] = useState<Room | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    api<{ room: Room }>(`/rooms/${roomId}/messages?after=999999999`)
      .then((r) => setRoom(r.room))
      .catch((e) => setErr(e.message));
  }, [roomId]);
  if (err) return <div className="page stack"><p className="error">{err}</p><Link to="/chats" className="back">← Chats</Link></div>;
  if (!room) return <div className="page muted">Loading…</div>;
  return (
    <div className="page stack">
      <header className="pagehead">
        <Link to="/chats" className="back">← Chats</Link>
        <h2>🚕 {room.name}</h2>
      </header>
      <GroupRoom tripId={0} rooms={[room]} pack={null} onWave={() => {}} onRoomsChanged={() => {}} />
    </div>
  );
}
