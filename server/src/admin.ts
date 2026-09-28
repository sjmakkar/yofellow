// Admin panel API: pilot stats, reports queue, bans, hidden messages, feedback.
// Admins are the phone numbers listed in ADMIN_PHONES (comma separated).
import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db, publicUser, type UserRow } from "./db.js";
import { api, me, bad, parse, getUser } from "./routes.js";
import { emitToRoom, emitToUser } from "./realtime.js";
import { track } from "./events.js";

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!me(req)?.is_admin) return res.status(403).json({ error: "Admins only" });
  next();
}

const mask = (phone: string) => (phone.length > 4 ? `${"•".repeat(Math.max(0, phone.length - 4))}${phone.slice(-4)}` : phone);
const adminUser = (u: UserRow) => ({ ...publicUser(u), phone: mask(u.phone), hidden: !!u.hidden, banned: !!u.banned, isAdmin: !!u.is_admin });

// ---------- stats ----------
api.get("/admin/stats", requireAdmin, async (req, res) => {
  const days = Math.min(60, Math.max(7, Number(req.query.days) || 14));
  const daily = await db
    .prepare(
      `SELECT to_char(date_trunc('day', created_at AT TIME ZONE 'Asia/Kolkata'), 'YYYY-MM-DD') AS day, name, COUNT(*)::int AS n, COUNT(DISTINCT user_id)::int AS users
       FROM events WHERE created_at > now() - (? || ' days')::interval GROUP BY 1, 2 ORDER BY 1`
    )
    .all<{ day: string; name: string; n: number; users: number }>(String(days));
  const dau = await db
    .prepare(
      `SELECT to_char(date_trunc('day', created_at AT TIME ZONE 'Asia/Kolkata'), 'YYYY-MM-DD') AS day, COUNT(DISTINCT user_id)::int AS users
       FROM events WHERE user_id IS NOT NULL AND created_at > now() - (? || ' days')::interval GROUP BY 1 ORDER BY 1`
    )
    .all<{ day: string; users: number }>(String(days));
  const one = async (sql: string) => (await db.prepare(sql).get<{ n: number }>())?.n ?? 0;
  const totals = {
    users: await one("SELECT COUNT(*)::int n FROM users WHERE name IS NOT NULL AND phone NOT LIKE '900000000%'"),
    active7d: await one("SELECT COUNT(DISTINCT user_id)::int n FROM events WHERE created_at > now() - interval '7 days' AND user_id IS NOT NULL"),
    trips: await one("SELECT COUNT(*)::int n FROM trips"),
    matches: await one("SELECT COUNT(*)::int n FROM matches"),
    privateMessages: await one("SELECT COUNT(*)::int n FROM messages WHERE kind='text'"),
    groupMessages: await one("SELECT COUNT(*)::int n FROM room_messages"),
    games: await one("SELECT COUNT(*)::int n FROM play_sessions WHERE status<>'waiting'"),
    cabShares: await one("SELECT COUNT(*)::int n FROM cab_shares"),
    pushDevices: await one("SELECT COUNT(*)::int n FROM push_subs"),
    openReports:
      (await one("SELECT COUNT(*)::int n FROM reports WHERE status='open'")) +
      (await one("SELECT COUNT(*)::int n FROM message_reports WHERE status='open'")),
    newFeedback: await one("SELECT COUNT(*)::int n FROM feedback WHERE status='new'"),
  };
  // How many trips had at least one other person on board (the cold start metric).
  const withCompany = await db
    .prepare(
      `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE n > 1)::int AS shared FROM (SELECT trip_key, COUNT(DISTINCT user_id) n FROM trips WHERE created_at > now() - (? || ' days')::interval GROUP BY trip_key) t`
    )
    .get<{ total: number; shared: number }>(String(days));
  res.json({ days, daily, dau, totals, journeys: withCompany });
});

