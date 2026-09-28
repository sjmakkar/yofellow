// Admin panel for the pilot: numbers, reports queue, users, feedback.
// Only visible to phones listed in ADMIN_PHONES on the server.
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type PublicUser } from "../api";
import { useApp } from "../App";

type AdminUser = PublicUser & { phone: string; hidden: boolean; banned: boolean; isAdmin: boolean };
type Stats = {
  days: number;
  daily: { day: string; name: string; n: number; users: number }[];
  dau: { day: string; users: number }[];
  totals: Record<string, number>;
  journeys: { total: number; shared: number } | null;
};
type Reports = {
  people: { id: number; reason: string; created_at: string; reported: AdminUser | null; reporter: AdminUser | null }[];
  messages: { message_uuid: string; reason: string; created_at: string; body: string; hidden: number; room_name: string; sender: AdminUser | null; reporter: AdminUser | null }[];
};
type Fb = { id: number; name: string | null; rating: number | null; message: string; page: string | null; status: string; created_at: string };

const TOTAL_LABEL: Record<string, string> = {
  users: "Users",
  active7d: "Active 7d",
  trips: "Trips",
  matches: "Matches",
  privateMessages: "Private msgs",
  groupMessages: "Group msgs",
  games: "Games",
  cabShares: "Cab shares",
  pushDevices: "Push devices",
  openReports: "Open reports",
  newFeedback: "New feedback",
};
const when = (s: string) => new Date(s).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export default function Admin() {
  const { me } = useApp();
  const [tab, setTab] = useState<"stats" | "reports" | "users" | "feedback">("stats");
  if (!me?.isAdmin)
    return (
      <div className="page">
        <p className="muted">Admins only.</p>
        <Link to="/">Back</Link>
      </div>
    );
  return (
    <div className="page stack admin">
      <header className="pagehead">
        <h2>🛡️ Admin</h2>
      </header>
      <div className="seg tabs4">
        {(["stats", "reports", "users", "feedback"] as const).map((t) => (
          <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>
      {tab === "stats" && <StatsTab />}
      {tab === "reports" && <ReportsTab />}
      {tab === "users" && <UsersTab />}
      {tab === "feedback" && <FeedbackTab />}
    </div>
  );
}

function StatsTab() {
  const [s, setS] = useState<Stats | null>(null);
  const [days, setDays] = useState(14);
  const [err, setErr] = useState("");
  useEffect(() => {
    api<Stats>(`/admin/stats?days=${days}`).then(setS, (e) => setErr(e.message));
  }, [days]);
  if (err) return <p className="error">{err}</p>;
  if (!s) return <p className="muted">Loading…</p>;

  const maxDau = Math.max(1, ...s.dau.map((d) => d.users));
  const byEvent = new Map<string, number>();
  for (const r of s.daily) byEvent.set(r.name, (byEvent.get(r.name) || 0) + r.n);
  const events = [...byEvent.entries()].sort((a, b) => b[1] - a[1]);
  const j = s.journeys;

  return (
    <>
      <div className="stat-grid">
        {Object.entries(s.totals).map(([k, v]) => (
          <div key={k} className={`stat ${(k === "openReports" || k === "newFeedback") && v ? "alert" : ""}`}>
            <b>{v}</b>
            <span>{TOTAL_LABEL[k] || k}</span>
          </div>
        ))}
      </div>

      <div className="card stack">
        <div className="row between">
          <span className="label">Daily active people</span>
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={7}>7 days</option>
            <option value={14}>14 days</option>
            <option value={30}>30 days</option>
          </select>
        </div>
        {s.dau.length ? (
          <div className="bars">
            {s.dau.map((d) => (
              <div key={d.day} className="bar" title={`${d.day}: ${d.users}`}>
                <i style={{ height: `${(d.users / maxDau) * 100}%` }} />
                <small>{d.users}</small>
                <em>{d.day.slice(8)}</em>
              </div>
            ))}
          </div>
        ) : (
          <p className="hint">No activity yet.</p>
        )}
      </div>

      {j && (
        <div className="card">
          <span className="label">Journeys with company</span>
          <p>
            <b>{j.total ? Math.round((j.shared / j.total) * 100) : 0}%</b> of journeys in the last {s.days} days had 2+ YoFellow users ({j.shared} of {j.total}). This is the
            number to grow: pick a few busy routes and get people on them.
          </p>
        </div>
      )}

      <div className="card stack">
        <span className="label">Events in the last {s.days} days</span>
        <table className="table">
          <tbody>
            {events.map(([name, n]) => (
              <tr key={name}>
                <td>{name.replace(/_/g, " ")}</td>
                <td className="num">{n}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Who({ u }: { u: AdminUser | null }) {
  if (!u) return <span className="muted">deleted user</span>;
  return (
    <span>
      <b>{u.name || "(no name)"}</b> #{u.id} · {u.phone}
      {u.banned && <span className="pill danger">banned</span>}
    </span>
  );
}

function ReportsTab() {
  const { toast } = useApp();
  const [r, setR] = useState<Reports | null>(null);
  const load = useCallback(() => api<Reports>("/admin/reports").then(setR), []);
  useEffect(() => {
    load();
  }, [load]);

  async function act(path: string, done: string, confirmText?: string) {
    if (confirmText && !confirm(confirmText)) return;
    try {
      await api(path, { method: "POST" });
      toast(done);
      load();
    } catch (e) {
      toast((e as Error).message);
    }
  }

  if (!r) return <p className="muted">Loading…</p>;
  if (!r.people.length && !r.messages.length) return <p className="muted center-text">Nothing to review 🎉</p>;
  return (
    <>
      {r.messages.length > 0 && <span className="label">Reported group messages</span>}
      {r.messages.map((m) => (
        <div key={m.message_uuid} className="card stack">
          <small className="muted">
            {m.room_name} · {when(m.created_at)}
          </small>
          <blockquote className={m.hidden ? "struck" : ""}>{m.body}</blockquote>
          <small>
            From <Who u={m.sender} />
          </small>
          <small className="muted">
            Reason: {m.reason} (by {m.reporter?.name ?? "?"})
          </small>
          <div className="row wrap">
            {m.hidden ? (
              <button className="btn small" onClick={() => act(`/admin/messages/${m.message_uuid}/unhide`, "Message restored")}>
                Restore
              </button>
            ) : (
              <button className="btn small" onClick={() => act(`/admin/messages/${m.message_uuid}/hide`, "Message hidden")}>
                Hide message
              </button>
            )}
            <button className="btn small ghost" onClick={() => act(`/admin/messages/${m.message_uuid}/dismiss`, "Dismissed")}>
              Dismiss
            </button>
            {m.sender && !m.sender.banned && (
              <button className="btn small danger-ghost" onClick={() => act(`/admin/users/${m.sender!.id}/ban`, "User banned", `Ban ${m.sender!.name}? They get logged out and all their messages are hidden.`)}>
                Ban sender
              </button>
            )}
          </div>
        </div>
      ))}

      {r.people.length > 0 && <span className="label">Reported people</span>}
      {r.people.map((p) => (
        <div key={p.id} className="card stack">
          <small className="muted">{when(p.created_at)}</small>
          <Who u={p.reported} />
          {p.reported?.bio && <small className="muted">Bio: {p.reported.bio}</small>}
          <blockquote>{p.reason}</blockquote>
          <small className="muted">Reported by {p.reporter?.name ?? "?"}</small>
          <div className="row wrap">
            {p.reported && !p.reported.banned && (
              <button className="btn small danger-ghost" onClick={() => act(`/admin/users/${p.reported!.id}/ban`, "User banned", `Ban ${p.reported!.name}? They get logged out, hidden, and their chats close.`)}>
                Ban
              </button>
            )}
            <button className="btn small ghost" onClick={() => act(`/admin/reports/${p.id}/dismiss`, "Dismissed")}>
              Dismiss
            </button>
          </div>
        </div>
      ))}
    </>
  );
}

function UsersTab() {
  const { toast } = useApp();
  const [q, setQ] = useState("");
  const [list, setList] = useState<AdminUser[] | null>(null);
  const search = useCallback(() => api<AdminUser[]>(`/admin/users?q=${encodeURIComponent(q.trim())}`).then(setList), [q]);
  useEffect(() => {
    search();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function toggle(u: AdminUser) {
    if (!u.banned && !confirm(`Ban ${u.name}?`)) return;
    try {
      await api(`/admin/users/${u.id}/${u.banned ? "unban" : "ban"}`, { method: "POST" });
      toast(u.banned ? "Unbanned" : "Banned");
      search();
    } catch (e) {
      toast((e as Error).message);
    }
  }

  return (
    <>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          search();
        }}
      >
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or last digits of phone" />
        <button className="btn small">Search</button>
      </form>
      {!q && <p className="hint">Empty search shows banned and hidden accounts.</p>}
      {list?.length === 0 && <p className="muted">No one found.</p>}
      {list?.map((u) => (
        <div key={u.id} className="card row between">
          <div className="stack tight">
            <Who u={u} />
            <small className="muted">
              {u.age || "?"} · {u.gender || "?"} · {u.city || "no city"} {u.hidden && !u.banned ? "· hidden" : ""}
            </small>
          </div>
          {!u.isAdmin && (
            <button className={`btn small ${u.banned ? "" : "danger-ghost"}`} onClick={() => toggle(u)}>
              {u.banned ? "Unban" : "Ban"}
            </button>
          )}
        </div>
      ))}
    </>
  );
}

function FeedbackTab() {
  const [list, setList] = useState<Fb[] | null>(null);
  const load = useCallback(() => api<Fb[]>("/admin/feedback").then(setList), []);
  useEffect(() => {
    load();
  }, [load]);
  if (!list) return <p className="muted">Loading…</p>;
  if (!list.length) return <p className="muted center-text">No feedback yet.</p>;
  return (
    <>
      {list.map((f) => (
        <div key={f.id} className={`card stack ${f.status === "done" ? "dim" : ""}`}>
          <div className="row between">
            <small className="muted">
              {f.name || "someone"} · {when(f.created_at)} {f.page && `· ${f.page}`}
            </small>
            {f.rating && <span className="stars-sm">{"★".repeat(f.rating)}</span>}
          </div>
          <p className="pre">{f.message}</p>
          {f.status === "new" && (
            <button className="btn small ghost" onClick={() => api(`/admin/feedback/${f.id}/done`, { method: "POST" }).then(load)}>
              Mark done
            </button>
          )}
        </div>
      ))}
    </>
  );
}
