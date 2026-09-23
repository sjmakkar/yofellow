// Client side of the offline mesh. The MeshNode logic is shared with the
// simulator and the future native app; only the transport differs.
//  - Native app (next step): Bluetooth LE / Wi-Fi Direct transport.
//  - Browser dev: RadioTransport talks to the dev radio hub, which stands in for Bluetooth range.
import { MeshNode, type Envelope, type Transport, type WireMsg } from "../../../shared/mesh";
import { net } from "./net";

export function radioEnabled() {
  try {
    const flag = localStorage.getItem("tb_radio");
    if (flag === "0") return false;
    if (flag === "1") return true;
  } catch {
    /* ignore */
  }
  return /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(location.hostname);
}

class RadioTransport implements Transport {
  private ws: WebSocket | null = null;
  private peers = new Set<string>();
  private msgCb: (from: string, m: WireMsg) => void = () => {};
  private peerCb: (id: string, up: boolean) => void = () => {};
  private closed = false;
  private retry: ReturnType<typeof setTimeout> | null = null;

  constructor(private zone: string) {
    this.connect();
  }

  private connect() {
    if (this.closed) return;
    try {
      this.ws = new WebSocket(`ws://${location.hostname}:4100/?zone=${encodeURIComponent(this.zone)}`);
    } catch {
      return this.later();
    }
    this.ws.onmessage = (ev) => {
      const f = JSON.parse(ev.data);
      if (f.t === "peer") {
        if (f.up) this.peers.add(f.id);
        else this.peers.delete(f.id);
        net.setNearby(this.peers.size);
        this.peerCb(f.id, f.up);
      } else if (f.t === "msg") this.msgCb(f.from, f.msg);
    };
    this.ws.onclose = () => {
      for (const p of this.peers) this.peerCb(p, false);
      this.peers.clear();
      net.setNearby(0);
      this.later();
    };
  }
  private later() {
    if (this.closed) return;
    this.retry = setTimeout(() => this.connect(), 4000);
  }
  send(to: string | null, msg: WireMsg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ to, msg }));
  }
  onMessage(cb: (from: string, m: WireMsg) => void) {
    this.msgCb = cb;
  }
  onPeer(cb: (id: string, up: boolean) => void) {
    this.peerCb = cb;
  }
  close() {
    this.closed = true;
    if (this.retry) clearTimeout(this.retry);
    this.ws?.close();
    net.setNearby(0);
  }
}

let current: { zone: string; node: MeshNode; transport: RadioTransport } | null = null;
const deliverSubs = new Set<(e: Envelope) => void>();

/** Join the mesh for one journey. keysFor must return the public keys we trust for a sender. */
export function joinMesh(zone: string, keysFor: (sender: number) => string[] | undefined, serverKey?: string) {
  if (!radioEnabled()) return null;
  if (current?.zone === zone) return current.node;
  leaveMesh();
  const transport = new RadioTransport(zone);
  const node = new MeshNode({ transport, keysFor, serverKey, onDeliver: (e) => deliverSubs.forEach((f) => f(e)) });
  current = { zone, node, transport };
  return node;
}

export function leaveMesh() {
  current?.transport.close();
  current = null;
}

export function meshNode() {
  return current?.node ?? null;
}

export function onMeshDeliver(f: (e: Envelope) => void) {
  deliverSubs.add(f);
  return () => deliverSubs.delete(f);
}
