// Icebreaker games that two matched travellers can play inside chat.
// Every game has a prompt and an answers map { userId: answer }.
// Results are revealed only when both players have answered.

export type GameType = "wyr" | "this_or_that" | "trivia" | "deep_q" | "two_truths";

const WYR: [string, string][] = [
  ["Travel only by train forever", "Travel only by flight forever"],
  ["Window seat with no charging point", "Aisle seat with a charging point"],
  ["Know every language", "Play every instrument"],
  ["Live in the mountains", "Live by the beach"],
  ["Eat only street food for a year", "Eat only home food for a year"],
  ["Have a 10 hour journey with great company", "A 2 hour journey alone"],
  ["Be able to teleport, but only to places you have been", "Fly, but only at cycling speed"],
  ["Give up Instagram for a year", "Give up YouTube for a year"],
  ["Road trip with friends", "Solo backpacking trip"],
  ["Always be 10 minutes late", "Always be 30 minutes early"],
];

const THIS_OR_THAT: [string, string][] = [
  ["Chai", "Coffee"],
  ["Sunrise", "Sunset"],
  ["Books", "Movies"],
  ["Pahad", "Samundar"],
  ["Biryani", "Chole bhature"],
  ["Cricket", "Football"],
  ["Night owl", "Early bird"],
  ["Bollywood", "Hollywood"],
  ["Upper berth", "Lower berth"],
  ["Plan everything", "Go with the flow"],
];

const TRIVIA: { q: string; options: string[]; answer: number }[] = [
  { q: "Which is the longest running train route in India?", options: ["Vivek Express", "Himsagar Express", "Rajdhani Express", "Navyug Express"], answer: 0 },
  { q: "Which Indian city got the first metro rail?", options: ["Kolkata", "Delhi", "Mumbai", "Bengaluru"], answer: 0 },
  { q: "What is the IATA code for Delhi airport?", options: ["DEL", "DLH", "IGI", "NDL"], answer: 0 },
  { q: "Which Indian hill train is a UNESCO World Heritage Site?", options: ["Darjeeling Himalayan Railway", "Konkan Railway", "Palace on Wheels", "Deccan Odyssey"], answer: 0 },
  { q: "Which city is called the Pink City?", options: ["Jaipur", "Udaipur", "Jodhpur", "Bikaner"], answer: 0 },
  { q: "Which is the highest airport in India by elevation?", options: ["Leh", "Srinagar", "Shimla", "Bagdogra"], answer: 0 },
  { q: "How many time zones does India officially use?", options: ["1", "2", "3", "4"], answer: 0 },
  { q: "Which river is Varanasi on?", options: ["Ganga", "Yamuna", "Narmada", "Godavari"], answer: 0 },
];

const DEEP_Q: string[] = [
  "Where are you headed and what is waiting for you there?",
  "What is a small thing that made you happy this week?",
  "If this train could go anywhere in the world, where would you send it?",
  "What is the best trip you have ever taken?",
  "What is something you are learning right now?",
  "What song are you playing on repeat these days?",
  "What would your perfect Sunday look like?",
  "What is one thing people usually get wrong about you?",
];

const pick = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];

function shuffleTrivia(t: (typeof TRIVIA)[number]) {
  const correct = t.options[t.answer];
  const opts = [...t.options].sort(() => Math.random() - 0.5);
  return { q: t.q, options: opts, answer: opts.indexOf(correct) };
}

/** Create the prompt for a new game. two_truths needs the creator's statements. */
export function makePrompt(type: GameType, input?: { statements?: string[]; lie?: number }) {
  switch (type) {
    case "wyr": {
      const [a, b] = pick(WYR);
      return { title: "Would you rather", options: [a, b] };
    }
    case "this_or_that": {
      const [a, b] = pick(THIS_OR_THAT);
      return { title: "This or that", options: [a, b] };
    }
    case "trivia":
      return { title: "Travel trivia", ...shuffleTrivia(pick(TRIVIA)) };
    case "deep_q":
      return { title: "Ask me anything", q: pick(DEEP_Q) };
    case "two_truths": {
      const statements = (input?.statements || []).map((s) => String(s).slice(0, 140));
      const lie = Number(input?.lie);
      if (statements.length !== 3 || statements.some((s) => !s.trim()) || ![0, 1, 2].includes(lie)) {
        throw new Error("Two truths and a lie needs 3 statements and which one is the lie");
      }
      return { title: "Two truths and a lie", statements, lie };
    }
  }
}

/** Who needs to answer before results show. */
export function isComplete(type: GameType, answers: Record<string, unknown>, creatorId: number, players: number[]) {
  if (type === "two_truths") {
    const guesser = players.find((p) => p !== creatorId)!;
    return answers[guesser] !== undefined;
  }
  return players.every((p) => answers[p] !== undefined);
}

/** Hide secrets (trivia answer, the lie) until the game is complete. */
export function viewGame(game: { id: number; type: GameType; creator_id: number; prompt: string; answers: string }, players: number[]) {
  const prompt = JSON.parse(game.prompt);
  const answers = JSON.parse(game.answers || "{}");
  const complete = isComplete(game.type, answers, game.creator_id, players);
  const safePrompt = { ...prompt };
  if (!complete) {
    delete safePrompt.answer;
    delete safePrompt.lie;
  }
  return {
    id: game.id,
    type: game.type,
    creatorId: game.creator_id,
    prompt: safePrompt,
    answered: Object.keys(answers).map(Number),
    answers: complete ? answers : {},
    complete,
  };
}
