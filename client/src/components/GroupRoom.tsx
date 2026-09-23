import { useEffect, useRef, useState } from "react";
import { api, OfflineError, type Pack, type Room, type RoomMsg } from "../api";
import { useApp } from "../App";
import { fetchRoom, isPublicRoom, joinRoomsLive, loadRoom, onRoomChange, registerRooms, sendGroupMessage } from "../lib/group";
import { kvGet, kvSet } from "../lib/idb";
import { useNet } from "../lib/net";
import Avatar from "./Avatar";

const ROOM_ICON: Record<Room["kind"], string> = { train: "🚆", coach: "🚪", women: "👩", topic: "#" };

type Props = {
  tripId: number;
  rooms: Room[];
  pack: Pack | null;
  onWave: (userId: number) => void;
  onRoomsChanged: () => void;
};

export default function GroupRoom({ tripId, rooms, pack, onWave, onRoomsChanged }: Props) {
  const { me, toast } = useApp();
  const n = useNet();
  const [active, setActive] = useState<number | null>(rooms[0]?.id ?? null);
  const [msgs, setMsgs] = useState<RoomMsg[]>([]);
  const [text, setText] = useState("");
  const [sheet, setSheet] = useState<RoomMsg | null>(null);
  const [muted, setMuted] = useState<number[]>([]);
  const listRef = useRef<HTMLDivElement>(null);
  const room = rooms.find((r) => r.id === active) || rooms[0];
  const blocked = new Set(pack?.blocked || []);
  const travellerIds = new Set((pack?.travellers || []).map((t) => t.user.id));

  useEffect(() => {
    kvGet<number[]>("muted").then((m) => setMuted(m || []));
  }, []);

  useEffect(() => {
    registerRooms(rooms);
    if (!active && rooms[0]) setActive(rooms[0].id);
    return joinRoomsLive(rooms.map((r) => r.id));
  }, [rooms.map((r) => r.id).join(",")]);

  // Local first: show what we have instantly, then top up from the server if we can.
  useEffect(() => {
    if (!room) return;
    let alive = true;
    const refresh = () => loadRoom(room.id).then((m) => alive && setMsgs(m));
    refresh();
    const off = onRoomChange((r) => r === room.id && refresh());
    if (n.status !== "offline") fetchRoom(room.id).catch(() => {});
    return () => {
      alive = false;
      off();
    };
  }, [room?.id, n.status]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight });
  }, [msgs.length, room?.id]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!me || !room || !text.trim()) return;
    try {
      await sendGroupMessage(room, { id: me.id, name: me.name }, text);
      setText("");
    } catch (err) {
      toast((err as Error).message);
    }
  }

  async function newTopic() {
    const name = prompt("Name your topic room, e.g. Cricket live, Antakshari, Students to Delhi");
    if (!name) return;
    try {
      const r = await api<Room>(`/trips/${tripId}/rooms`, { body: { name } });
      onRoomsChanged();
      setActive(r.id);
    } catch (err) {
      toast(err instanceof OfflineError ? "Topic rooms can be created when you're online" : (err as Error).message);
    }
  }

  async function mute(userId: number) {
    const next = [...new Set([...muted, userId])];
    setMuted(next);
    await kvSet("muted", next);
    toast("Muted. You won't see their group messages.");
  }

  async function report(m: RoomMsg) {
    const reason = prompt("What's wrong with this message?");
    if (!reason) return;
    try {
      await api(`/room-messages/${m.id}/report`, { body: { reason } });
      toast("Thanks, reported. 3 reports hide a message automatically.");
    } catch (err) {
      toast((err as Error).message);
    }
  }

  if (!room) return <p className="muted">Loading rooms…</p>;
  const visible = msgs.filter((m) => !blocked.has(m.sender) && !muted.includes(m.sender));

  return (
    <div className="group">
      <div className="roomtabs">
        {rooms.map((r) => (
          <button key={r.id} className={`roomtab ${r.id === room.id ? "on" : ""}`} onClick={() => setActive(r.id)}>
            <span>{ROOM_ICON[r.kind]}</span> {r.name}
            {r.kind !== "topic" && <small>{r.members}</small>}
          </button>
        ))}
        <button className="roomtab add" onClick={newTopic}>+ Topic</button>
      </div>

      <p className="roomhint">
        {room.kind === "women"
          ? "Only women on this journey can see this room."
          : room.kind === "coach"
          ? "Only people in your coach. Never relayed through other phones."
          : isPublicRoom(room)
          ? "Everyone on this journey. Works offline through nearby phones."
          : ""}
        {room.archived && " Archived, read only."}
      </p>

      <div className="msgs grouplist" ref={listRef}>
        {visible.length === 0 && <div className="sys">No messages yet. Say hi to your co-travellers 👋</div>}
        {visible.map((m) => {
          const mine = m.sender === me?.id;
          return (
            <div key={m.id} className={`gmsg ${mine ? "mine" : ""}`} onClick={() => !mine && setSheet(m)}>
              {!mine && <Avatar name={m.name} size={28} />}
              <div className="gbody">
                {!mine && <b className="gname">{m.name}</b>}
                <div>{m.body}</div>
                <small className="gmeta">
                  {new Date(m.ts).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}
                  {m.status === "pending" && " · waiting for network"}
                  {m.status === "mesh" && ` · via nearby phones${m.hops ? ` (${m.hops} hop${m.hops > 1 ? "s" : ""})` : ""}`}
                  {m.status === "failed" && ` · not sent: ${m.error}`}
                  {mine && m.status === "sent" && " · ✓"}
                </small>
              </div>
            </div>
          );
        })}
      </div>

      {!room.archived && (
        <form className="composer" onSubmit={send}>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder={`Message ${room.name.toLowerCase()}`} maxLength={500} />
          <button className="btn primary small" disabled={!text.trim()}>Send</button>
        </form>
      )}

      {sheet && (
        <div className="sheet-backdrop" onClick={() => setSheet(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <h3>{sheet.name}</h3>
            <p className="muted small">"{sheet.body}"</p>
            {travellerIds.has(sheet.sender) && (
              <button className="gamepick" onClick={() => (onWave(sheet.sender), setSheet(null))}>
                <span className="gicon">👋</span>
                <span><b>Wave at {sheet.name}</b><small>If they wave back, a private chat opens</small></span>
              </button>
            )}
            <button className="gamepick" onClick={() => (mute(sheet.sender), setSheet(null))}>
              <span className="gicon">🔇</span>
              <span><b>Mute</b><small>Hide their messages on your phone</small></span>
            </button>
            <button className="gamepick" onClick={() => (report(sheet), setSheet(null))}>
              <span className="gicon">🚩</span>
              <span><b>Report message</b><small>Reviewed by our team</small></span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
