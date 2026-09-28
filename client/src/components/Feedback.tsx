import { useState } from "react";
import { useLocation } from "react-router-dom";
import { api } from "../api";
import { useApp } from "../App";

/** "Tell us" sheet: a star rating plus free text, sent with the current screen. */
export default function Feedback({ onClose }: { onClose: () => void }) {
  const { toast } = useApp();
  const loc = useLocation();
  const [rating, setRating] = useState(0);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function send() {
    setBusy(true);
    setErr("");
    try {
      await api("/feedback", { body: { message, rating: rating || undefined, page: loc.pathname } });
      toast("Thanks! We read every message 🙏");
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h3>Tell us what you think</h3>
        <p className="hint">Bugs, ideas, a train where nobody was around. Anything helps.</p>
        <div className="stars" role="radiogroup" aria-label="Rating">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} type="button" aria-label={`${n} stars`} className={n <= rating ? "on" : ""} onClick={() => setRating(n)}>
              ★
            </button>
          ))}
        </div>
        <textarea rows={4} maxLength={2000} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="What should we fix or add?" autoFocus />
        {err && <p className="error">{err}</p>}
        <button className="btn primary" disabled={busy || message.trim().length < 2} onClick={send}>
          {busy ? "Sending…" : "Send feedback"}
        </button>
        <button className="btn ghost" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}
