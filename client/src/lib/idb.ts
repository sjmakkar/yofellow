// Tiny IndexedDB helper. Falls back to memory when IndexedDB is unavailable
// (private mode, old browsers), so the app still runs, just without persistence.
const DB_NAME = "travelbuddy";
const VERSION = 1;
let dbp: Promise<IDBDatabase | null> | null = null;
const mem = { kv: new Map<string, unknown>(), outbox: new Map<number, unknown>(), roomMsgs: new Map<string, unknown>() };
let memSeq = 1;

function open(): Promise<IDBDatabase | null> {
  if (dbp) return dbp;
  dbp = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
        if (!db.objectStoreNames.contains("outbox")) db.createObjectStore("outbox", { keyPath: "seq", autoIncrement: true });
        if (!db.objectStoreNames.contains("roomMsgs")) db.createObjectStore("roomMsgs", { keyPath: "id" }).createIndex("room", "room");
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbp;
}

function run<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        if (!db) return reject(new Error("no idb"));
        const tx = db.transaction(store, mode);
        const req = fn(tx.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      })
  );
}

export async function kvGet<T>(key: string): Promise<T | undefined> {
  try {
    return (await run("kv", "readonly", (s) => s.get(key))) as T | undefined;
  } catch {
    return mem.kv.get(key) as T | undefined;
  }
}
export async function kvSet(key: string, value: unknown) {
  try {
    await run("kv", "readwrite", (s) => s.put(value, key));
  } catch {
    mem.kv.set(key, value);
  }
}

export async function outboxAdd(op: object): Promise<number> {
  try {
    return (await run("outbox", "readwrite", (s) => s.add({ ...op, queuedAt: Date.now() }))) as number;
  } catch {
    const seq = memSeq++;
    mem.outbox.set(seq, { ...op, seq, queuedAt: Date.now() });
    return seq;
  }
}
export async function outboxAll<T>(): Promise<(T & { seq: number })[]> {
  try {
    return (await run("outbox", "readonly", (s) => s.getAll())) as (T & { seq: number })[];
  } catch {
    return [...mem.outbox.values()] as (T & { seq: number })[];
  }
}
export async function outboxDelete(seq: number) {
  try {
    await run("outbox", "readwrite", (s) => s.delete(seq));
  } catch {
    mem.outbox.delete(seq);
  }
}

export async function roomMsgPut(msg: { id: string; room: number }) {
  try {
    await run("roomMsgs", "readwrite", (s) => s.put(msg));
  } catch {
    mem.roomMsgs.set(msg.id, msg);
  }
}
export async function roomMsgGet<T>(id: string): Promise<T | undefined> {
  try {
    return (await run("roomMsgs", "readonly", (s) => s.get(id))) as T | undefined;
  } catch {
    return mem.roomMsgs.get(id) as T | undefined;
  }
}
export async function roomMsgsFor<T>(room: number): Promise<T[]> {
  try {
    return (await run("roomMsgs", "readonly", (s) => s.index("room").getAll(room))) as T[];
  } catch {
    return [...mem.roomMsgs.values()].filter((m: any) => m.room === room) as T[];
  }
}

export async function clearAll() {
  mem.kv.clear();
  mem.outbox.clear();
  mem.roomMsgs.clear();
  const db = await open();
  if (!db) return;
  for (const s of ["kv", "outbox", "roomMsgs"]) await run(s, "readwrite", (st) => st.clear()).catch(() => {});
}
