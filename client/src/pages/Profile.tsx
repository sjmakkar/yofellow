import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, tokenStore, INTENT_LABEL, type Intent, type Me } from "../api";
import { useApp } from "../App";
import Feedback from "../components/Feedback";
import { changeEmail, resetPassword } from "../lib/auth";
import { currentSubscription, disablePush, enablePush, isIos, isStandalone, pushSupported } from "../lib/push";

const SUGGESTED = ["music", "movies", "books", "travel", "cricket", "football", "coding", "startups", "ai", "food", "chai", "trekking", "photography", "art", "gaming", "fitness", "anime", "debate", "dance", "guitar"];

export default function Profile({ onboarding = false }: { onboarding?: boolean }) {
  const { me, setMe, logout, toast } = useApp();
  const [f, setF] = useState({
    name: me?.name || "",
    age: me?.age ? String(me.age) : "",
    gender: me?.gender || "",
    city: me?.city || "",
    bio: me?.bio || "",
    interests: me?.interests || [],
    intent: (me?.intent || "friends") as Intent,
    showMe: me?.showMe || "everyone",
    womenOnly: me?.womenOnly || false,
    hidden: me?.hidden || false,
  });
  const needsTerms = !me?.acceptedTerms;
  const [agree, setAgree] = useState(false);
  const [feedback, setFeedback] = useState(false);
  const [custom, setCustom] = useState("");
  const [err, setErr] = useState("");
  const set = (k: keyof typeof f, v: any) => setF((p) => ({ ...p, [k]: v }));

  const toggleInterest = (i: string) =>
    set("interests", f.interests.includes(i) ? f.interests.filter((x) => x !== i) : [...f.interests, i].slice(0, 15));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    try {
      const updated = await api<Me>("/me", { method: "PUT", body: { ...f, age: Number(f.age), ...(needsTerms ? { acceptTerms: agree } : {}) } });
      setMe(updated);
      if (!onboarding) toast("Profile saved");
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function deleteAccount() {
    if (!confirm("Delete your account and all your data? This cannot be undone.")) return;
    await api("/me", { method: "DELETE" });
    logout();
  }

  async function downloadData() {
    try {
      const res = await fetch("/api/me/export", { headers: { Authorization: `Bearer ${tokenStore.get()}` } });
      if (!res.ok) throw new Error();
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = "yofellow-my-data.json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      toast("Couldn't download right now. Try again with network.");
    }
  }

  const allTags = [...new Set([...SUGGESTED, ...f.interests])];

  return (
    <form className="page stack" onSubmit={save}>
      <header className="pagehead">
        <h2>{onboarding ? "Set up your profile" : "Your profile"}</h2>
        {onboarding && <p className="muted">Co-travellers only see your first name, age, city and interests.</p>}
      </header>

      <div className="card stack">
        <label>
          First name
          <input value={f.name} onChange={(e) => set("name", e.target.value)} maxLength={40} required />
        </label>
        <div className="row">
          <label>
            Age
            <input type="number" min={18} max={99} value={f.age} onChange={(e) => set("age", e.target.value)} required />
          </label>
          <label>
            City
            <input value={f.city} onChange={(e) => set("city", e.target.value)} placeholder="Sirsa" />
          </label>
        </div>
        <div>
          <span className="label">I am</span>
          <div className="seg">
            {[
              ["woman", "Woman"],
              ["man", "Man"],
              ["nonbinary", "Non binary"],
            ].map(([v, l]) => (
              <button type="button" key={v} className={f.gender === v ? "on" : ""} onClick={() => set("gender", v)}>
                {l}
              </button>
            ))}
          </div>
        </div>
        <label>
          Short bio
          <textarea rows={2} maxLength={200} value={f.bio} onChange={(e) => set("bio", e.target.value)} placeholder="What should co-travellers know about you?" />
        </label>
      </div>

      <div className="card stack">
        <span className="label">Interests (pick a few, they power your vibe score)</span>
        <div className="chips">
          {allTags.map((t) => (
            <button type="button" key={t} className={`chip ${f.interests.includes(t) ? "on" : ""}`} onClick={() => toggleInterest(t)}>
              {t}
            </button>
          ))}
        </div>
        <div className="row">
          <input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Add your own" />
          <button
            type="button"
            className="btn small"
            onClick={() => {
              const t = custom.trim().toLowerCase();
              if (t && !f.interests.includes(t)) set("interests", [...f.interests, t]);
              setCustom("");
            }}
          >
            Add
          </button>
        </div>
      </div>

      <div className="card stack">
        <span className="label">Usually I'm open to</span>
        <div className="seg">
          {(Object.keys(INTENT_LABEL) as Intent[]).map((i) => (
            <button type="button" key={i} className={f.intent === i ? "on" : ""} onClick={() => set("intent", i)}>
              {INTENT_LABEL[i]}
            </button>
          ))}
        </div>
        {f.intent === "dating" && (
          <>
            <span className="label">Show me</span>
            <div className="seg">
              {[
                ["everyone", "Everyone"],
                ["women", "Women"],
                ["men", "Men"],
              ].map(([v, l]) => (
                <button type="button" key={v} className={f.showMe === v ? "on" : ""} onClick={() => set("showMe", v)}>
                  {l}
                </button>
              ))}
            </div>
          </>
        )}
        <p className="hint">You can change this for each trip.</p>
      </div>

      <div className="card stack">
        <span className="label">Safety</span>
        {f.gender === "woman" && (
          <label className="switch">
            <input type="checkbox" checked={f.womenOnly} onChange={(e) => set("womenOnly", e.target.checked)} />
            <span>
              <b>Women only mode</b>
              <small>Only women can see you, and you only see women.</small>
            </span>
          </label>
        )}
        <label className="switch">
          <input type="checkbox" checked={f.hidden} onChange={(e) => set("hidden", e.target.checked)} />
          <span>
            <b>Hide me</b>
            <small>Nobody new can find you. Existing chats stay open.</small>
          </span>
        </label>
      </div>

      {needsTerms && (
        <label className="switch consent">
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
          <span>
            <b>I'm 18 or older</b>
            <small>
              and I accept the <Link to="/terms">Terms</Link> and <Link to="/privacy">Privacy Policy</Link>.
            </small>
          </span>
        </label>
      )}

      {err && <p className="error">{err}</p>}
      <button className="btn primary" disabled={!f.name || !f.age || !f.gender || (needsTerms && !agree)}>
        {onboarding ? "Start travelling" : "Save"}
      </button>

      {!onboarding && <Account />}

      {!onboarding && <Notifications />}

      {!onboarding && (
        <div className="card stack">
          <span className="label">More</span>
          {me?.isAdmin && (
            <Link className="btn" to="/admin">
              🛡️ Admin panel
            </Link>
          )}
          <button type="button" className="btn" onClick={() => setFeedback(true)}>
            💬 Send feedback
          </button>
          <button type="button" className="btn" onClick={downloadData}>
            ⬇️ Download my data
          </button>
          <p className="hint center-text">
            <Link to="/terms">Terms</Link> · <Link to="/privacy">Privacy</Link>
          </p>
        </div>
      )}
      {feedback && <Feedback onClose={() => setFeedback(false)} />}

      {!onboarding && (
        <div className="stack">
          <button type="button" className="btn ghost" onClick={logout}>
            Log out
          </button>
          <button type="button" className="btn danger-ghost" onClick={deleteAccount}>
            Delete account
          </button>
        </div>
      )}
    </form>
  );
}

function Notifications() {
  const { toast } = useApp();
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const supported = pushSupported();
  const iosNeedsInstall = isIos() && !isStandalone();

  useEffect(() => {
    currentSubscription().then((s) => setOn(!!s && Notification.permission === "granted"));
  }, []);

  async function toggle() {
    setBusy(true);
    try {
      if (on) {
        await disablePush();
        setOn(false);
      } else {
        await enablePush();
        setOn(true);
        toast("Notifications on 🔔");
      }
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    try {
      const r = await api<{ sent: number }>("/push/test", { method: "POST" });
      toast(r.sent ? "Test sent. Check your notifications." : "No device got it. Turn notifications off and on again.");
    } catch (e) {
      toast((e as Error).message);
    }
  }

  return (
    <div className="card stack">
      <span className="label">Notifications</span>
      {iosNeedsInstall ? (
        <p className="hint">On iPhone, tap Share → Add to Home Screen, then open YoFellow from your home screen to turn on notifications.</p>
      ) : !supported ? (
        <p className="hint">This browser can't show notifications.</p>
      ) : (
        <>
          <label className="switch">
            <input type="checkbox" checked={!!on} disabled={busy || on === null} onChange={toggle} />
            <span>
              <b>Alert me when the app is closed</b>
              <small>Waves, matches, new messages, game turns and cab requests.</small>
            </span>
          </label>
          {on && (
            <button type="button" className="btn small ghost" onClick={test}>
              Send me a test
            </button>
          )}
        </>
      )}
    </div>
  );
}

const PROVIDER: Record<string, string> = { "google.com": "Google", password: "email and password", phone: "phone number" };

function Account() {
  const { me, toast } = useApp();
  const [open, setOpen] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  if (!me) return null;
  const provider = me.provider || (me.phone ? "phone" : "");
  const isPassword = provider === "password" && !!me.email;

  async function doChange(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      await changeEmail(newEmail, password);
      setMsg(`We sent a link to ${newEmail}. Your email changes only after you tap it, so your account stays verified. Then sign in with the new email.`);
      setPassword("");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function doReset() {
    try {
      await resetPassword(me!.email!);
      toast(`Password reset link sent to ${me!.email}`);
    } catch (e) {
      toast((e as Error).message);
    }
  }

  return (
    <div className="card stack">
      <span className="label">Account</span>
      <div className="row between">
        <div className="stack tight">
          <b>{me.email || me.phone || "No email"}</b>
          <small className="muted">Signed in with {PROVIDER[provider] || provider || "dev login"}</small>
        </div>
        {me.emailVerified || me.phone ? <span className="verified">✓ Verified</span> : <span className="unverified">Not verified</span>}
      </div>
      {provider === "google.com" && <p className="hint">Your email comes from your Google account.</p>}
      {isPassword && !open && (
        <div className="row wrap">
          <button type="button" className="btn small" onClick={() => setOpen(true)}>
            Change email
          </button>
          <button type="button" className="btn small ghost" onClick={doReset}>
            Reset password
          </button>
        </div>
      )}
      {isPassword && open && (
        <form className="stack" onSubmit={doChange}>
          <label>
            New email
            <input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} required />
          </label>
          <label>
            Current password
            <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </label>
          <div className="row wrap">
            <button className="btn small primary" disabled={busy || !newEmail.includes("@") || !password}>
              {busy ? "Sending…" : "Send verification link"}
            </button>
            <button type="button" className="btn small ghost" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
      {msg && <p className="info">{msg}</p>}
      {err && <p className="error">{err}</p>}
    </div>
  );
}
