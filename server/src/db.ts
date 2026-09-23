// Uses the SQLite built into Node (22.13+), so there is nothing native to
// compile on install (no Visual Studio / build tools needed on Windows).
import { DatabaseSync } from "node:sqlite";
import path from "node:path";

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), "travelbuddy.db");
const raw = new DatabaseSync(DB_PATH);
raw.exec("PRAGMA journal_mode = WAL");
raw.exec("PRAGMA foreign_keys = ON");

type Param = null | number | bigint | string | Uint8Array;
type Stmt = {
  run: (...args: Param[]) => { changes: number | bigint; lastInsertRowid: number | bigint };
  get: (...args: Param[]) => unknown;
  all: (...args: Param[]) => unknown[];
};

/** Small wrapper so the rest of the code keeps a simple prepare/run/get/all API. */
export const db = {
  prepare(sql: string): Stmt {
    const st = raw.prepare(sql);
    return {
      run: (...a) => st.run(...a),
      get: (...a) => st.get(...a),
      all: (...a) => st.all(...a),
    };
  },
  exec(sql: string) {
    raw.exec(sql);
  },
  transaction<T extends unknown[]>(fn: (...args: T) => void) {
    return (...args: T) => {
      raw.exec("BEGIN");
      try {
        fn(...args);
        raw.exec("COMMIT");
      } catch (e) {
        raw.exec("ROLLBACK");
        throw e;
      }
    };
  },
};

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT UNIQUE NOT NULL,
  name TEXT,
  age INTEGER,
  gender TEXT,              -- 'woman' | 'man' | 'nonbinary'
  city TEXT,
  bio TEXT,
  interests TEXT DEFAULT '[]',
  intent TEXT DEFAULT 'friends',   -- 'friends' | 'dating' | 'chat'
  show_me TEXT DEFAULT 'everyone', -- who I want to see for dating: 'everyone' | 'women' | 'men'
  women_only INTEGER DEFAULT 0,    -- only women can see me / I only see women
  hidden INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS trips (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mode TEXT NOT NULL,       -- 'train' | 'flight' | 'bus' | 'metro'
  number TEXT NOT NULL,
  date TEXT NOT NULL,       -- YYYY-MM-DD
  coach TEXT,
  intent TEXT NOT NULL DEFAULT 'friends',
  from_place TEXT,
  to_place TEXT,
  trip_key TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_trips_key ON trips(trip_key);
CREATE TABLE IF NOT EXISTS waves (
  from_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  trip_key TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (from_id, to_id, trip_key)
);
CREATE TABLE IF NOT EXISTS matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  a_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  b_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  trip_key TEXT NOT NULL,
  a_meet INTEGER DEFAULT 0,
  b_meet INTEGER DEFAULT 0,
  closed INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (a_id, b_id, trip_key)
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT DEFAULT 'text', -- 'text' | 'game' | 'system'
  body TEXT NOT NULL,
  uuid TEXT UNIQUE,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS games (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  creator_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  prompt TEXT NOT NULL,
  answers TEXT DEFAULT '{}',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS blocks (
  blocker_id INTEGER NOT NULL,
  blocked_id INTEGER NOT NULL,
  PRIMARY KEY (blocker_id, blocked_id)
);
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reporter_id INTEGER NOT NULL,
  reported_id INTEGER NOT NULL,
  reason TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS device_keys (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pubkey TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, pubkey)
);
-- Group rooms: one per journey, one per coach, a women only room, and topic rooms.
CREATE TABLE IF NOT EXISTS rooms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trip_key TEXT NOT NULL,
  kind TEXT NOT NULL,        -- 'train' | 'coach' | 'women' | 'topic'
  coach TEXT,
  name TEXT NOT NULL,
  created_by INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_rooms_fixed ON rooms(trip_key, kind, coach) WHERE kind <> 'topic';
CREATE TABLE IF NOT EXISTS room_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid TEXT UNIQUE NOT NULL,
  room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  client_ts INTEGER NOT NULL,
  sig TEXT NOT NULL,
  sender_name TEXT NOT NULL,
  relayed_by INTEGER,
  hidden INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_room_msgs ON room_messages(room_id, id);
CREATE TABLE IF NOT EXISTS message_reports (
  message_uuid TEXT NOT NULL,
  reporter_id INTEGER NOT NULL,
  reason TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (message_uuid, reporter_id)
);
-- Crowd sourced signal map: where the network drops on each route.
CREATE TABLE IF NOT EXISTS signal_samples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  route TEXT NOT NULL,       -- mode|number, same across dates
  date TEXT NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  online INTEGER NOT NULL,
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_signal_route ON signal_samples(route, ts);
CREATE TABLE IF NOT EXISTS otps (
  phone TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
`);

export type UserRow = {
  id: number;
  phone: string;
  name: string | null;
  age: number | null;
  gender: string | null;
  city: string | null;
  bio: string | null;
  interests: string;
  intent: string;
  show_me: string;
  women_only: number;
  hidden: number;
};

export type TripRow = {
  id: number;
  user_id: number;
  mode: string;
  number: string;
  date: string;
  coach: string | null;
  intent: string;
  from_place: string | null;
  to_place: string | null;
  trip_key: string;
};

export function publicUser(u: UserRow) {
  return {
    id: u.id,
    name: u.name,
    age: u.age,
    gender: u.gender,
    city: u.city,
    bio: u.bio,
    interests: JSON.parse(u.interests || "[]") as string[],
    intent: u.intent,
  };
}

export function selfUser(u: UserRow) {
  return {
    ...publicUser(u),
    phone: u.phone,
    showMe: u.show_me,
    womenOnly: !!u.women_only,
    hidden: !!u.hidden,
    complete: !!(u.name && u.age && u.gender),
  };
}

export function tripKey(mode: string, number: string, date: string) {
  return `${mode}|${number.toUpperCase().replace(/[^A-Z0-9]/g, "")}|${date}`;
}

export function isBlocked(a: number, b: number) {
  return !!db
    .prepare(
      "SELECT 1 FROM blocks WHERE (blocker_id=? AND blocked_id=?) OR (blocker_id=? AND blocked_id=?)"
    )
    .get(a, b, b, a);
}

// Small migration for databases created by the first version.
try {
  db.exec("ALTER TABLE messages ADD COLUMN uuid TEXT");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_uuid ON messages(uuid)");
} catch {
  /* column already exists */
}

export function routeOf(tripKey: string) {
  const [mode, number] = tripKey.split("|");
  return `${mode}|${number}`;
}
