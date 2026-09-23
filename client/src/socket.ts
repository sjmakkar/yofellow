import { io, Socket } from "socket.io-client";
import { tokenStore } from "./api";
import { net } from "./lib/net";
import { flushSoon } from "./lib/outbox";

let socket: Socket | null = null;

export function getSocket() {
  const token = tokenStore.get();
  if (!token) return null;
  if (!socket) {
    // websocket first; long polling as fallback on flaky mobile networks
    socket = io({ auth: { token }, transports: ["websocket", "polling"], reconnectionDelayMax: 10000 });
    socket.on("connect", () => {
      net.markSocket(true);
      flushSoon(100); // back online: send everything that waited
    });
    socket.on("disconnect", () => net.markSocket(false));
    socket.on("connect_error", () => net.markSocket(false));
  }
  return socket;
}

export function closeSocket() {
  socket?.disconnect();
  socket = null;
}
