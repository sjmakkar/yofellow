import { io, Socket } from "socket.io-client";
import { tokenStore } from "./api";
import { net } from "./lib/net";
import { flushSoon } from "./lib/outbox";

let socket: Socket | null = null;

// Tell the server whether the app is on screen and which page, so it only skips a
// push when you're already looking at that chat or board (not when the app is in the background).
const presence = () => ({ visible: document.visibilityState === "visible" && document.hasFocus(), path: location.pathname });
export function reportPresence() {
  if (socket?.connected) socket.emit("presence", presence());
}
for (const ev of ["visibilitychange", "focus", "blur", "pagehide"]) window.addEventListener(ev, reportPresence);
document.addEventListener("visibilitychange", reportPresence);

export function getSocket() {
  const token = tokenStore.get();
  if (!token) return null;
  if (!socket) {
    // websocket first; long polling as fallback on flaky mobile networks
    socket = io({ auth: (cb) => cb({ token, presence: presence() }), transports: ["websocket", "polling"], reconnectionDelayMax: 10000 });
    socket.on("connect", () => {
      net.markSocket(true);
      reportPresence();
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
