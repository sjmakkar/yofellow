import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ENGINES } from "../../../shared/games/index";
import { triviaRound, WORDS, scramble, shuffle } from "../../../shared/games/solo";
import { kvGet, kvSet } from "../lib/idb";
import { useApp } from "../App";
import GameView from "../components/GameView";
import { GAME_INFO } from "../lib/play";

// Solo games run fully on the phone, so they work with no network at all.
export default function Solo() {
  const kind = useParams().kind!;
  if (kind === "trivia") return <SoloTrivia />;
  if (kind === "scramble") return <SoloScramble />;
  if (!ENGINES[kind]) return <div className="page"><p>Unknown game</p><Link to="/games" className="back">← Games</Link></div>;
  return <SoloBoard kind={kind} />;
}

type Saved = { state: any; seats: { name: string; bot: boolean }[]; me: number };

function SoloBoard({ kind }: { kind: string }) {
  const { me } = useApp();
  const e = ENGINES[kind];
  const info = GAME_INFO[kind];
  const [game, setGame] = useState<Saved | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [players, setPlayers] = useState(4);
  const [thinking, setThinking] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    kvGet<Saved>(`solo:${kind}`).then((g) => {
      if (g && !e.result(g.state).over) setGame(g);
      setLoaded(true);
    });
  }, [kind]);

  // computer turns
  useEffect(() => {
    if (!game) return;
    kvSet(`solo:${kind}`, game);
    const seat = e.turn(game.state);
    if (seat < 0 || !game.seats[seat].bot) return;
    setThinking(true);
    timer.current = setTimeout(() => {
      // let the "thinking" label paint before a heavy chess search
      const m = e.bot(game.state, seat, Math.random);
      setGame((g) => (g ? { ...g, state: e.apply(g.state, seat, m, Math.random) } : g));
      setThinking(false);
    }, kind === "ludo" ? 650 : 450);
    return () => clearTimeout(timer.current);
  }, [game]);

  function start(asSeat = 0) {
    const n = kind === "ludo" ? players : 2;
    const names = ["Chotu", "Pinky", "Bablu"];
    const seats = Array.from({ length: n }, (_, i) => (i === asSeat ? { name: me?.name || "You", bot: false } : { name: `${names[(i + 2) % 3]} (computer)`, bot: true }));
    setGame({ state: e.init(n, Math.random), seats, me: asSeat });
  }

  function move(m: any) {
    if (!game) return;
    const err = e.check(game.state, game.me, m);
    if (err) return;
    setGame({ ...game, state: e.apply(game.state, game.me, m, Math.random) });
  }

  if (!loaded) return <div className="page muted">Loading…</div>;
  const res = game ? e.result(game.state) : null;

  return (
    <div className="page stack">
      <header className="pagehead">
        <Link to="/games" className="back">← Games</Link>
        <h2>{info.icon} {info.title} <small className="muted">vs computer</small></h2>
      </header>
      {!game ? (
        <div className="card stack">
          <p className="muted">{info.blurb} Works offline too.</p>
          {kind === "ludo" && (
            <>
              <span className="label">Players</span>
              <div className="seg">
                {[2, 3, 4].map((n) => (
                  <button key={n} className={players === n ? "on" : ""} onClick={() => setPlayers(n)}>{n}</button>
                ))}
              </div>
            </>
          )}
          {kind === "chess" ? (
            <div className="row">
              <button className="btn primary" onClick={() => start(0)}>Play white</button>
              <button className="btn" onClick={() => start(1)}>Play black</button>
            </div>
          ) : (
            <button className="btn primary" onClick={() => start(0)}>Start</button>
          )}
        </div>
      ) : (
        <GameView
          kind={kind}
          title={info.title}
          seats={game.seats}
          state={game.state}
          mySeat={game.me}
          turn={e.turn(game.state)}
          status={res!.over ? "done" : "active"}
          winners={res!.winners}
          resultText={res!.text ?? null}
          thinking={thinking}
          busy={thinking}
          onMove={move}
          actions={
            <>
              <button className="btn ghost small" onClick={() => (res!.over || confirm("Start a new game?")) && setGame(null)}>New game</button>
            </>
          }
        />
      )}
    </div>
  );
}

