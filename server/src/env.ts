// Loads server/.env if it exists (local dev only; on Render the values come from the dashboard).
// Imported first in index.ts and seed.ts, so the values are there before anything reads them.
import fs from "node:fs";
import path from "node:path";

const file = path.join(process.cwd(), ".env");
if (fs.existsSync(file)) {
  process.loadEnvFile(file); // built into Node 22, no extra package
  console.log("Loaded settings from server/.env");
}
