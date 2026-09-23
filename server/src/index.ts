import express from "express";
import cors from "cors";
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { api } from "./routes.js";
import { initRealtime } from "./realtime.js";
import "./rooms.js";
import { startRadioHub } from "./radio.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "100kb" }));
app.get("/health", (_req, res) => res.json({ ok: true }));
app.use("/api", api);

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
server.listen(PORT, () => console.log(`YoFellow API on http://localhost:${PORT}`));
