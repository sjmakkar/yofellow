// DEV ONLY: a stand-in for Bluetooth / Wi-Fi Direct so the offline mesh can be
// tried in a normal browser. Phones in the same "zone" (journey) behave as if
// they were within radio range of each other. It knows nothing about users or
// messages; it only passes frames between nearby phones, like a real radio.
// In the native app this is replaced by a BLE transport and this hub is not used.
import { WebSocketServer, WebSocket } from "ws";

type Peer = { id: string; zone: string; ws: WebSocket };

export function startRadioHub(port = Number(process.env.RADIO_PORT) || 4100) {
  const wss = new WebSocketServer({ port });
  wss.on("error", (e: NodeJS.ErrnoException) => {
    if (e.code === "EADDRINUSE") console.log(`Radio hub already running on port ${port}, using that one.`);
    else console.error("Radio hub error:", e.message);
  });
  const peers = new Map<string, Peer>();
  let n = 0;

  const near = (p: Peer) => [...peers.values()].filter((q) => q.id !== p.id && q.zone === p.zone);
  const send = (ws: WebSocket, data: unknown) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(data));

  wss.on("connection", (ws, req) => {
    const url = new URL(req.url || "/", "http://x");
    const zone = url.searchParams.get("zone") || "none";
    const me: Peer = { id: `r${++n}`, zone, ws };
    peers.set(me.id, me);
    send(ws, { t: "welcome", id: me.id });
    for (const q of near(me)) {
      send(ws, { t: "peer", id: q.id, up: true });
      send(q.ws, { t: "peer", id: me.id, up: true });
    }
    ws.on("message", (raw) => {
      let f: { to: string | null; msg: unknown };
      try {
        f = JSON.parse(String(raw));
      } catch {
        return;
      }
      const targets = f.to ? near(me).filter((q) => q.id === f.to) : near(me);
      for (const q of targets) send(q.ws, { t: "msg", from: me.id, msg: f.msg });
    });
    ws.on("close", () => {
      peers.delete(me.id);
      for (const q of near(me)) send(q.ws, { t: "peer", id: me.id, up: false });
    });
  });
  wss.on("listening", () => console.log(`Dev radio hub (Bluetooth stand-in) on ws://localhost:${port}`));
  return wss;
}
