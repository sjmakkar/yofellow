// Seeds demo travellers on a few trips so you can try the app alone.
// Run: npm run seed   (then log in with any phone number, OTP 123456)
import "./env.js"; // must stay first
import { db, initDb, tripKey } from "./db.js";
import { ensureRooms, ingestEnvelope } from "./rooms.js";
import { demoEnvelope } from "./demo.js";

/**
 * Adds demo travellers, trips for today, starter group messages and signal data.
 * Safe to run many times. The dev server calls this on startup.
 */
export async function seedDemo(log = console.log) {
  await initDb();
  process.env.YF_SEEDING = "1"; // no demo bot replies while seeding

  const today = new Date().toISOString().slice(0, 10);

  const people = [
    { phone: "9000000001", name: "Aisha", age: 23, gender: "woman", city: "Delhi", bio: "Design student, always carrying a sketchbook.", interests: ["art", "music", "travel", "chai", "photography"], intent: "friends" },
    { phone: "9000000002", name: "Rohan", age: 25, gender: "man", city: "Mumbai", bio: "Backend dev. Will talk cricket for 10 hours.", interests: ["cricket", "coding", "startups", "music"], intent: "friends" },
    { phone: "9000000003", name: "Meera", age: 24, gender: "woman", city: "Jaipur", bio: "Books, mountains and bad puns.", interests: ["books", "trekking", "travel", "movies"], intent: "dating" },
    { phone: "9000000004", name: "Kabir", age: 27, gender: "man", city: "Delhi", bio: "Guitarist, part time foodie.", interests: ["music", "food", "guitar", "travel"], intent: "dating" },
    { phone: "9000000005", name: "Sana", age: 22, gender: "woman", city: "Chandigarh", bio: "Final year law student, debate nerd.", interests: ["debate", "books", "movies", "chai"], intent: "chat" },
    { phone: "9000000006", name: "Arjun", age: 29, gender: "man", city: "Bengaluru", bio: "Product manager. Ask me about AI.", interests: ["ai", "startups", "coding", "trekking"], intent: "friends" },
  ];

  const trips = [
    { mode: "train", number: "12951", coach: "B3" },
    { mode: "flight", number: "6E2134", coach: "" },
    { mode: "bus", number: "HRTC-DEL-SHIMLA", coach: "" },
  ];

  const insUser = db.prepare(
    "INSERT INTO users (phone, name, age, gender, city, bio, interests, intent) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING"
  );
  const insTrip = db.prepare(
    "INSERT INTO trips (user_id, mode, number, date, coach, intent, from_place, to_place, trip_key) VALUES (?,?,?,?,?,?,?,?,?)"
  );

  for (const p of people) {
    await insUser.run(p.phone, p.name, p.age, p.gender, p.city, p.bio, JSON.stringify(p.interests), p.intent);
    const u = (await db.prepare("SELECT id FROM users WHERE phone=?").get<{ id: number }>(p.phone))!;
    for (const t of trips) {
      const key = tripKey(t.mode, t.number, today);
      const exists = await db.prepare("SELECT 1 FROM trips WHERE user_id=? AND trip_key=?").get(u.id, key);
      if (!exists) await insTrip.run(u.id, t.mode, t.number, today, t.coach, p.intent, "", "", key);
    }
  }

  log(`Seeded ${people.length} demo travellers on train 12951, flight 6E2134 and bus HRTC-DEL-SHIMLA for ${today}.`);
  log("Demo travellers wave back, reply and play games automatically while DEMO_BOTS is on (default in dev).");

  // ---------- group rooms with a few starter messages ----------

  const starters: [string, string][] = [
    ["9000000002", "Anyone else going all the way to Delhi?"],
    ["9000000005", "Yes! Coach B3 here. This network is already patchy 😅"],
    ["9000000006", "Pantry dinner is decent on this one, try the paneer"],
  ];
  for (const t of trips) {
    const key = tripKey(t.mode, t.number, today);
    await ensureRooms({ trip_key: key, coach: t.coach, mode: t.mode, number: t.number });
  }
  const trainRoom = (await db.prepare("SELECT id FROM rooms WHERE trip_key=? AND kind='train'").get<{ id: number }>(tripKey("train", "12951", today)))!;
  const hasMsgs = await db.prepare("SELECT 1 FROM room_messages WHERE room_id=?").get(trainRoom.id);
  if (!hasMsgs) {
    let ts = Date.now() - 20 * 60000;
    for (const [phone, body] of starters) {
      const u = (await db.prepare("SELECT id, name FROM users WHERE phone=?").get<{ id: number; name: string }>(phone))!;
      const r = await ingestEnvelope(await demoEnvelope(u.id, u.name, trainRoom.id, body, (ts += 4 * 60000)), u.id);
      if ("error" in r) log("starter failed:", r.error);
    }
  }

  // ---------- signal map: 6 past runs of train 12951 (Mumbai Central to New Delhi) ----------
  // Demo data. Positions follow the real stations roughly; dead zones are illustrative.
  const PATH: [number, number][] = [
    [18.9696, 72.8194], // Mumbai Central
    [21.2049, 72.8411], // Surat
    [22.3106, 73.1810], // Vadodara
    [23.3315, 75.0367], // Ratlam
    [25.1802, 75.8364], // Kota
    [26.0173, 76.3553], // Sawai Madhopur
    [27.4924, 77.6737], // Mathura
    [28.6430, 77.2194], // New Delhi
  ];
  const DEAD: [number, number][] = [
    [0.22, 0.27], // after Vadodara, hilly stretch
    [0.41, 0.46], // before Ratlam
    [0.63, 0.69], // Kota to Sawai Madhopur, Chambal ravines
    [0.84, 0.86],
  ];
  function pointAt(f: number): [number, number] {
    const seg = f * (PATH.length - 1);
    const i = Math.min(PATH.length - 2, Math.floor(seg));
    const t = seg - i;
    return [PATH[i][0] + (PATH[i + 1][0] - PATH[i][0]) * t, PATH[i][1] + (PATH[i + 1][1] - PATH[i][1]) * t];
  }
  const route = "train|12951";
  const hasSignal = await db.prepare("SELECT 1 FROM signal_samples WHERE route=?").get(route);
  if (!hasSignal) {
    const userIds = (await db.prepare("SELECT id FROM users WHERE phone LIKE '900000000%'").all<{ id: number }>()).map((r) => r.id);
    const durationMin = 15.5 * 60;
    const rows: (number | string)[][] = [];
    for (let d = 1; d <= 6; d++) {
      const date = new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
      const start = new Date(`${date}T11:30:00Z`).getTime(); // 17:00 IST departure
      const uid = userIds[d % userIds.length];
      const jitter = (Math.random() - 0.5) * 0.02;
      for (let m = 0; m <= durationMin; m += 2) {
        const f = m / durationMin;
        const [lat, lng] = pointAt(f);
        const offline = DEAD.some(([a, b]) => f >= a + jitter && f <= b + jitter) || Math.random() < 0.03;
        rows.push([uid, route, date, lat + (Math.random() - 0.5) * 0.004, lng + (Math.random() - 0.5) * 0.004, offline ? 0 : 1, start + m * 60000]);
      }
    }
    await db.insertMany("signal_samples", ["user_id", "route", "date", "lat", "lng", "online", "ts"], rows);
    log("Seeded signal map for train 12951 from 6 past runs.");
  }
  delete process.env.YF_SEEDING;
}

// CLI: npm run seed (only while the dev server is stopped; the server seeds by itself anyway)
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("seed.ts")) {
  if (process.env.NODE_ENV === "production" && !process.argv.includes("--force")) {
    console.error("Refusing to seed demo data in production. Pass --force if you really mean it.");
    process.exit(1);
  }
  const busy = await fetch(`http://localhost:${process.env.PORT || 4000}/health`).then(() => true).catch(() => false);
  if (busy && !process.env.DATABASE_URL) {
    console.error("The dev server is running and already seeds demo data on startup. Stop it first if you want to run this.");
    process.exit(1);
  }
  await seedDemo();
  await db.close();
}