function SoloTrivia() {
  const [qs, setQs] = useState(() => triviaRound(10));
  const [i, setI] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [score, setScore] = useState(0);
  const q = qs[i];
  const done = i >= qs.length;

  function pick(k: number) {
    if (picked !== null) return;
    setPicked(k);
    if (k === q.answer) setScore((s) => s + 1);
  }

  return (
    <div className="page stack">
      <header className="pagehead">
        <Link to="/games" className="back">← Games</Link>
        <h2>🧠 Travel trivia</h2>
      </header>
      {done ? (
        <div className="card stack center-text">
          <div className="big">{score >= 8 ? "🏆" : score >= 5 ? "👏" : "🙂"}</div>
          <h3>You scored {score}/{qs.length}</h3>
          <button className="btn primary" onClick={() => { setQs(triviaRound(10)); setI(0); setScore(0); setPicked(null); }}>Play again</button>
        </div>
      ) : (
        <div className="card stack">
          <p className="muted small">Question {i + 1} of {qs.length} · Score {score}</p>
          <p className="gq">{q.q}</p>
          <div className="gopts">
            {q.options.map((o, k) => (
              <button key={k} className={`gopt ${picked !== null && k === q.answer ? "correct me" : ""} ${picked === k && k !== q.answer ? "them" : ""}`} onClick={() => pick(k)}>
                {o}
              </button>
            ))}
          </div>
          {picked !== null && (
            <>
              <p className="result">{picked === q.answer ? "Correct! ✅" : "Not quite ❌"} {q.fact}</p>
              <button className="btn primary" onClick={() => { setI(i + 1); setPicked(null); }}>Next</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function SoloScramble() {
  const [list, setList] = useState(() => shuffle(WORDS));
  const [i, setI] = useState(0);
  const [guess, setGuess] = useState("");
  const [shown, setShown] = useState(() => scramble(list[0].word));
  const [score, setScore] = useState(0);
  const [hint, setHint] = useState(false);
  const [reveal, setReveal] = useState<null | "right" | "gave-up">(null);
  const w = list[i % list.length];

  function next() {
    const n = i + 1;
    if (n % list.length === 0) setList(shuffle(WORDS));
    setI(n);
    setShown(scramble(list[n % list.length].word));
    setGuess("");
    setHint(false);
    setReveal(null);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (guess.trim().toUpperCase() === w.word) {
      setScore((s) => s + (hint ? 1 : 2));
      setReveal("right");
    }
  }

  return (
    <div className="page stack">
      <header className="pagehead">
        <Link to="/games" className="back">← Games</Link>
        <h2>🔤 Word scramble</h2>
      </header>
      <div className="card stack">
        <p className="muted small">Score {score} · 2 points, or 1 with a hint</p>
        <div className="scramble">{shown.split("").map((ch, k) => <span key={k}>{ch}</span>)}</div>
        {hint && <p className="hint">Hint: {w.hint}</p>}
        {reveal ? (
          <>
            <p className="result">{reveal === "right" ? "Correct! ✅" : `It was ${w.word}`}</p>
            <button className="btn primary" onClick={next}>Next word</button>
          </>
        ) : (
          <form className="stack" onSubmit={submit}>
            <input value={guess} onChange={(e) => setGuess(e.target.value.toUpperCase())} placeholder="Your answer" autoFocus />
            <div className="row">
              <button className="btn primary" disabled={!guess.trim()}>Check</button>
              <button type="button" className="btn" onClick={() => setHint(true)} disabled={hint}>Hint</button>
              <button type="button" className="btn ghost" onClick={() => setReveal("gave-up")}>Skip</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
