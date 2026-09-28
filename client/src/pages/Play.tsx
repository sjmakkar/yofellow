import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { useApp } from "../App";
import { usePlaySession, GAME_INFO, type PlaySession } from "../lib/play";
import GameView from "../components/GameView";

export default function Play() {
  const id = Number(useParams().id);
  const { me, toast } = useApp();
  const nav = useNavigate();
  const { s, setS, error } = usePlaySession(id);
  const [busy, setBusy] = useState(false);

  if (error) return <div className="page stack"><p className="error">{error}</p><Link to="/games" className="back">← Games</Link></div>;
  if (!s || !me) return <div className="page muted">Loading game…</div>;

  const mySeat = s.seats.findIndex((x) => x.user === me.id);
  const seated = mySeat >= 0;
  const info = GAME_INFO[s.kind];

  async function act(path: string, body: object = {}) {
    setBusy(true);
    try {
      setS(await api<PlaySession>(`/play/${id}/${path}`, { body }));
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function rematch() {
    try {
      const n = await api<PlaySession>("/play", { body: { kind: s!.kind, matchId: s!.matchId } });
      nav(`/play/${n.id}`, { replace: true });
    } catch (e) {
      toast((e as Error).message);
    }
  }

  const back = s.matchId ? `/chats/${s.matchId}` : "/games";

  return (
    <div className="page stack">
      <header className="pagehead">
        <Link to={back} className="back">← Back</Link>
        <h2>{info.icon} {info.title}</h2>
      </header>

      {s.status === "waiting" ? (
        <div className="card stack">
          <b>Waiting for players ({s.seats.length}/{s.maxPlayers})</b>
          <div className="chips">
            {s.seats.map((x, i) => <span key={i} className="chip on">{x.name}{x.user === me.id ? " (you)" : ""}</span>)}
            {Array.from({ length: s.maxPlayers - s.seats.length }, (_, i) => <span key={`e${i}`} className="chip">Empty seat</span>)}
          </div>
          <p className="muted small">{info.blurb} Anyone on your journey can join from the Games tab of the trip.{s.womenOnly ? " Women only table." : ""}</p>
          {!seated && <button className="btn primary" disabled={busy} onClick={() => act("join")}>Join this table</button>}
          {s.createdBy === me.id && (
            <>
              {s.seats.length >= s.minPlayers && <button className="btn primary" disabled={busy} onClick={() => act("start", { fillBots: false })}>Start with {s.seats.length} players</button>}
              {s.seats.length < s.maxPlayers && <button className="btn" disabled={busy} onClick={() => act("start", { fillBots: true })}>Start now, computer fills empty seats</button>}
            </>
          )}
          {seated && <button className="btn ghost" disabled={busy} onClick={() => act("leave").then(() => nav(back))}>Leave table</button>}
        </div>
      ) : (
        <GameView
          kind={s.kind}
          title={s.title}
          seats={s.seats}
          state={s.state}
          mySeat={seated ? mySeat : null}
          turn={s.turn}
          status={s.status}
          winners={s.winners}
          resultText={s.resultText}
          busy={busy}
          onMove={(m) => act("move", { move: m })}
          actions={
            s.status === "active" && seated ? (
              <button className="btn ghost small" onClick={() => confirm(s.kind === "ludo" && s.seats.length > 2 ? "Leave? A computer player will take your place." : "Resign this game?") && act("leave")}>
                {s.kind === "ludo" && s.seats.length > 2 ? "Leave game" : "Resign"}
              </button>
            ) : s.status === "done" ? (
              <>
                {s.matchId && <button className="btn primary" onClick={rematch}>Play again</button>}
                <Link className="btn" to={back}>Done</Link>
              </>
            ) : null
          }
        />
      )}
    </div>
  );
}
