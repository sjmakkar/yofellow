import { useState } from "react";
import { api, OfflineError, type Game } from "../api";
import { enqueue } from "../lib/outbox";
import { useApp } from "../App";

export default function GameCard({ game, meId, otherName, mine }: { game: Game; meId: number; otherName: string; mine: boolean }) {
  const { toast } = useApp();
  const [text, setText] = useState("");
  const [queued, setQueued] = useState(false);
  const p = game.prompt;
  const iAnswered = game.answered.includes(meId) || queued;
  const otherId = Object.keys(game.answers).map(Number).find((k) => k !== meId);
  const myAns = game.answers[meId];
  const theirAns = otherId !== undefined ? game.answers[otherId] : undefined;

  async function answer(a: number | string) {
    try {
      await api(`/games/${game.id}/answer`, { body: { answer: a } });
    } catch (e) {
      if (e instanceof OfflineError) {
        await enqueue({ op: "game_answer", gameId: game.id, answer: a });
        setQueued(true);
        toast("Answer saved, it will send when you're back online");
      } else toast((e as Error).message);
    }
  }

  const waiting = <p className="small muted">Waiting for {otherName}…</p>;

  let body: React.ReactNode;
  if (game.type === "wyr" || game.type === "this_or_that" || game.type === "trivia") {
    const options: string[] = p.options;
    body = (
      <>
        {p.q && <p className="gq">{p.q}</p>}
        <div className="gopts">
          {options.map((o, i) => {
            const cls = [
              "gopt",
              game.complete && myAns === i ? "me" : "",
              game.complete && theirAns === i ? "them" : "",
              game.complete && game.type === "trivia" && p.answer === i ? "correct" : "",
            ].join(" ");
            return (
              <button key={i} className={cls} disabled={iAnswered} onClick={() => answer(i)}>
                {o}
                {game.complete && (
                  <span className="who">
                    {myAns === i && "You"}
                    {myAns === i && theirAns === i && " + "}
                    {theirAns === i && otherName}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        {game.complete ? (
          <p className="result">
            {game.type === "trivia"
              ? `${myAns === p.answer ? "You got it!" : "You missed it."} ${theirAns === p.answer ? `${otherName} got it too.` : `${otherName} missed it.`}`
              : myAns === theirAns
              ? "Same pick! Great vibe ✨"
              : "Different picks, time to debate 😄"}
          </p>
        ) : iAnswered ? (
          waiting
        ) : null}
      </>
    );
  } else if (game.type === "deep_q") {
    body = (
      <>
        <p className="gq">{p.q}</p>
        {game.complete ? (
          <div className="stack small">
            <div className="ans"><b>You:</b> {String(myAns)}</div>
            <div className="ans"><b>{otherName}:</b> {String(theirAns)}</div>
          </div>
        ) : iAnswered ? (
          waiting
        ) : (
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              if (text.trim()) answer(text.trim());
            }}
          >
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Your answer" maxLength={300} />
            <button className="btn small primary">Answer</button>
          </form>
        )}
        <p className="hint">Answers show when you both reply.</p>
      </>
    );
  } else {
    // two truths and a lie
    const creator = game.creatorId === meId;
    const guess = game.complete ? (creator ? theirAns : myAns) : undefined;
    body = (
      <>
        <p className="gq">{creator ? `${otherName} is guessing your lie` : `Which one is ${otherName}'s lie?`}</p>
        <div className="gopts">
          {(p.statements as string[]).map((s, i) => (
            <button
              key={i}
              className={["gopt", game.complete && p.lie === i ? "correct" : "", game.complete && guess === i ? "them" : ""].join(" ")}
              disabled={creator || iAnswered}
              onClick={() => answer(i)}
            >
              {s}
              {creator && !game.complete && p.lie === i && <span className="who">your lie</span>}
            </button>
          ))}
        </div>
        {game.complete && (
          <p className="result">
            {guess === p.lie ? (creator ? `${otherName} caught your lie 🕵️` : "You caught the lie! 🕵️") : creator ? `${otherName} got fooled 😎` : "Fooled you! 😎"}
          </p>
        )}
      </>
    );
  }

  return (
    <div className={`gamecard ${mine ? "mine" : ""}`}>
      <div className="gtitle">🎲 {p.title}</div>
      {body}
    </div>
  );
}
