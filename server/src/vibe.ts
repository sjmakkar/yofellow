import type { TripRow, UserRow } from "./db.js";

type Person = { user: UserRow; trip: TripRow };

const interestsOf = (u: UserRow) =>
  (JSON.parse(u.interests || "[]") as string[]).map((s) => s.trim().toLowerCase());

/** 1 = same intent, 0.5 = compatible, 0 = do not show each other. */
export function intentScore(a: string, b: string) {
  if (a === b) return 1;
  // Dating is strictly opt in on both sides.
  if (a === "dating" || b === "dating") return 0;
  return 0.5; // friends <-> chat
}

/** Can viewer see candidate at all? Safety and preference filters. */
export function isVisible(viewer: Person, cand: Person) {
  const v = viewer.user;
  const c = cand.user;
  if (v.id === c.id || c.hidden) return false;
  if (!c.name || !c.age) return false;
  // Women only mode works both ways.
  if (v.women_only && c.gender !== "woman") return false;
  if (c.women_only && v.gender !== "woman") return false;
  const vi = viewer.trip.intent;
  const ci = cand.trip.intent;
  if (intentScore(vi, ci) === 0) return false;
  if (vi === "dating") {
    const wants = (who: UserRow, other: UserRow) =>
      who.show_me === "everyone" ||
      (who.show_me === "women" && other.gender === "woman") ||
      (who.show_me === "men" && other.gender === "man");
    if (!wants(v, c) || !wants(c, v)) return false;
  }
  return true;
}

export function vibeScore(viewer: Person, cand: Person) {
  const a = new Set(interestsOf(viewer.user));
  const b = new Set(interestsOf(cand.user));
  const shared = [...a].filter((x) => b.has(x));
  const union = new Set([...a, ...b]).size;
  const jaccard = union ? shared.length / union : 0;

  const intent = intentScore(viewer.trip.intent, cand.trip.intent);
  const gap = Math.abs((viewer.user.age ?? 0) - (cand.user.age ?? 0));
  const age = Math.max(0, 1 - gap / 15);
  const coach =
    viewer.trip.coach &&
    cand.trip.coach &&
    viewer.trip.coach.trim().toUpperCase() === cand.trip.coach.trim().toUpperCase()
      ? 1
      : 0;
  const city =
    viewer.user.city &&
    cand.user.city &&
    viewer.user.city.trim().toLowerCase() === cand.user.city.trim().toLowerCase()
      ? 1
      : 0;

  // Jaccard is harsh on small sets, so give a floor boost per shared interest.
  const interestPart = Math.min(1, jaccard + shared.length * 0.1);
  const score = 50 * interestPart + 20 * intent + 15 * age + 10 * coach + 5 * city;
  return {
    score: Math.round(Math.min(100, score)),
    shared: interestsOf(cand.user).filter((x) => a.has(x)),
    sameCoach: !!coach,
    sameCity: !!city,
  };
}
