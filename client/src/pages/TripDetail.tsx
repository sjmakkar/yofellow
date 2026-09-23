import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, INTENT_LABEL, MODE_ICON, MODE_LABEL, OfflineError, type Pack, type Room, type Traveller } from "../api";
import { useApp } from "../App";
import { getSocket } from "../socket";
import { formatDate } from "./Trips";
import Avatar from "../components/Avatar";
import GroupRoom from "../components/GroupRoom";
import { savePack } from "../lib/group";
import { kvGet } from "../lib/idb";
import { enqueue } from "../lib/outbox";
import { joinMesh, leaveMesh, radioEnabled } from "../lib/mesh";
import { deviceKey } from "../lib/keys";
import { useNet } from "../lib/net";
import { consentKey, forecast, usePosition, useSignalLogger } from "../lib/signal";

export default function TripDetail() {
  const { id } = useParams();
  const tripId = Number(id);
  const nav = useNavigate();
  const { me, toast } = useApp();
  const n = useNet();
  const [pack, setPack] = useState<Pack | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [travellers, setTravellers] = useState<Traveller[]>([]);
  const [tab, setTab] = useState<"group" | "people">("group");
  const [err, setErr] = useState("");
  const [myKey, setMyKey] = useState<string | null>(null);
  const [share, setShare] = useState(() => {
    try {
      return localStorage.getItem(consentKey(tripId)) === "1";
    } catch {
      return false;
    }
  });

  // 1. Show the saved offline pack immediately. 2. Refresh it from the server when possible.
  async function load() {
    const local = await kvGet<Pack>(`pack:${tripId}`);
    if (local) apply(local);
    try {
      const fresh = await api<Pack>(`/trips/${tripId}/pack`);
      await savePack(tripId, fresh);
      apply(fresh);
    } catch (e) {
      if (!local) setErr(e instanceof OfflineError ? "You're offline and this trip wasn't saved for offline yet. Open it once with network." : (e as Error).message);
    }
  }
  function apply(p: Pack) {
    setPack(p);
    setRooms(p.rooms.map(({ messages, ...r }) => r));
    setTravellers(p.travellers);
  }

  async function refreshPeople() {
    try {
      const r = await api<{ travellers: Traveller[] }>(`/trips/${tripId}/travellers`);
      setTravellers(r.travellers);
    } catch {
      /* offline: keep what we have */
    }
  }
  async function refreshRooms() {
    try {
      setRooms(await api<Room[]>(`/trips/${tripId}/rooms`));
    } catch {
      /* offline */
    }
  }

  useEffect(() => {
    load();
    deviceKey().then((k) => setMyKey(k.publicKey));
    const s = getSocket();
    s?.on("wave", refreshPeople);
    s?.on("match", refreshPeople);
    return () => {
      s?.off("wave", refreshPeople);
      s?.off("match", refreshPeople);
    };
  }, [tripId]);

  // Join the offline mesh for this journey, trusting the keys of people on it.
  const keysRef = useRef<Pack["keys"]>({});
  keysRef.current = pack?.keys || {};
  useEffect(() => {
    if (!pack || !me || !myKey) return;
    joinMesh(pack.trip.key, (sender) => (sender === me.id ? [myKey] : keysRef.current[sender]), pack.serverKey);
    return () => leaveMesh();
  }, [pack?.trip.key, me?.id, myKey]);

  const isToday = pack?.trip.date === new Date().toISOString().slice(0, 10);
  const { pos, error: posErr } = usePosition(share);
  useSignalLogger(tripId, share && !!isToday, pos);
  const fc = forecast(pack?.signal, pos);

  async function wave(userId: number) {
    const t = travellers.find((x) => x.user.id === userId);
    const name = t?.user.name || "them";
    try {
      const r = await api<{ matched: boolean; matchId?: number }>("/waves", { body: { toId: userId, tripId } });
      if (r.matched && r.matchId) {
        toast(`🎉 It's a match with ${name}!`);
        nav(`/chats/${r.matchId}`);
      } else {
        toast(`👋 Waved at ${name}. If they wave back, chat opens.`);
        refreshPeople();
      }
    } catch (e) {
      if (e instanceof OfflineError) {
        await enqueue({ op: "wave", toId: userId, tripId });
        setTravellers((list) => list.map((x) => (x.user.id === userId ? { ...x, iWaved: true } : x)));
        toast(`👋 Wave to ${name} will send when you're back online`);
      } else toast((e as Error).message);
    }
  }

  async function removeTrip() {
    if (!confirm("Remove this trip?")) return;
    await api(`/trips/${tripId}`, { method: "DELETE" });
    nav("/");
  }

  function toggleShare() {
    const next = !share;
    setShare(next);
    try {
      localStorage.setItem(consentKey(tripId), next ? "1" : "0");
    } catch {
      /* ignore */
    }
  }

  if (err) return <div className="page stack"><p className="error">{err}</p><Link to="/" className="back">← Trips</Link></div>;
  if (!pack) return <div className="page muted">Loading…</div>;
  const trip = pack.trip;

  return (
    <div className="page stack tripdetail">
      <header className="pagehead row between">
        <div>
          <Link to="/" className="back">← Trips</Link>
          <h2>
            {MODE_ICON[trip.mode]} {MODE_LABEL[trip.mode]} {trip.number}
          </h2>
          <p className="muted small">
            {formatDate(trip.date)}
            {trip.coach ? ` · ${trip.coach}` : ""} · {INTENT_LABEL[trip.intent]}
          </p>
        </div>
        <button className="btn small ghost" onClick={removeTrip}>Remove</button>
      </header>

      <div className="card journey">
        <div className="row between">
          <b>📶 Network forecast</b>
          <span className="small muted">Saved for offline ✓</span>
        </div>
        {share ? (
          <p className="small">{fc ? fc.text : posErr || "Finding your location…"}</p>
        ) : (
          <p className="small muted">See where the network drops on this route, and help other travellers by sharing signal data (location + online/offline, once a minute, only during this trip).</p>
        )}
        <div className="row">
          <button className={`btn small ${share ? "" : "primary"}`} onClick={toggleShare}>
            {share ? "Stop sharing" : "Turn on forecast"}
          </button>
          {radioEnabled() && <span className="small muted">{n.nearby ? `📡 ${n.nearby} phone${n.nearby > 1 ? "s" : ""} in range` : "📡 Looking for nearby phones"}</span>}
        </div>
      </div>

      <div className="seg tabs2">
        <button className={tab === "group" ? "on" : ""} onClick={() => setTab("group")}>💬 Group</button>
        <button className={tab === "people" ? "on" : ""} onClick={() => setTab("people")}>🙂 People ({travellers.length})</button>
      </div>

      {tab === "group" ? (
        <GroupRoom tripId={tripId} rooms={rooms} pack={pack} onWave={wave} onRoomsChanged={refreshRooms} />
      ) : (
        <People travellers={travellers} trip={trip} onWave={wave} />
      )}
    </div>
  );
}

