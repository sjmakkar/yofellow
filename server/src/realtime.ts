import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { verifyToken } from "./auth.js";
import { db } from "./db.js";

let io: Server | null = null;

export function emitToUser(userId: number, event: string, data: unknown) {
  io?.to(`user:${userId}`).emit(event, data);
}

let roomAccess: (uid: number, roomId: number) => boolean = () => false;
export function setRoomAccess(fn: typeof roomAccess) {
  roomAccess = fn;
}
export function emitToRoom(roomId: number, event: string, data: unknown) {
  io?.to(`room:${roomId}`).emit(event, data);
}

export function matchPlayers(matchId: number, userId: number) {
  const m = db
    .prepare("SELECT a_id, b_id FROM matches WHERE id=? AND closed=0 AND (a_id=? OR b_id=?)")
    .get(matchId, userId, userId) as { a_id: number; b_id: number } | undefined;
  return m ? [m.a_id, m.b_id] : null;
}

export function initRealtime(server: HttpServer) {
  io = new Server(server, { cors: { origin: true } });

  io.use((socket, next) => {
    const uid = verifyToken(String(socket.handshake.auth?.token || ""));
    if (!uid) return next(new Error("unauthorized"));
    socket.data.uid = uid;
    next();
  });

  io.on("connection", (socket) => {
    const uid = socket.data.uid as number;
    socket.join(`user:${uid}`);

    socket.on("room:join", ({ roomId }: { roomId: number }, ack?: (ok: boolean) => void) => {
      const ok = roomAccess(uid, Number(roomId));
      if (ok) socket.join(`room:${Number(roomId)}`);
      ack?.(ok);
    });
    socket.on("room:leave", ({ roomId }: { roomId: number }) => socket.leave(`room:${Number(roomId)}`));

    // Typing indicator is ephemeral, so it goes straight over the socket.
    socket.on("typing", ({ matchId }: { matchId: number }) => {
      const players = matchPlayers(Number(matchId), uid);
      if (!players) return;
      const other = players.find((p) => p !== uid)!;
      emitToUser(other, "typing", { matchId, userId: uid });
    });
  });
}
