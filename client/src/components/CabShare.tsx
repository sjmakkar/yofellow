import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, OfflineError, type PublicUser } from "../api";
import { useApp } from "../App";
import { getSocket } from "../socket";

export type Cab = {
  id: number;
  owner: PublicUser | null;
  dropArea: string;
  leaveWhen: string;
  seats: number;
  seatsLeft: number;
  womenOnly: boolean;
  note: string | null;
  status: "open" | "closed";
  mine: "owner" | "pending" | "accepted" | "declined" | null;
  riders: number;
  people: PublicUser[];
  requests: PublicUser[];
  fare: number | null;
  perPerson: number | null;
  vehicle: string | null;
  roomId: number | null;
  match: number | null;
};

/** Booking happens in the cab apps; we open them with the drop point filled where the app supports it. */
export function bookingLinks(drop: string) {
  const q = encodeURIComponent(drop);
  return [
    { name: "Uber", href: `https://m.uber.com/ul/?action=setPickup&pickup=my_location&dropoff[formatted_address]=${q}` },
    { name: "Ola", href: "https://book.olacabs.com/" },
    { name: "Rapido", href: "https://www.rapido.bike/" },
    { name: "Maps", href: `https://www.google.com/maps/dir/?api=1&destination=${q}` },
  ];
}

export default function CabShare({ tripId, stationHint }: { tripId: number; stationHint: string }) {
  const { me, toast } = useApp();
  const [cabs, setCabs] = useState<Cab[] | null>(null);
  const [form, setForm] = useState(false);
  const [f, setF] = useState({ dropArea: "", leaveWhen: "As soon as we arrive", seats: 2, womenOnly: false, note: "" });

  const load = () => api<Cab[]>(`/trips/${tripId}/cabs`).then(setCabs).catch(() => setCabs((c) => c ?? []));
  useEffect(() => {
    load();
    const s = getSocket();
    const on = () => load();
    s?.on("cab:request", on);
    s?.on("cab:update", on);
    return () => {
      s?.off("cab:request", on);
      s?.off("cab:update", on);
    };
  }, [tripId]);

  async function call(path: string, body: object, ok?: string) {
    try {
      await api(path, { body });
      if (ok) toast(ok);
      load();
    } catch (e) {
      toast(e instanceof OfflineError ? "Cab sharing needs network" : (e as Error).message);
    }
  }

  async function post(e: React.FormEvent) {
    e.preventDefault();
    await call(`/trips/${tripId}/cabs`, f, "Posted! Co-travellers going your way can ask to join.");
    setForm(false);
  }

  const mine = cabs?.find((c) => c.mine === "owner");
  const others = (cabs || []).filter((c) => c.mine !== "owner");

  return (
    <div className="stack">
      {mine ? (
        <CabCard cab={mine} onCall={call} stationHint={stationHint} />
      ) : form ? (
        <form className="card stack" onSubmit={post}>
          <b>Share a cab after the journey</b>
          <label>
            Where are you headed?
            <input value={f.dropArea} onChange={(e) => setF({ ...f, dropArea: e.target.value })} placeholder="e.g. Koramangala, Bengaluru" required minLength={2} autoFocus />
          </label>
          <div className="row">
            <label>
              Leaving
              <input value={f.leaveWhen} onChange={(e) => setF({ ...f, leaveWhen: e.target.value })} />
            </label>
            <label>
              Seats for others
              <input type="number" min={1} max={6} value={f.seats} onChange={(e) => setF({ ...f, seats: Number(e.target.value) })} />
            </label>
          </div>
          <label>
            Note (optional)
            <input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="Meeting at exit gate 2, small bags only…" maxLength={200} />
          </label>
          {me?.gender === "woman" && (
            <label className="switch">
              <input type="checkbox" checked={f.womenOnly} onChange={(e) => setF({ ...f, womenOnly: e.target.checked })} />
              <span><b>Women only ride</b><small>Only women on this journey can see and join.</small></span>
            </label>
          )}
          <div className="row">
            <button type="button" className="btn ghost" onClick={() => setForm(false)}>Cancel</button>
            <button className="btn primary">Post</button>
          </div>
        </form>
      ) : (
        <button className="btn primary" onClick={() => setForm(true)}>🚕 I'm taking a cab after arrival</button>
      )}

      <span className="label">Cabs from this journey</span>
      {cabs === null ? (
        <p className="muted small">Loading…</p>
      ) : others.length === 0 ? (
        <p className="muted small">Nobody has posted yet. Post yours so people going the same way can find you.</p>
      ) : (
        others.map((c) => <CabCard key={c.id} cab={c} onCall={call} stationHint={stationHint} />)
      )}
      <p className="hint">Safety: meet in a busy, well lit spot, share ride details with someone you trust, and never share a cab you're unsure about.</p>
    </div>
  );
}

