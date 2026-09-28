// Product analytics stored in our own database: which features people use,
// never message contents. Used for the admin dashboard during the pilot.
import { db } from "./db.js";

export function track(userId: number | null, name: string, props?: Record<string, unknown>) {
  db.prepare("INSERT INTO events (user_id, name, props) VALUES (?,?,?)")
    .run(userId, name, props ? JSON.stringify(props) : null)
    .catch((e) => console.error("track failed", e.message));
}