function People({ travellers, trip, onWave }: { travellers: Traveller[]; trip: Pack["trip"]; onWave: (id: number) => void }) {
  const { toast } = useApp();
  if (travellers.length === 0)
    return (
      <div className="empty card stack">
        <div className="big">🪟</div>
        <p><b>No one here yet.</b> You are early!</p>
        <p className="muted small">Share your trip so friends on the same journey can join.</p>
        <button
          className="btn"
          onClick={() => {
            const text = `I'm on ${MODE_LABEL[trip.mode]} ${trip.number} on ${trip.date}. Join me on YoFellow!`;
            if (navigator.share) navigator.share({ text, url: location.origin });
            else navigator.clipboard.writeText(`${text} ${location.origin}`).then(() => toast("Copied invite"));
          }}
        >
          Share this trip
        </button>
      </div>
    );
  return (
    <>
      <p className="muted small">{travellers.length} on board who match your settings, best vibe first</p>
      {travellers.map((t) => (
        <div key={t.user.id} className="card person">
          <div className="row">
            <Avatar name={t.user.name} />
            <div className="grow">
              <b>{t.user.name}, {t.user.age}</b>
              <div className="muted small">{t.user.city || "Somewhere nice"} · {INTENT_LABEL[t.intent]}</div>
            </div>
            <div className="vibe" style={{ ["--v" as any]: t.vibe }}>
              <span>{t.vibe}</span>
              <small>vibe</small>
            </div>
          </div>
          {t.user.bio && <p className="bio">{t.user.bio}</p>}
          <div className="chips">
            {t.user.interests.map((i) => (
              <span key={i} className={`chip ${t.shared.includes(i) ? "on" : ""}`}>{i}</span>
            ))}
          </div>
          <div className="tags">
            {t.sameCoach && <span className="tag">Same coach</span>}
            {t.sameCity && <span className="tag">Same city</span>}
            {t.theyWaved && !t.matchId && <span className="tag hot">Waved at you</span>}
          </div>
          {t.matchId ? (
            <Link className="btn primary" to={`/chats/${t.matchId}`}>Open chat</Link>
          ) : t.iWaved ? (
            <button className="btn" disabled>Waved, waiting for them</button>
          ) : (
            <button className="btn primary" onClick={() => onWave(t.user.id)}>{t.theyWaved ? "Wave back and chat" : "👋 Wave"}</button>
          )}
        </div>
      ))}
    </>
  );
}

