import { kvGet, kvSet } from "./lib/idb";
import { net } from "./lib/net";

export type Intent = "friends" | "dating" | "chat";
export type Mode = "train" | "flight" | "bus" | "metro";

export type PublicUser = {
  id: number;
  name: string;
  age: number;
  gender: string;
  city: string;
  bio: string;
  interests: string[];
  intent: Intent;
};
export type Me = PublicUser & {
  phone: string;
  showMe: "everyone" | "women" | "men";
  womenOnly: boolean;
  hidden: boolean;
  complete: boolean;
};
export type Trip = {
  id: number;
  mode: Mode;
  number: string;
  date: string;
  coach: string;
  intent: Intent;
  from: string;
  to: string;
  othersOnTrip: number;
};
export type Traveller = {
  user: PublicUser;
  intent: Intent;
  vibe: number;
  shared: string[];
  sameCoach: boolean;
  sameCity: boolean;
  iWaved: boolean;
  theyWaved: boolean;
  matchId: number | null;
};
export type Game = {
  id: number;
  type: "wyr" | "this_or_that" | "trivia" | "deep_q" | "two_truths";
  creatorId: number;
  prompt: any;
  answered: number[];
  answers: Record<string, number | string>;
  complete: boolean;
};
export type Message = {
  id: number;
  uuid?: string | null;
  pending?: boolean;
  failed?: string;
  matchId: number;
  senderId: number;
  kind: "text" | "game" | "system";
  body: string;
  at: string;
  game?: Game;
};
export type Match = {
  id: number;
  with: PublicUser;
  trip: { mode: Mode; number: string; date: string };
  lastMessage: { body: string; at: string; mine: boolean } | null;
  meet: { me: boolean; them: boolean; revealed: { theirCoach: string } | null };
};

export const tokenStore = {
  get: () => localStorage.getItem("tb_token"),
  set: (t: string | null) => (t ? localStorage.setItem("tb_token", t) : localStorage.removeItem("tb_token")),
};

export class OfflineError extends Error {
  offline = true;
  constructor() {
    super("You're offline. We'll send it when the network is back.");
  }
}

/**
 * Fetch wrapper. GET responses are cached in IndexedDB, and served from there
 * when the network is down, so screens keep working in tunnels and dead zones.
 * Other methods throw OfflineError on network failure; callers can queue them.
 */
export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; timeoutMs?: number } = {}): Promise<T> {
  const token = tokenStore.get();
  const method = opts.method || (opts.body ? "POST" : "GET");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 10000);
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    net.markApi(false);
    if (method === "GET") {
      const cached = await kvGet<T>(`GET ${path}`);
      if (cached !== undefined) return cached;
    }
    throw new OfflineError();
  } finally {
    clearTimeout(timer);
  }
  net.markApi(true);
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && token) {
    tokenStore.set(null);
    location.href = "/";
  }
  if (!res.ok) throw new Error(data.error || "Something went wrong");
  if (method === "GET") kvSet(`GET ${path}`, data);
  return data as T;
}

/** Cached copy of a GET, without touching the network. */
export const cached = <T,>(path: string) => kvGet<T>(`GET ${path}`);

export const MODE_ICON: Record<Mode, string> = { train: "🚆", flight: "✈️", bus: "🚌", metro: "🚇" };
export const MODE_LABEL: Record<Mode, string> = { train: "Train", flight: "Flight", bus: "Bus", metro: "Metro" };
export const NUMBER_HINT: Record<Mode, string> = {
  train: "Train number, e.g. 12951",
  flight: "Flight number, e.g. 6E2134",
  bus: "Operator + route, e.g. HRTC-DEL-SHIMLA",
  metro: "Line + time, e.g. BLUE-0830",
};
export const COACH_HINT: Record<Mode, string> = {
  train: "Coach, e.g. B3 (optional)",
  flight: "Cabin row block, e.g. 20-25 (optional)",
  bus: "Bus seat area (optional)",
  metro: "Coach number (optional)",
};
export const INTENT_LABEL: Record<Intent, string> = { friends: "Friends", dating: "Dating", chat: "Just chat" };

export type Room = { id: number; kind: "train" | "coach" | "women" | "topic"; name: string; coach: string | null; members: number; archived: boolean; last: string | null };
export type Pack = {
  savedAt: number;
  trip: Trip & { key: string };
  rooms: (Room & { messages: RoomMsg[] })[];
  travellers: Traveller[];
  keys: Record<string, string[]>;
  names: Record<string, string>;
  blocked: number[];
  serverKey: string;
  signal: [string, number, number, number, number][];
};
/** A group message: a signed mesh envelope plus local delivery status. */
export type RoomMsg = {
  id: string;
  room: number;
  sender: number;
  name: string;
  body: string;
  ts: number;
  hops: number;
  ttl: number;
  sig: string;
  cert?: { user: number; pubkey: string; sig: string };
  serverId?: number;
  status?: "sent" | "pending" | "mesh" | "failed";
  error?: string;
};
