// Group room messages from three sources, merged by message id:
//  1. the server (REST + socket) when online
//  2. nearby phones over the mesh when offline
//  3. our own posts, which wait in the outbox until the network is back
import { checkGroupMessage, signEnvelope, uuid, type Envelope } from "../../../shared/mesh";
import { api, type Pack, type Room, type RoomMsg } from "../api";
import { roomMsgGet, roomMsgPut, roomMsgsFor, kvSet } from "./idb";
import { enqueue, onResult } from "./outbox";
import { meshNode, onMeshDeliver } from "./mesh";
import { deviceKey, deviceCert } from "./keys";
import { getSocket } from "../socket";
import { net } from "./net";

const subs = new Set<(room: number) => void>();
export function onRoomChange(f: (room: number) => void) {
  subs.add(f);
  return () => subs.delete(f);
}
const changed = (room: number) => subs.forEach((f) => f(room));

// Only public rooms travel over the mesh. Coach and women rooms stay server only,
// so a stranger's phone never carries (or learns) your coach or those messages.
const publicRooms = new Set<number>();
export const isPublicRoom = (r: Pick<Room, "kind">) => r.kind === "train" || r.kind === "topic";
export function registerRooms(rooms: Room[]) {
  for (const r of rooms) if (isPublicRoom(r)) publicRooms.add(r.id);
}

const envOf = (m: RoomMsg): Envelope => ({ id: m.id, room: m.room, sender: m.sender, name: m.name, body: m.body, ts: m.ts, hops: m.hops, ttl: m.ttl, sig: m.sig, cert: m.cert });

export async function save(m: RoomMsg, status: RoomMsg["status"], extra: Partial<RoomMsg> = {}) {
  const prev = await roomMsgGet<RoomMsg>(m.id);
  // "sent" (the server has it) always wins over pending / mesh.
  const nextStatus = prev?.status === "sent" && status !== "sent" ? "sent" : status;
  const next: RoomMsg = { ...prev, ...m, ...extra, status: nextStatus, serverId: m.serverId ?? prev?.serverId };
  if (prev && prev.status === next.status && prev.serverId === next.serverId && prev.error === next.error) return;
  await roomMsgPut(next);
  changed(m.room);
}

export async function loadRoom(roomId: number) {
  const list = await roomMsgsFor<RoomMsg>(roomId);
  return list.sort((a, b) => a.ts - b.ts);
}

export async function fetchRoom(roomId: number) {
  const local = await roomMsgsFor<RoomMsg>(roomId);
  const after = Math.max(0, ...local.map((m) => m.serverId || 0));
  const r = await api<{ room: Room; messages: RoomMsg[] }>(`/rooms/${roomId}/messages?after=${after}`);
  for (const m of r.messages) await save(m, "sent");
  if (publicRooms.has(roomId)) for (const m of r.messages) meshNode()?.publish(envOf(m));
  return r.room;
}

export async function savePack(tripId: number, pack: Pack) {
  await kvSet(`pack:${tripId}`, pack);
  registerRooms(pack.rooms);
  for (const r of pack.rooms) for (const m of r.messages) await save(m, "sent");
}

export async function sendGroupMessage(room: Room, me: { id: number; name: string }, body: string) {
  const err = checkGroupMessage(body);
  if (err) throw new Error(err);
  if (room.archived) throw new Error("This room is archived");
  const kp = await deviceKey();
  const cert = await deviceCert();
  const env = { ...signEnvelope({ id: uuid(), room: room.id, sender: me.id, name: me.name, body: body.trim(), ts: Date.now(), hops: 0, ttl: 12 }, kp.secretKey), cert };
  await save(env, "pending");
  if (isPublicRoom(room)) meshNode()?.publish(env);
  await enqueue({ op: "room_msg", env });
}

let wired = false;
let wiredSocket: unknown = null;
export function wireGroupSync(myId: () => number | undefined) {
  const s = getSocket();
  if (s && s !== wiredSocket) {
    wiredSocket = s;
    s.on("room:message", async (m: RoomMsg) => {
      await save(m, "sent");
      if (publicRooms.has(m.room)) meshNode()?.publish(envOf(m));
    });
  }
  if (wired) return;
  wired = true;

  onResult(async (op, r) => {
    if (op.op !== "room_msg" && op.op !== "relay") return;
    const env = op.env as RoomMsg;
    if (r.ok && r.data) await save(r.data, "sent");
    else if (op.op === "room_msg") await save(env, "failed", { error: r.error });
  });

  // Heard from a nearby phone: show it, and queue it for upload in case the
  // author never gets signal (the server drops duplicates).
  onMeshDeliver(async (e) => {
    const known = await roomMsgGet<RoomMsg>(e.id);
    if (known) return;
    await save({ ...e }, "mesh");
    if (e.sender === myId()) return;
    if (net.isOffline()) await enqueue({ op: "relay", env: e });
    else
      // Online: the author probably sent it already. Only relay if the server
      // still does not have it after a while (the author may be the offline one).
      setTimeout(async () => {
        const m = await roomMsgGet<RoomMsg>(e.id);
        if (m?.status !== "sent") await enqueue({ op: "relay", env: e });
      }, 15000);
  });
}

export function joinRoomsLive(roomIds: number[]) {
  const s = getSocket();
  if (!s) return () => {};
  const join = () => roomIds.forEach((id) => s.emit("room:join", { roomId: id }));
  join();
  s.on("connect", join);
  return () => {
    s.off("connect", join);
    roomIds.forEach((id) => s.emit("room:leave", { roomId: id }));
  };
}
