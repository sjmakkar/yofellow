import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, MODE_ICON, OfflineError, type Game, type Match, type Message } from "../api";
import { enqueue, onResult, type Op } from "../lib/outbox";
import { outboxAll } from "../lib/idb";
import { uuid } from "../../../shared/mesh";
import { useApp } from "../App";
import { getSocket } from "../socket";
import Avatar from "../components/Avatar";
import GameCard from "../components/GameCard";
import GamePicker from "../components/GamePicker";

export default function Chat() {
  const { id } = useParams();
  const matchId = Number(id);
  const { me, toast } = useApp();
  const nav = useNavigate();
  const [match, setMatch] = useState<Match | null>(null);
  const [msgs, setMsgs] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [typing, setTyping] = useState(false);
  const [picker, setPicker] = useState(false);
  const [menu, setMenu] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const lastTypingSent = useRef(0);

  useEffect(() => {
    api<Match>(`/matches/${matchId}`).then(setMatch).catch(() => nav("/chats"));
    // Server history (cached when offline) plus our messages still waiting in the outbox.
    Promise.all([api<Message[]>(`/matches/${matchId}/messages`).catch(() => [] as Message[]), outboxAll<Op>()]).then(([server, queued]) => {
      const pending = queued
        .filter((o): o is Extract<Op, { op: "dm_msg" }> & { seq: number } => o.op === "dm_msg" && o.matchId === matchId)
        .map((o) => localMsg(o.uuid, o.body));
      setMsgs([...server, ...pending.filter((p) => !server.some((m) => m.uuid === p.uuid))]);
    });
    const offResult = onResult((op, r) => {
      if (op.op !== "dm_msg" || op.matchId !== matchId) return;
      setMsgs((prev) =>
        prev.map((m) => (m.uuid === op.uuid ? (r.ok && r.data ? r.data : { ...m, pending: false, failed: r.error || "Not sent" }) : m))
      );
    });

    const s = getSocket();
    let typingTimer: ReturnType<typeof setTimeout>;
    const onMsg = (m: Message) => {
      if (m.matchId !== matchId) return;
      setTyping(false);
      setMsgs((prev) => {
        if (m.uuid && prev.some((x) => x.uuid === m.uuid)) return prev.map((x) => (x.uuid === m.uuid ? m : x));
        return prev.some((x) => x.id === m.id) ? prev : [...prev, m];
      });
    };
    const onGame = (d: { matchId: number; game: Game }) => {
      if (d.matchId !== matchId) return;
      setMsgs((prev) => prev.map((m) => (m.game?.id === d.game.id ? { ...m, game: d.game } : m)));
    };
    const onTyping = (d: { matchId: number }) => {
      if (d.matchId !== matchId) return;
      setTyping(true);
      clearTimeout(typingTimer);
      typingTimer = setTimeout(() => setTyping(false), 3000);
    };
    const onMeet = (m: Match) => m.id === matchId && setMatch(m);
    const onClosed = (d: { matchId: number }) => {
      if (d.matchId === matchId) {
        toast("This chat was closed");
        nav("/chats");
      }
    };
    s?.on("message", onMsg);
    s?.on("game", onGame);
    s?.on("typing", onTyping);
    s?.on("meet", onMeet);
    s?.on("match:closed", onClosed);
    return () => {
      s?.off("message", onMsg);
      s?.off("game", onGame);
      s?.off("typing", onTyping);
      s?.off("meet", onMeet);
      s?.off("match:closed", onClosed);
      offResult();
    };
  }, [matchId]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [msgs.length, typing]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    setText("");
    // Every message goes through the outbox: instant when online, queued when not.
    const id = uuid();
    setMsgs((prev) => [...prev, localMsg(id, body)]);
    await enqueue({ op: "dm_msg", uuid: id, matchId, body });
  }

  function onType(v: string) {
    setText(v);
    const now = Date.now();
    if (now - lastTypingSent.current > 1500) {
      getSocket()?.emit("typing", { matchId });
      lastTypingSent.current = now;
    }
  }

  function localMsg(id: string, body: string): Message {
    return { id: -Date.now() - Math.random(), uuid: id, matchId, senderId: me!.id, kind: "text", body, at: new Date().toISOString(), pending: true };
  }

  async function toggleMeet() {
    if (!match) return;
    let r: Match;
    try {
      r = await api<Match>(`/matches/${matchId}/meet`, { body: { want: !match.meet.me } });
    } catch (e) {
      return toast(e instanceof OfflineError ? "Meeting up needs network, so both of you get the confirmation" : (e as Error).message);
    }
    setMatch(r);
    if (!r.meet.revealed && r.meet.me) toast(`We'll reveal coaches once ${match.with.name} also taps Meet`);
  }

  async function block() {
    if (!match || !confirm(`Block ${match.with.name}? They won't be able to see or message you.`)) return;
    await api(`/users/${match.with.id}/block`, { body: {} });
    toast("Blocked");
    nav("/chats");
  }

  async function report() {
    if (!match) return;
    const reason = prompt(`What happened with ${match.with.name}? Our team reviews every report.`);
    if (!reason) return;
    await api(`/users/${match.with.id}/report`, { body: { reason } });
    toast("Thanks, report sent. You can also block them.");
  }

  if (!match || !me) return <div className="page muted">Loading…</div>;

  return (
    <div className="chat">
      <header className="chathead">
        <Link to="/chats" className="back">←</Link>
        <Avatar name={match.with.name} size={38} />
        <div className="grow">
          <b>{match.with.name}</b>
          <div className="small muted">
            {typing ? "typing…" : `${MODE_ICON[match.trip.mode]} ${match.trip.number} · ${match.with.city || ""}`}
          </div>
        </div>
        <button className="iconbtn" onClick={() => setMenu(!menu)} aria-label="Safety menu">⋯</button>
        {menu && (
          <div className="menu" onClick={() => setMenu(false)}>
            <button onClick={report}>🚩 Report</button>
            <button onClick={block}>⛔ Block</button>
          </div>
        )}
      </header>

      <div className={`meetbar ${match.meet.revealed ? "revealed" : ""}`}>
        {match.meet.revealed ? (
          <span>📍 {match.with.name} is in <b>{match.meet.revealed.theirCoach}</b>. Meet in a public spot.</span>
        ) : (
          <>
            <span className="small">
              {match.meet.them ? `${match.with.name} wants to meet!` : match.meet.me ? "Waiting for them to agree" : "Coaches stay hidden until you both agree"}
            </span>
            <button className={`btn small ${match.meet.me ? "" : "primary"}`} onClick={toggleMeet}>
              {match.meet.me ? "Cancel" : "🤝 Meet"}
            </button>
          </>
        )}
      </div>

      <div className="msgs" ref={listRef}>
        {msgs.map((m) =>
          m.kind === "system" ? (
            <div key={m.id} className="sys">{m.body}</div>
          ) : m.kind === "game" && m.game ? (
            <GameCard key={m.id} game={m.game} meId={me.id} otherName={match.with.name} mine={m.senderId === me.id} />
          ) : (
            <div key={m.uuid || m.id} className={`bubble ${m.senderId === me.id ? "mine" : ""} ${m.pending ? "pending" : ""}`}>
              {m.body}
              {m.pending && <small className="bmeta">🕓 will send when online</small>}
              {m.failed && <small className="bmeta">Not sent: {m.failed}</small>}
            </div>
          )
        )}
        {typing && <div className="bubble typing"><i /><i /><i /></div>}
      </div>

      {picker && <GamePicker matchId={matchId} onClose={() => setPicker(false)} />}

      <form className="composer" onSubmit={send}>
        <button type="button" className="iconbtn game" onClick={() => setPicker(true)} aria-label="Play a game">🎲</button>
        <input value={text} onChange={(e) => onType(e.target.value)} placeholder="Message" maxLength={1000} />
        <button className="btn primary small" disabled={!text.trim()}>Send</button>
      </form>
    </div>
  );
}
