// Simple in-memory rate limits (fine for a single server instance on Render).
// Stops one person or bot from spamming messages, reports or burning the SMS quota.
import type { Request, Response, NextFunction } from "express";

const hits = new Map<string, number[]>();
// Per IP limits are loose outside production: local tests log in many people from one machine.
const IP_SCALE = process.env.NODE_ENV === "production" ? 1 : 50;

export function limit(name: string, max: number, windowMs: number, by: "ip" | "user" = "user") {
  if (by === "ip") max *= IP_SCALE;
  return (req: Request, res: Response, next: NextFunction) => {
    const who = by === "user" ? (req as any).user?.id ?? req.ip : req.ip;
    const key = `${name}:${who}`;

    const now = Date.now();
    const list = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (list.length >= max) {
      const wait = Math.ceil((windowMs - (now - list[0])) / 1000);
      res.setHeader("Retry-After", String(wait));
      return res.status(429).json({ error: `Too many requests. Please wait ${wait < 90 ? `${wait} seconds` : `${Math.ceil(wait / 60)} minutes`} and try again.` });
    }
    list.push(now);
    hits.set(key, list);
    next();
  };
}

// Forget old entries so memory stays small.
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of hits) if (!v.length || now - v[v.length - 1] > 24 * 3600_000) hits.delete(k);
}, 10 * 60_000).unref();
