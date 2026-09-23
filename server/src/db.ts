// Postgres everywhere.
//  - Production: a real Postgres server (Neon) via DATABASE_URL.
//  - Local dev: PGlite, real Postgres compiled to WebAssembly running inside Node.
//    Zero setup, nothing to install or compile, data kept in server/.pgdata.
// Queries use ? placeholders; they are converted to $1, $2 ... for Postgres.
import path from "node:path";
import pg from "pg";
import { PGlite } from "@electric-sql/pglite";

type Param = null | number | string | boolean;
type Result = { rows: any[]; rowCount: number };
type Driver = { query: (sql: string, params: Param[]) => Promise<Result>; exec: (sql: string) => Promise<void>; close: () => Promise<void> };

const INT8 = 20; // COUNT(*) and BIGINT columns: return JS numbers, not strings
export const usingExternalPostgres = !!process.env.DATABASE_URL;

function makeDriver(): Driver {
  if (process.env.DATABASE_URL) {
    pg.types.setTypeParser(INT8, (v) => Number(v));
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: Number(process.env.PG_POOL_MAX) || 10 });
    return {
      query: async (sql, params) => {
        const r = await pool.query(sql, params);
        return { rows: r.rows, rowCount: r.rowCount ?? 0 };
      },
      exec: async (sql) => {
        await pool.query(sql);
      },
      close: () => pool.end(),
    };
  }
  const dir = process.env.PGLITE_DIR || path.join(process.cwd(), ".pgdata");
  const lite = new PGlite(dir, { parsers: { [INT8]: (v: string) => Number(v) } });
  return {
    query: async (sql, params) => {
      const r = await lite.query(sql, params);
      return { rows: r.rows as any[], rowCount: r.affectedRows ?? r.rows.length };
    },
    exec: async (sql) => {
      await lite.exec(sql);
    },
    close: () => lite.close(),
  };
}

const driver = makeDriver();

/** ? -> $1..$n, skipping text inside single quotes. */
function toPg(sql: string) {
  let n = 0;
  let inStr = false;
  let out = "";
  for (const ch of sql) {
    if (ch === "'") inStr = !inStr;
    out += ch === "?" && !inStr ? `$${++n}` : ch;
  }
  return out;
}

type Stmt = {
  get: <T = any>(...args: Param[]) => Promise<T | undefined>;
  all: <T = any>(...args: Param[]) => Promise<T[]>;
  run: (...args: Param[]) => Promise<{ changes: number }>;
};

