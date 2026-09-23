// Offline mesh relay core. Transport agnostic: the same logic runs over
// Bluetooth / Wi-Fi Direct in a native app, over the dev "radio" hub in the
// browser, and over an in-memory graph in the simulator.
//
// Every group message is a signed envelope. Phones gossip envelopes to nearby
// phones, drop duplicates, and forward until the hop limit. When any phone gets
// internet it uploads what it holds, and the server verifies each signature, so
// one connected phone can bring a whole coach online (store and forward).

import nacl from "tweetnacl";

export type Envelope = {
  id: string; // uuid, also the idempotency key on the server
  room: number; // group room id
  sender: number; // user id
  name: string; // sender first name, for offline display
  body: string;
  ts: number; // ms since epoch, sender clock
  hops: number; // not signed, incremented per relay
  ttl: number; // max hops
  sig: string; // base64 Ed25519 signature over canonical()
  cert?: KeyCert; // not signed by the sender; lets phones that never saw this sender's key verify it offline
};

/** The server vouches that this public key belongs to this user. */
export type KeyCert = { user: number; pubkey: string; sig: string };

export function certPayload(user: number, pubkey: string) {
  return JSON.stringify(["tb-key", user, pubkey]);
}
export function signCert(user: number, pubkey: string, serverSecretB64: string): KeyCert {
  return { user, pubkey, sig: toB64(nacl.sign.detached(enc.encode(certPayload(user, pubkey)), fromB64(serverSecretB64))) };
}
export function verifyCert(c: KeyCert, serverPubB64: string) {
  try {
    return nacl.sign.detached.verify(enc.encode(certPayload(c.user, c.pubkey)), fromB64(c.sig), fromB64(serverPubB64));
  } catch {
    return false;
  }
}

export type WireMsg =
  | { t: "hello"; have: string[] }
  | { t: "env"; e: Envelope };

export interface Transport {
  /** Send to one peer, or broadcast to all current peers when to is null. */
  send(to: string | null, msg: WireMsg): void;
  onMessage(cb: (from: string, msg: WireMsg) => void): void;
  onPeer(cb: (peerId: string, up: boolean) => void): void;
}

// ---------- crypto helpers (no Buffer, works in browser, RN and Node) ----------
export function toB64(bytes: Uint8Array) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
export function fromB64(b64: string) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
const enc = new TextEncoder();

export function canonical(e: Pick<Envelope, "id" | "room" | "sender" | "name" | "body" | "ts">) {
  return JSON.stringify([e.id, e.room, e.sender, e.name, e.body, e.ts]);
}

export function newKeypair() {
  const kp = nacl.sign.keyPair();
  return { publicKey: toB64(kp.publicKey), secretKey: toB64(kp.secretKey) };
}

export function signEnvelope(e: Omit<Envelope, "sig">, secretKeyB64: string): Envelope {
  const sig = nacl.sign.detached(enc.encode(canonical(e)), fromB64(secretKeyB64));
  return { ...e, sig: toB64(sig) };
}

export function verifyEnvelope(e: Envelope, publicKeysB64: string[]) {
  try {
    const msg = enc.encode(canonical(e));
    const sig = fromB64(e.sig);
    return publicKeysB64.some((k) => nacl.sign.detached.verify(msg, sig, fromB64(k)));
  } catch {
    return false;
  }
}

export function uuid() {
  const b = nacl.randomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// ---------- group message rules, shared by client, mesh and server ----------
const PHONE = /(\+?\d[\d\s-]{8,}\d)/;
const LINK = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|in|net|org|io|me|link|xyz|app)\b)/i;
export function checkGroupMessage(body: string): string | null {
  const b = body.trim();
  if (!b) return "Message is empty";
  if (b.length > 500) return "Keep it under 500 characters";
  if (PHONE.test(b)) return "Phone numbers are not allowed in group rooms. Share them in a private chat if you want.";
  if (LINK.test(b)) return "Links are not allowed in group rooms";
  return null;
}

// ---------- the mesh node ----------
export type MeshOptions = {
  transport: Transport;
  /** Public keys for a sender, or undefined if unknown (then the envelope is dropped). */
  keysFor: (sender: number) => string[] | undefined;
  /** Called once per new valid envelope. */
  onDeliver?: (e: Envelope) => void;
  /** Server signing key: lets the node trust keys of people who joined after we went offline. */
  serverKey?: string;
  maxStore?: number;
  helloSize?: number;
};

export class MeshNode {
  private store = new Map<string, Envelope>();
  private peers = new Set<string>();
  private learned = new Map<number, string[]>();
  readonly stats = { received: 0, duplicates: 0, rejected: 0, forwarded: 0, delivered: 0 };

  constructor(private o: MeshOptions) {
    o.transport.onPeer((id, up) => {
      if (up) {
        this.peers.add(id);
        // Anti entropy: tell the new neighbour what we already hold,
        // it pushes back what we are missing (and we do the same for it).
        o.transport.send(id, { t: "hello", have: this.recentIds() });
      } else this.peers.delete(id);
    });
    o.transport.onMessage((from, msg) => this.handle(from, msg));
  }

  get size() {
    return this.store.size;
  }
  has(id: string) {
    return this.store.has(id);
  }
  all() {
    return [...this.store.values()];
  }

  /** Publish our own signed envelope, or inject a server-verified one we got online. */
  publish(e: Envelope) {
    if (!this.accept(e)) return false;
    this.o.transport.send(null, { t: "env", e });
    this.stats.forwarded++;
    return true;
  }

  private recentIds() {
    const ids = [...this.store.keys()];
    return ids.slice(-(this.o.helloSize ?? 500));
  }

  private accept(e: Envelope) {
    if (this.store.has(e.id)) {
      this.stats.duplicates++;
      return false;
    }
    let keys = this.o.keysFor(e.sender) ?? this.learned.get(e.sender);
    if (e.cert && e.cert.user === e.sender && this.o.serverKey && !(keys || []).includes(e.cert.pubkey) && verifyCert(e.cert, this.o.serverKey)) {
      keys = [...(keys || []), e.cert.pubkey];
      this.learned.set(e.sender, keys);
    }
    if (!keys || !verifyEnvelope(e, keys)) {
      this.stats.rejected++;
      return false;
    }
    if (checkGroupMessage(e.body)) {
      this.stats.rejected++;
      return false;
    }
    this.store.set(e.id, e);
    const max = this.o.maxStore ?? 5000;
    if (this.store.size > max) this.store.delete(this.store.keys().next().value as string);
    this.stats.delivered++;
    this.o.onDeliver?.(e);
    return true;
  }

  private handle(from: string, msg: WireMsg) {
    if (msg.t === "hello") {
      const have = new Set(msg.have);
      for (const e of this.store.values()) if (!have.has(e.id)) this.o.transport.send(from, { t: "env", e });
      return;
    }
    if (msg.t === "env") {
      this.stats.received++;
      const e = msg.e;
      if (!this.accept(e)) return;
      if (e.hops < e.ttl) {
        const fwd = { ...e, hops: e.hops + 1 };
        for (const p of this.peers) if (p !== from) this.o.transport.send(p, { t: "env", e: fwd });
        this.stats.forwarded++;
      }
    }
  }
}
