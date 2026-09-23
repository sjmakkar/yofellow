import "./env.js"; // must stay first
import "./startup.js"; // logs settings and makes startup errors readable
import express from "express";
import cors from "cors";
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { api } from "./routes.js";
import { initRealtime } from "./realtime.js";
import "./rooms.js";
import { startRadioHub } from "./radio.js";
import { initDb, usingExternalPostgres } from "./db.js";

try {
  await initDb();
} catch (e) {
  const msg = (e as Error).message || String(e);
  console.error("\nCould not connect to the database: " + msg);
  if (/password authentication|role .* does not exist/i.test(msg)) console.error("Hint: the username or password in DATABASE_URL is wrong. Copy it again from Neon.");
  else if (/ENOTFOUND|getaddrinfo/i.test(msg)) console.error("Hint: the host in DATABASE_URL is wrong. Copy the full string again from Neon.");
  else if (/ssl|SSL/.test(msg)) console.error("Hint: add ?sslmode=require at the end of DATABASE_URL.");
  else if (/timeout|ECONNREFUSED/i.test(msg)) console.error("Hint: the database is not reachable. Check the Neon project is active.");
  process.exit(1);
}
// Local dev: demo travellers and today's demo trips are (re)created on every start.
if (process.env.NODE_ENV !== "production" && process.env.DEMO_BOTS !== "0") {
  const { seedDemo } = await import("./seed.js");
  await seedDemo(() => {});
}

const app = express();
app.set("trust proxy", 1); // behind Render's HTTPS proxy
app.use(cors());
app.use(express.json({ limit: "100kb" }));
app.get("/health", (_req, res) => res.json({ ok: true }));
app.use("/api", api);

// Errors from any route: log them, send a short message (never a stack trace).
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  if (!res.headersSent) res.status(500).json({ error: "Something went wrong on our side. Please try again." });
});

// In production, serve the built React app from ../client/dist
const dist = path.resolve(process.cwd(), "../client/dist");
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^\/(?!api).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

const server = http.createServer(app);
initRealtime(server);

const PORT = Number(process.env.PORT) || 4000;
if (process.env.NODE_ENV !== "production" && process.env.RADIO !== "0" && !process.argv.includes("--no-radio")) startRadioHub();
server.on("error", (e: NodeJS.ErrnoException) => {
  if (e.code === "EADDRINUSE") {
    console.error(`\nPort ${PORT} is already in use. Another YoFellow server is probably still running.`);
    console.error(`Stop it with Ctrl + C in its terminal, or on Windows run:`);
    console.error(`  Stop-Process -Id (Get-NetTCPConnection -LocalPort ${PORT}).OwningProcess -Force\n`);
    process.exit(1);
  }
  throw e;
});
server.listen(PORT, () =>
  console.log(`YoFellow API on http://localhost:${PORT} (database: ${usingExternalPostgres ? "Postgres via DATABASE_URL" : "local PGlite in server/.pgdata"})`)
);