export const db = {
  prepare(sql: string): Stmt {
    const text = toPg(sql);
    return {
      get: async (...a) => (await driver.query(text, a)).rows[0],
      all: async (...a) => (await driver.query(text, a)).rows,
      run: async (...a) => ({ changes: (await driver.query(text, a)).rowCount }),
    };
  },
  exec: (sql: string) => driver.exec(sql),
  close: () => driver.close(),
  /** Insert many rows in one statement. */
  async insertMany(table: string, cols: string[], rows: Param[][]) {
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const params: Param[] = [];
      const values = chunk.map((r) => `(${r.map((v) => (params.push(v), `$${params.length}`)).join(",")})`).join(",");
      await driver.query(`INSERT INTO ${table} (${cols.join(",")}) VALUES ${values}`, params);
    }
  },
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  phone TEXT UNIQUE NOT NULL,
  name TEXT,
  age INTEGER,
  gender TEXT,                     -- 'woman' | 'man' | 'nonbinary'
  city TEXT,
  bio TEXT,
  interests TEXT DEFAULT '[]',
  intent TEXT DEFAULT 'friends',   -- 'friends' | 'dating' | 'chat'
  show_me TEXT DEFAULT 'everyone', -- who I want to see for dating
  women_only INTEGER DEFAULT 0,
  hidden INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS trips (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mode TEXT NOT NULL,              -- 'train' | 'flight' | 'bus' | 'metro'
  number TEXT NOT NULL,
  date TEXT NOT NULL,              -- YYYY-MM-DD
  coach TEXT,
  intent TEXT NOT NULL DEFAULT 'friends',
  from_place TEXT,
  to_place TEXT,
  trip_key TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_trips_key ON trips(trip_key);
CREATE INDEX IF NOT EXISTS idx_trips_user ON trips(user_id);
CREATE TABLE IF NOT EXISTS waves (
  from_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  trip_key TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (from_id, to_id, trip_key)
);
CREATE TABLE IF NOT EXISTS matches (
  id SERIAL PRIMARY KEY,
  a_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  b_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  trip_key TEXT NOT NULL,
  a_meet INTEGER DEFAULT 0,
  b_meet INTEGER DEFAULT 0,
  closed INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (a_id, b_id, trip_key)
);
CREATE TABLE IF NOT EXISTS messages (
  id SERIAL PRIMARY KEY,
  match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT DEFAULT 'text',        -- 'text' | 'game' | 'system'
  body TEXT NOT NULL,
  uuid TEXT UNIQUE,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_messages_match ON messages(match_id, id);
CREATE TABLE IF NOT EXISTS games (
  id SERIAL PRIMARY KEY,
  match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  creator_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  prompt TEXT NOT NULL,
  answers TEXT DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS blocks (
  blocker_id INTEGER NOT NULL,
  blocked_id INTEGER NOT NULL,
  PRIMARY KEY (blocker_id, blocked_id)
);
CREATE TABLE IF NOT EXISTS reports (
  id SERIAL PRIMARY KEY,
  reporter_id INTEGER NOT NULL,
  reported_id INTEGER NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS device_keys (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pubkey TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (user_id, pubkey)
);
-- Group rooms: one per journey, one per coach, a women only room, and topic rooms.
CREATE TABLE IF NOT EXISTS rooms (
  id SERIAL PRIMARY KEY,
  trip_key TEXT NOT NULL,
  kind TEXT NOT NULL,              -- 'train' | 'coach' | 'women' | 'topic'
  coach TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  created_by INTEGER,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_rooms_fixed ON rooms(trip_key, kind, coach) WHERE kind <> 'topic';
CREATE TABLE IF NOT EXISTS room_messages (
  id SERIAL PRIMARY KEY,
  uuid TEXT UNIQUE NOT NULL,
  room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  client_ts BIGINT NOT NULL,
  sig TEXT NOT NULL,
  sender_name TEXT NOT NULL,
  relayed_by INTEGER,
  hidden INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_room_msgs ON room_messages(room_id, id);
CREATE TABLE IF NOT EXISTS message_reports (
  message_uuid TEXT NOT NULL,
  reporter_id INTEGER NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (message_uuid, reporter_id)
);
-- Crowd sourced signal map: where the network drops on each route.
CREATE TABLE IF NOT EXISTS signal_samples (
  id SERIAL PRIMARY KEY,
  user_id INTEGER,
  route TEXT NOT NULL,             -- mode|number, same across dates
  date TEXT NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  online INTEGER NOT NULL,
  ts BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_signal_route ON signal_samples(route, ts);
CREATE TABLE IF NOT EXISTS otps (
  phone TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  expires_at BIGINT NOT NULL
);
-- Server signing key: vouches for device keys so phones can trust them offline.
CREATE TABLE IF NOT EXISTS server_keys (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  secret TEXT NOT NULL,
  pubkey TEXT NOT NULL
);
-- Dev only: keys for demo travellers so they can sign group messages.
CREATE TABLE IF NOT EXISTS demo_keys (
  user_id INTEGER PRIMARY KEY,
  secret TEXT NOT NULL,
  pubkey TEXT NOT NULL
);
`;

let ready: Promise<void> | null = null;
/** Create tables if needed. Safe to call many times. */
export function initDb() {
  ready ??= driver.exec(SCHEMA);
  return ready;
}

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

export async function isBlocked(a: number, b: number) {
  return !!(await db
    .prepare("SELECT 1 FROM blocks WHERE (blocker_id=? AND blocked_id=?) OR (blocker_id=? AND blocked_id=?)")
    .get(a, b, b, a));
}

export function routeOf(tripKey: string) {
  const [mode, number] = tripKey.split("|");
  return `${mode}|${number}`;
}
