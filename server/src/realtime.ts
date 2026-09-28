import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { verifyToken } from "./auth.js";
import { db } from "./db.js";

let io: Server | null = null;
const online = new Map<number, number>(); // user id -> open sockets

/** Is this user using the app right now (so a push notification is not needed)? */
export function isOnline(userId: number) {
  return (online.get(userId) ?? 0) > 0;
}

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
    online.set(uid, (online.get(uid) ?? 0) + 1);
    socket.on("disconnect", () => {
      const n = (online.get(uid) ?? 1) - 1;
      if (n <= 0) online.delete(uid);
      else online.set(uid, n);
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
