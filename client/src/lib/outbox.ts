// Offline outbox: every action that needs the server is queued here first and
// flushed in one /sync request whenever the network is back (a station stop is
// enough). Each op carries an id, so retries never create duplicates.
import { outboxAdd, outboxAll, outboxDelete } from "./idb";
import { net } from "./net";
import { tokenStore } from "../api";

export type Op =
  | { op: "room_msg"; env: object }
  | { op: "relay"; env: object }
  | { op: "dm_msg"; uuid: string; matchId: number; body: string }
  | { op: "game_answer"; gameId: number; answer: number | string }
  | { op: "wave"; toId: number; tripId: number }
  | { op: "signal"; tripId: number; samples: object[] };

export type OpResult = { ok: boolean; error?: string; data?: any };
type Listener = (op: Op, r: OpResult) => void;
const listeners = new Set<Listener>();
let flushing = false;
let timer: ReturnType<typeof setTimeout> | null = null;

async function refreshCount() {
  net.setPending((await outboxAll<Op>()).filter((o) => o.op !== "relay" && o.op !== "signal").length);
}

export async function enqueue(op: Op) {
  await outboxAdd(op);
  await refreshCount();
  flushSoon(50);
}

export function onResult(f: Listener) {
  listeners.add(f);
  return () => listeners.delete(f);
}

export function flushSoon(ms = 500) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(flush, ms);
}

export async function flush() {
  if (flushing || !tokenStore.get()) return;
  flushing = true;
  try {
    let ops = await outboxAll<Op>();
    while (ops.length) {
      const batch = ops.slice(0, 100);
      let res: Response;
      try {
        res = await fetch("/api/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenStore.get()}` },
          body: JSON.stringify({ ops: batch.map(({ seq, queuedAt, ...o }: any) => o) }),
        });
      } catch {
        net.markApi(false);
        return; // still offline, keep everything queued
      }
      if (!res.ok) return;
      net.markApi(true);
      const { results } = (await res.json()) as { results: OpResult[] };
      for (let i = 0; i < batch.length; i++) {
        await outboxDelete(batch[i].seq);
        listeners.forEach((f) => f(batch[i], results[i] || { ok: false, error: "No result" }));
      }
      net.synced();
      ops = await outboxAll<Op>();
    }
  } finally {
    flushing = false;
    await refreshCount();
  }
}

let started = false;
export function startOutbox() {
  if (started) return;
  started = true;
  refreshCount();
  window.addEventListener("online", () => flushSoon(200));
  setInterval(() => flush(), 8000);
  flushSoon(300);
}
