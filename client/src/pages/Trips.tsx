import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, COACH_HINT, INTENT_LABEL, MODE_ICON, MODE_LABEL, NUMBER_HINT, type Intent, type Mode, type Trip } from "../api";
import { useApp } from "../App";
import { savePack } from "../lib/group";
import { kvGet } from "../lib/idb";
import type { Pack } from "../api";

const today = () => new Date().toISOString().slice(0, 10);

export function formatDate(d: string) {
  const t = today();
  if (d === t) return "Today";
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  if (d === tomorrow) return "Tomorrow";
  return new Date(d + "T00:00:00").toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
}

export default function Trips() {
  const { me } = useApp();
  const [trips, setTrips] = useState<Trip[] | null>(null);
  const [adding, setAdding] = useState(false);

  const [ready, setReady] = useState<Record<number, boolean>>({});

  // Load trips (from cache when offline), then save each trip for offline use.
  const load = () =>
    api<Trip[]>("/trips")
      .then(async (list) => {
        setTrips(list);
        for (const t of list) {
          if (await kvGet(`pack:${t.id}`)) setReady((r) => ({ ...r, [t.id]: true }));
          api<Pack>(`/trips/${t.id}/pack`)
            .then((p) => savePack(t.id, p))
            .then(() => setReady((r) => ({ ...r, [t.id]: true })))
            .catch(() => {});
        }
      })
      .catch(() => setTrips([]));
  useEffect(() => {
    load();
  }, []);

  return (
    <div className="page stack">
      <header className="pagehead">
        <h2>Hi {me?.name} 👋</h2>
        <p className="muted">Add your journey to see who else is on board.</p>
      </header>

      {trips === null ? (
        <p className="muted">Loading…</p>
      ) : trips.length === 0 && !adding ? (
        <div className="empty card">
          <div className="big">🚆 ✈️ 🚌</div>
          <p>No upcoming trips yet.</p>
        </div>
      ) : (
        trips.map((t) => (
          <Link to={`/trips/${t.id}`} key={t.id} className="card trip">
            <div className="tripicon">{MODE_ICON[t.mode]}</div>
            <div className="grow">
              <b>
                {MODE_LABEL[t.mode]} {t.number}
              </b>
              <div className="muted small">
                {formatDate(t.date)}
                {t.coach ? ` · ${t.coach}` : ""} · {INTENT_LABEL[t.intent]}
              </div>
            </div>
            <div className="stackright">
              <div className={`pill ${t.othersOnTrip ? "live" : ""}`}>{t.othersOnTrip} on board</div>
              {ready[t.id] && <small className="offready">✓ Offline ready</small>}
            </div>
          </Link>
        ))
      )}

      {adding ? (
        <AddTrip
          onDone={(t) => {
            setAdding(false);
            if (t) load();
          }}
        />
      ) : (
        <button className="btn primary" onClick={() => setAdding(true)}>
          + Add a journey
        </button>
      )}
    </div>
  );
}

function AddTrip({ onDone }: { onDone: (t?: Trip) => void }) {
  const { me } = useApp();
  const nav = useNavigate();
  const [mode, setMode] = useState<Mode>("train");
  const [number, setNumber] = useState("");
  const [date, setDate] = useState(today());
  const [coach, setCoach] = useState("");
  const [intent, setIntent] = useState<Intent>(me?.intent || "friends");
  const [err, setErr] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    try {
      const t = await api<Trip>("/trips", { body: { mode, number, date, coach, intent } });
      onDone(t);
      nav(`/trips/${t.id}`);
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  return (
    <form className="card stack" onSubmit={submit}>
      <div className="seg four">
        {(Object.keys(MODE_LABEL) as Mode[]).map((m) => (
          <button type="button" key={m} className={mode === m ? "on" : ""} onClick={() => setMode(m)}>
            {MODE_ICON[m]} {MODE_LABEL[m]}
          </button>
        ))}
      </div>
      <label>
        {NUMBER_HINT[mode]}
        <input value={number} onChange={(e) => setNumber(e.target.value.toUpperCase())} required autoFocus />
      </label>
      <div className="row">
        <label>
          Date
          <input type="date" value={date} min={today()} onChange={(e) => setDate(e.target.value)} required />
        </label>
        <label>
          {COACH_HINT[mode]}
          <input value={coach} onChange={(e) => setCoach(e.target.value.toUpperCase())} maxLength={10} />
        </label>
      </div>
      <span className="label">On this trip I'm open to</span>
      <div className="seg">
        {(Object.keys(INTENT_LABEL) as Intent[]).map((i) => (
          <button type="button" key={i} className={intent === i ? "on" : ""} onClick={() => setIntent(i)}>
            {INTENT_LABEL[i]}
          </button>
        ))}
      </div>
      <p className="hint">Your coach is private. It is only shared if you and a match both tap Meet.</p>
      {err && <p className="error">{err}</p>}
      <div className="row">
        <button type="button" className="btn ghost" onClick={() => onDone()}>
          Cancel
        </button>
        <button className="btn primary">Find co-travellers</button>
      </div>
    </form>
  );
}
