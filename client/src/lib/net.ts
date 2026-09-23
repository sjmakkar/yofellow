// Connection state shared by the whole app: online / weak / offline,
// how many actions wait in the outbox, and how many phones are nearby on the mesh.
import { useSyncExternalStore } from "react";

export type NetState = {
  status: "online" | "weak" | "offline";
  pending: number;
  nearby: number;
  lastSync: number | null;
};

let socketUp = false;
let socketEverUp = false;
let apiOk = true;
let state: NetState = { status: navigator.onLine ? "online" : "offline", pending: 0, nearby: 0, lastSync: null };
const subs = new Set<() => void>();

function slowLink() {
  const c = (navigator as any).connection;
  return !!c && (c.saveData || ["slow-2g", "2g"].includes(c.effectiveType));
}

function recompute() {
  // The live socket is the best signal: once it has connected, losing it means we are offline.
  const down = !navigator.onLine || (!socketUp && (!apiOk || socketEverUp));
  const status: NetState["status"] = down ? "offline" : slowLink() ? "weak" : "online";
  set({ status });
}

function set(patch: Partial<NetState>) {
  const next = { ...state, ...patch };
  if (JSON.stringify(next) === JSON.stringify(state)) return;
  state = next;
  subs.forEach((f) => f());
}

export const net = {
  get: () => state,
  subscribe(f: () => void) {
    subs.add(f);
    return () => subs.delete(f);
  },
  markApi(ok: boolean) {
    apiOk = ok;
    recompute();
  },
  markSocket(up: boolean) {
    socketUp = up;
    if (up) {
      apiOk = true;
      socketEverUp = true;
    }
    recompute();
  },
  setPending: (pending: number) => set({ pending }),
  setNearby: (nearby: number) => set({ nearby }),
  synced: () => set({ lastSync: Date.now() }),
  isOffline: () => state.status === "offline",
};

window.addEventListener("online", recompute);
window.addEventListener("offline", recompute);
(navigator as any).connection?.addEventListener?.("change", recompute);

export function useNet() {
  return useSyncExternalStore(net.subscribe, net.get);
}