function CabCard({ cab: c, onCall, stationHint }: { cab: Cab; onCall: (path: string, body: object, ok?: string) => Promise<void>; stationHint: string }) {
  const { toast } = useApp();
  const [fare, setFare] = useState(c.fare ? String(c.fare) : "");
  const [vehicle, setVehicle] = useState(c.vehicle || "");
  const inGroup = c.mine === "owner" || c.mine === "accepted";

  function shareDetails() {
    const names = [c.owner?.name, ...c.people.map((p) => p.name)].filter(Boolean).join(", ");
    const text = `I'm sharing a cab from ${stationHint} to ${c.dropArea} with ${names}.${c.vehicle ? ` Cab number: ${c.vehicle}.` : ""} Via YoFellow.`;
    if (navigator.share) navigator.share({ text }).catch(() => {});
    else navigator.clipboard.writeText(text).then(() => toast("Ride details copied, paste them to someone you trust"));
  }

  return (
    <div className="card stack cab">
      <div className="row between">
        <div>
          <b>🚕 {c.dropArea}</b>
          <div className="muted small">
            {c.mine === "owner" ? "Your post" : `by ${c.owner?.name}`} · {c.leaveWhen} · {c.seatsLeft} seat{c.seatsLeft === 1 ? "" : "s"} left
          </div>
        </div>
        {c.match !== null && c.match > 0 && c.mine !== "owner" && <span className="tag">Same direction</span>}
      </div>
      {c.womenOnly && <span className="tag hot">Women only</span>}
      {c.note && <p className="small">{c.note}</p>}

      {inGroup && (
        <div className="small">
          Riding: {[c.owner?.name, ...c.people.map((p) => p.name)].filter(Boolean).join(", ")}
          {c.perPerson !== null && <> · Fare ₹{c.fare} → <b>₹{c.perPerson} each</b></>}
          {c.vehicle && <> · Cab {c.vehicle}</>}
        </div>
      )}

      {c.mine === "owner" && c.requests.length > 0 && (
        <div className="stack">
          <span className="label">Requests</span>
          {c.requests.map((p) => (
            <div key={p.id} className="row">
              <span className="grow">{p.name}, {p.age}{p.city ? ` · ${p.city}` : ""}</span>
              <button className="btn small" onClick={() => onCall(`/cabs/${c.id}/respond`, { userId: p.id, accept: false })}>Decline</button>
              <button className="btn small primary" onClick={() => onCall(`/cabs/${c.id}/respond`, { userId: p.id, accept: true }, `${p.name} joined your cab`)}>Accept</button>
            </div>
          ))}
        </div>
      )}

      {c.mine === "owner" && (
        <div className="row">
          <input inputMode="numeric" placeholder="Total fare ₹" value={fare} onChange={(e) => setFare(e.target.value.replace(/\D/g, ""))} />
          <input placeholder="Cab number" value={vehicle} onChange={(e) => setVehicle(e.target.value.toUpperCase())} maxLength={20} />
          <button className="btn small" onClick={() => onCall(`/cabs/${c.id}/details`, { fare: fare ? Number(fare) : null, vehicle: vehicle || null }, "Saved")}>Save</button>
        </div>
      )}

      {inGroup ? (
        <>
          <div className="row wrap">
            {bookingLinks(c.dropArea).map((l) => (
              <a key={l.name} className="btn small" href={l.href} target="_blank" rel="noreferrer">{l.name}</a>
            ))}
          </div>
          <div className="row wrap">
            {c.roomId && <Link className="btn small primary" to={`/groups/${c.roomId}`}>💬 Cab chat</Link>}
            <button className="btn small" onClick={shareDetails}>Share ride details</button>
            <button className="btn small ghost" onClick={() => confirm(c.mine === "owner" ? "Close this cab share?" : "Leave this cab?") && onCall(`/cabs/${c.id}/leave`, {})}>
              {c.mine === "owner" ? "Close" : "Leave"}
            </button>
          </div>
        </>
      ) : c.mine === "pending" ? (
        <button className="btn" disabled>Request sent, waiting for {c.owner?.name}</button>
      ) : c.mine === "declined" ? (
        <p className="muted small">This cab is full or not available for you.</p>
      ) : (
        <button className="btn primary" disabled={c.seatsLeft === 0} onClick={() => onCall(`/cabs/${c.id}/request`, {}, `Asked ${c.owner?.name} to join`)}>
          {c.seatsLeft === 0 ? "Full" : "Ask to join"}
        </button>
      )}
    </div>
  );
}
