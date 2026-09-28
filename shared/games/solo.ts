// Solo only games: no opponent needed, fully offline.

export type Trivia = { q: string; options: string[]; answer: number; fact?: string };

export const TRIVIA: Trivia[] = [
  { q: "Which is the longest running train route in India?", options: ["Vivek Express", "Himsagar Express", "Rajdhani Express", "Navyug Express"], answer: 0, fact: "It runs from Dibrugarh in Assam to Kanyakumari." },
  { q: "Which Indian city got the first metro rail?", options: ["Kolkata", "Delhi", "Mumbai", "Bengaluru"], answer: 0, fact: "Kolkata Metro opened in 1984." },
  { q: "What is the IATA code for Delhi airport?", options: ["DEL", "DLH", "IGI", "NDL"], answer: 0 },
  { q: "Which hill railway is a UNESCO World Heritage Site?", options: ["Darjeeling Himalayan Railway", "Konkan Railway", "Palace on Wheels", "Deccan Odyssey"], answer: 0 },
  { q: "Which city is called the Pink City?", options: ["Jaipur", "Udaipur", "Jodhpur", "Bikaner"], answer: 0 },
  { q: "Which river flows through Varanasi?", options: ["Ganga", "Yamuna", "Narmada", "Godavari"], answer: 0 },
  { q: "How many time zones does India officially use?", options: ["1", "2", "3", "4"], answer: 0 },
  { q: "Which is the capital of Himachal Pradesh?", options: ["Shimla", "Manali", "Dharamshala", "Kullu"], answer: 0 },
  { q: "Which state is known as the Land of Five Rivers?", options: ["Punjab", "Haryana", "Assam", "Bihar"], answer: 0 },
  { q: "Chhatrapati Shivaji Maharaj Terminus is in which city?", options: ["Mumbai", "Pune", "Nagpur", "Nashik"], answer: 0 },
  { q: "Which city is famous as the Silicon Valley of India?", options: ["Bengaluru", "Hyderabad", "Pune", "Chennai"], answer: 0 },
  { q: "The Golden Temple is in which city?", options: ["Amritsar", "Ludhiana", "Patiala", "Jalandhar"], answer: 0 },
  { q: "Which is the largest state of India by area?", options: ["Rajasthan", "Madhya Pradesh", "Maharashtra", "Uttar Pradesh"], answer: 0 },
  { q: "Which Indian state has the longest coastline?", options: ["Gujarat", "Tamil Nadu", "Andhra Pradesh", "Kerala"], answer: 0 },
  { q: "Charminar is in which city?", options: ["Hyderabad", "Lucknow", "Bhopal", "Mysuru"], answer: 0 },
  { q: "Which city is known as the City of Lakes?", options: ["Udaipur", "Bhopal", "Srinagar", "Nainital"], answer: 0 },
  { q: "What does IRCTC stand for? Indian Railway Catering and ...", options: ["Tourism Corporation", "Travel Company", "Ticketing Centre", "Transport Council"], answer: 0 },
  { q: "Which is the southernmost tip of mainland India?", options: ["Kanyakumari", "Rameswaram", "Kovalam", "Puducherry"], answer: 0 },
  { q: "Which festival is called the festival of lights?", options: ["Diwali", "Holi", "Onam", "Pongal"], answer: 0 },
  { q: "Where is the Taj Mahal?", options: ["Agra", "Delhi", "Lucknow", "Jaipur"], answer: 0 },
];

export const WORDS: { word: string; hint: string }[] = [
  { word: "MUMBAI", hint: "City of dreams" },
  { word: "JAIPUR", hint: "The Pink City" },
  { word: "SHIMLA", hint: "Hill station, capital of Himachal" },
  { word: "KOLKATA", hint: "City of Joy" },
  { word: "CHENNAI", hint: "Gateway to South India" },
  { word: "LUCKNOW", hint: "City of Nawabs" },
  { word: "AMRITSAR", hint: "Home of the Golden Temple" },
  { word: "RAJDHANI", hint: "Famous express train" },
  { word: "PLATFORM", hint: "Where you wait for the train" },
  { word: "SAMOSA", hint: "Favourite station snack" },
  { word: "BERTH", hint: "Where you sleep on a train" },
  { word: "TICKET", hint: "Don't travel without it" },
  { word: "SUITCASE", hint: "You pack it" },
  { word: "HIMALAYA", hint: "Mountain range in the north" },
  { word: "GOA", hint: "Beaches and more beaches" },
  { word: "KERALA", hint: "God's own country" },
  { word: "CHAIWALA", hint: "Brings you tea on the train" },
  { word: "PASSPORT", hint: "Needed to fly abroad" },
];

export function shuffle<T>(arr: T[], rng: () => number = Math.random) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function scramble(word: string, rng: () => number = Math.random) {
  if (word.length < 2) return word;
  let s = word;
  for (let i = 0; i < 10 && s === word; i++) s = shuffle(word.split(""), rng).join("");
  return s;
}

/** Trivia with the options shuffled so the right answer isn't always first. */
export function triviaRound(count = 10, rng: () => number = Math.random) {
  return shuffle(TRIVIA, rng)
    .slice(0, count)
    .map((t) => {
      const correct = t.options[t.answer];
      const options = shuffle(t.options, rng);
      return { ...t, options, answer: options.indexOf(correct) };
    });
}