// ---------- reports queue ----------
api.get("/admin/reports", requireAdmin, async (_req, res) => {
  const userReports = await db
    .prepare(
      `SELECT r.id, r.reason, r.created_at, r.reported_id, r.reporter_id FROM reports r WHERE r.status='open' ORDER BY r.created_at DESC LIMIT 200`
    )
    .all<{ id: number; reason: string; created_at: string; reported_id: number; reporter_id: number }>();
  const users = new Map<number, ReturnType<typeof adminUser> | null>();
  const load = async (id: number) => {
    if (!users.has(id)) {
      const u = await getUser(id);
      users.set(id, u ? adminUser(u) : null);
    }
    return users.get(id);
  };
  const people = [];
  for (const r of userReports) people.push({ ...r, reported: await load(r.reported_id), reporter: await load(r.reporter_id) });

  const msgReports = await db
    .prepare(
      `SELECT mr.message_uuid, mr.reason, mr.created_at, mr.reporter_id, m.body, m.sender_id, m.hidden, rm.name AS room_name
       FROM message_reports mr JOIN room_messages m ON m.uuid=mr.message_uuid JOIN rooms rm ON rm.id=m.room_id
       WHERE mr.status='open' ORDER BY mr.created_at DESC LIMIT 200`
    )
    .all<{ message_uuid: string; reason: string; created_at: string; reporter_id: number; body: string; sender_id: number; hidden: number; room_name: string }>();
  const messages = [];
  for (const m of msgReports) messages.push({ ...m, sender: await load(m.sender_id), reporter: await load(m.reporter_id) });
  res.json({ people, messages });
});

api.post("/admin/users/:id/ban", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const target = await getUser(id);
  if (!target) return bad(res, "User not found", 404);
  if (target.is_admin) return bad(res, "Can't ban an admin");
  await db.prepare("UPDATE users SET banned=1, hidden=1 WHERE id=?").run(id);
  await db.prepare("UPDATE reports SET status='resolved' WHERE reported_id=? AND status='open'").run(id);
  // Hide their group messages and close their chats.
  await db.prepare("UPDATE room_messages SET hidden=1 WHERE sender_id=?").run(id);
  const matches = await db.prepare("SELECT id, a_id, b_id FROM matches WHERE closed=0 AND (a_id=? OR b_id=?)").all<{ id: number; a_id: number; b_id: number }>(id, id);
  await db.prepare("UPDATE matches SET closed=1 WHERE a_id=? OR b_id=?").run(id, id);
  for (const m of matches) {
    emitToUser(m.a_id, "match:closed", { matchId: m.id });
    emitToUser(m.b_id, "match:closed", { matchId: m.id });
  }
  await db.prepare("DELETE FROM push_subs WHERE user_id=?").run(id);
  track(me(req).id, "admin_ban", { user: id });
  res.json({ ok: true });
});

api.post("/admin/users/:id/unban", requireAdmin, async (req, res) => {
  await db.prepare("UPDATE users SET banned=0, hidden=0 WHERE id=?").run(Number(req.params.id));
  res.json({ ok: true });
});

api.post("/admin/reports/:id/dismiss", requireAdmin, async (req, res) => {
  await db.prepare("UPDATE reports SET status='dismissed' WHERE id=?").run(Number(req.params.id));
  res.json({ ok: true });
});

api.post("/admin/messages/:uuid/:action", requireAdmin, async (req, res) => {
  const b = parse(z.object({ action: z.enum(["hide", "unhide", "dismiss"]) }), { action: req.params.action }, res);
  if (!b) return;
  const uuid = String(req.params.uuid);
  if (b.action === "hide" || b.action === "unhide") {
    const row = await db.prepare("UPDATE room_messages SET hidden=? WHERE uuid=? RETURNING room_id").get<{ room_id: number }>(b.action === "hide" ? 1 : 0, uuid);
    if (row) emitToRoom(row.room_id, "room:hidden", { id: uuid, hidden: b.action === "hide" });
  }
  await db.prepare("UPDATE message_reports SET status=? WHERE message_uuid=? AND status='open'").run(b.action === "dismiss" ? "dismissed" : "resolved", uuid);
  res.json({ ok: true });
});

// ---------- users ----------
api.get("/admin/users", requireAdmin, async (req, res) => {
  const q = String(req.query.q || "").trim();
  const rows = q
    ? await db.prepare("SELECT * FROM users WHERE name ILIKE ? OR phone LIKE ? ORDER BY id DESC LIMIT 50").all<UserRow>(`%${q}%`, `%${q}`)
    : await db.prepare("SELECT * FROM users WHERE banned=1 OR hidden=1 ORDER BY id DESC LIMIT 50").all<UserRow>();
  res.json(rows.map(adminUser));
});

// ---------- feedback ----------
api.get("/admin/feedback", requireAdmin, async (_req, res) => {
  const rows = await db
    .prepare("SELECT f.*, u.name FROM feedback f LEFT JOIN users u ON u.id=f.user_id ORDER BY (f.status='new') DESC, f.created_at DESC LIMIT 200")
    .all();
  res.json(rows);
});

api.post("/admin/feedback/:id/done", requireAdmin, async (req, res) => {
  await db.prepare("UPDATE feedback SET status='done' WHERE id=?").run(Number(req.params.id));
  res.json({ ok: true });
});
