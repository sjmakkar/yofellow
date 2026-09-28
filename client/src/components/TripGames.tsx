import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, OfflineError } from "../api";
import { useApp } from "../App";
import { GAME_INFO, type PlaySession } from "../lib/play";
import { getSocket } from "../socket";

export default function TripGames({ tripId, tripKey }: { tripId: number; tripKey: string }) {
  const { me, toast } = useApp();
  const nav = useNavigate();
  const [tables, setTables] = useState<PlaySession[] | null>(null);
  const [kind, setKind] = useState<keyof typeof GAME_INFO>("ludo");
  const [players, setPlayers] = useState(4);

  const load = () => api<PlaySession[]>(`/trips/${tripId}/play`).then(setTables).catch(() => setTables((t) => t ?? []));
  useEffect(() => {
    load();
    const s = getSocket();
    const onLobby = (d: { tripKey: string }) => d.tripKey === tripKey && load();
    s?.on("play:lobby", onLobby);
    return () => {
      s?.off("play:lobby", onLobby);
    };
  }, [tripId]);

  async function create() {
    try {
      const t = await api<PlaySession>("/play", { body: { kind, tripId, players: kind === "ludo" ? players : 2 } });
      nav(`/play/${t.id}`);
    } catch (e) {
      toast(e instanceof OfflineError ? "Tables need network. Try a solo game meanwhile!" : (e as Error).message);
    }
  }

  async function join(t: PlaySession) {
    try {
      await api(`/play/${t.id}/join`, { body: {} });
      nav(`/play/${t.id}`);
    } catch (e) {
      toast((e as Error).message);
    }
  }

  const open = (tables || []).filter((t) => t.status === "waiting");
  const running = (tables || []).filter((t) => t.status !== "waiting");

  return (
    <div className="stack">
      <div className="card stack">
        <b>Start a table</b>
        <div className="seg">
          {Object.entries(GAME_INFO).map(([k, g]) => (
            <button key={k} className={kind === k ? "on" : ""} onClick={() => setKind(k as keyof typeof GAME_INFO)}>{g.icon} {g.title}</button>
          ))}
        </div>
        {kind === "ludo" && (
          <div className="row">
            <span className="small muted">Seats</span>
            <div className="seg grow">
              {[2, 3, 4].map((n) => <button key={n} className={players === n ? "on" : ""} onClick={() => setPlayers(n)}>{n}</button>)}
            </div>
          </div>
        )}
        <button className="btn primary" onClick={create}>Open table for this journey</button>
        <p className="hint">Anyone on your train can join. You can also start straight away and let the computer fill empty seats.</p>
      </div>

      <span className="label">Open tables {open.length ? `(${open.length})` : ""}</span>
      {tables === null ? (
        <p className="muted small">Loading…</p>
      ) : open.length === 0 ? (
        <p className="muted small">No open tables yet. Start one, or <Link to="/games" className="back">play solo</Link>.</p>
      ) : (
        open.map((t) => {
          const seated = t.seats.some((s) => s.user === me?.id);
          return (
            <div key={t.id} className="card chatrow">
              <span className="gicon">{GAME_INFO[t.kind].icon}</span>
              <div className="grow">
                <b>{t.title}</b> <small className="muted">{t.seats.length}/{t.maxPlayers}</small>
                <div className="muted small ellipsis">{t.seats.map((s) => s.name).join(", ")}{t.womenOnly ? " · women only" : ""}</div>
              </div>
              {seated ? <Link className="btn small" to={`/play/${t.id}`}>Open</Link> : <button className="btn small primary" onClick={() => join(t)}>Join</button>}
            </div>
          );
        })
      )}

      {running.length > 0 && (
        <>
          <span className="label">Playing now</span>
          {running.map((t) => (
            <Link key={t.id} to={`/play/${t.id}`} className="card chatrow">
              <span className="gicon">{GAME_INFO[t.kind].icon}</span>
              <div className="grow">
                <b>{t.title}</b>
                <div className="muted small ellipsis">{t.seats.map((s) => s.name).join(" vs ")}</div>
              </div>
              <span className="pill">{t.status === "done" ? "Finished" : "Watch"}</span>
            </Link>
          ))}
        </>
      )}
    </div>
  );
}
