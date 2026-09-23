import { useState } from "react";
import { api, INTENT_LABEL, type Intent, type Me } from "../api";
import { useApp } from "../App";

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
  const [custom, setCustom] = useState("");
  const [err, setErr] = useState("");
  const set = (k: keyof typeof f, v: any) => setF((p) => ({ ...p, [k]: v }));

  const toggleInterest = (i: string) =>
    set("interests", f.interests.includes(i) ? f.interests.filter((x) => x !== i) : [...f.interests, i].slice(0, 15));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    try {
      const updated = await api<Me>("/me", { method: "PUT", body: { ...f, age: Number(f.age) } });
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

      {err && <p className="error">{err}</p>}
      <button className="btn primary" disabled={!f.name || !f.age || !f.gender}>
        {onboarding ? "Start travelling" : "Save"}
      </button>

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
