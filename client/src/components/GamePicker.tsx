import { useState } from "react";
import { api } from "../api";
import { useApp } from "../App";

const GAMES = [
  { type: "wyr", icon: "🤔", name: "Would you rather", desc: "Pick one, see if you agree" },
  { type: "this_or_that", icon: "⚡", name: "This or that", desc: "Quick fire choices" },
  { type: "trivia", icon: "🧠", name: "Travel trivia", desc: "Who knows India better?" },
  { type: "deep_q", icon: "💭", name: "Ask me anything", desc: "One question, both answer" },
  { type: "two_truths", icon: "🕵️", name: "Two truths and a lie", desc: "Can they spot your lie?" },
] as const;

export default function GamePicker({ matchId, onClose }: { matchId: number; onClose: () => void }) {
  const { toast } = useApp();
  const [ttl, setTtl] = useState(false);
  const [statements, setStatements] = useState(["", "", ""]);
  const [lie, setLie] = useState<number | null>(null);

  async function start(type: string, extra: object = {}) {
    try {
      await api(`/matches/${matchId}/games`, { body: { type, ...extra } });
      onClose();
    } catch (e) {
      toast((e as Error).message);
    }
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        {!ttl ? (
          <>
            <h3>Play a game</h3>
            {GAMES.map((g) => (
              <button key={g.type} className="gamepick" onClick={() => (g.type === "two_truths" ? setTtl(true) : start(g.type))}>
                <span className="gicon">{g.icon}</span>
                <span>
                  <b>{g.name}</b>
                  <small>{g.desc}</small>
                </span>
              </button>
            ))}
          </>
        ) : (
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              if (lie !== null) start("two_truths", { statements, lie });
            }}
          >
            <h3>Two truths and a lie</h3>
            <p className="hint">Write 3 things about you. Tap the one that is the lie.</p>
            {statements.map((s, i) => (
              <div className="row" key={i}>
                <input
                  value={s}
                  maxLength={140}
                  placeholder={`Statement ${i + 1}`}
                  onChange={(e) => setStatements((p) => p.map((x, j) => (j === i ? e.target.value : x)))}
                  required
                />
                <button type="button" className={`btn small ${lie === i ? "primary" : ""}`} onClick={() => setLie(i)}>
                  {lie === i ? "Lie" : "Truth"}
                </button>
              </div>
            ))}
            <button className="btn primary" disabled={lie === null || statements.some((s) => !s.trim())}>
              Send
            </button>
            <button type="button" className="btn ghost" onClick={() => setTtl(false)}>
              Back
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
