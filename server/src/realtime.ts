import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { verifyToken } from "./auth.js";
import { db } from "./db.js";

let io: Server | null = null;
// user id -> socket id -> what that tab/phone is showing. A connected socket alone
// doesn't mean the person is looking: phones keep the app alive in the background.
type Presence = { visible: boolean; path: string };
const online = new Map<number, Map<string, Presence>>();

/** Has the app open on some device (maybe in the background). */
export function isOnline(userId: number) {
  return (online.get(userId)?.size ?? 0) > 0;
}

/** Is the app on screen right now? With a path: on screen AND showing that page. */
export function isWatching(userId: number, path?: string) {
  for (const p of online.get(userId)?.values() ?? []) if (p.visible && (!path || p.path === path)) return true;
  return false;
}

const cleanPresence = (d: any): Presence => ({ visible: d?.visible === true, path: typeof d?.path === "string" ? d.path.slice(0, 200) : "" });

export function emitToUser(userId: number, event: string, data: unknown) {
  io?.to(`user:${userId}`).emit(event, data);
}

let roomAccess: (uid: number, roomId: number) => Promise<boolean> = async () => false;
export function setRoomAccess(fn: typeof roomAccess) {
  roomAccess = fn;
}
export function emitToRoom(roomId: number, event: string, data: unknown) {
  io?.to(`room:${roomId}`).emit(event, data);
}

export async function matchPlayers(matchId: number, userId: number) {
  const m = await db
    .prepare("SELECT a_id, b_id FROM matches WHERE id=? AND closed=0 AND (a_id=? OR b_id=?)")
    .get<{ a_id: number; b_id: number }>(matchId, userId, userId);
  return m ? [m.a_id, m.b_id] : null;
}

export function initRealtime(server: HttpServer) {
  io = new Server(server, { cors: { origin: true } });

  io.use(async (socket, next) => {
    const uid = verifyToken(String(socket.handshake.auth?.token || ""));
    if (!uid) return next(new Error("unauthorized"));
    const u = await db.prepare("SELECT banned FROM users WHERE id=?").get<{ banned: number }>(uid).catch(() => undefined);
    if (!u || u.banned) return next(new Error("unauthorized"));
    socket.data.uid = uid;
    next();
  });

  io.on("connection", (socket) => {
    const uid = socket.data.uid as number;
    socket.join(`user:${uid}`);
    if (!online.has(uid)) online.set(uid, new Map());
    // Old clients don't report presence: treat them as not watching, so pushes still go out.
    online.get(uid)!.set(socket.id, cleanPresence(socket.handshake.auth?.presence));
    socket.on("presence", (d: unknown) => online.get(uid)?.set(socket.id, cleanPresence(d)));
    socket.on("disconnect", () => {
      const m = online.get(uid);
      m?.delete(socket.id);
      if (m && !m.size) online.delete(uid);
    });

    socket.on("room:join", async ({ roomId }: { roomId: number }, ack?: (ok: boolean) => void) => {
      const ok = await roomAccess(uid, Number(roomId)).catch(() => false);
      if (ok) socket.join(`room:${Number(roomId)}`);
      ack?.(ok);
    });
    socket.on("room:leave", ({ roomId }: { roomId: number }) => socket.leave(`room:${Number(roomId)}`));

    // Typing indicator is ephemeral, so it goes straight over the socket.
    socket.on("typing", async ({ matchId }: { matchId: number }) => {
      const players = await matchPlayers(Number(matchId), uid).catch(() => null);
      if (!players) return;
      const other = players.find((p) => p !== uid)!;
      emitToUser(other, "typing", { matchId, userId: uid });
    });
  });
}
