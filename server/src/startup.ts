// Prints what the server is about to use (never secret values) and makes any
// crash print a clear message instead of exiting silently.
const has = (k: string) => (process.env[k] ? "set" : "MISSING");
console.log(
  `Starting YoFellow: Node ${process.version}, NODE_ENV=${process.env.NODE_ENV || "development"}, ` +
    `DATABASE_URL ${has("DATABASE_URL")}, JWT_SECRET ${has("JWT_SECRET")}, FIREBASE_PROJECT_ID ${has("FIREBASE_PROJECT_ID")}`
);

process.on("uncaughtException", (e) => {
  console.error("Fatal error:", e?.message || e);
  process.exit(1);
});
process.on("unhandledRejection", (e) => {
  console.error("Fatal error:", (e as Error)?.message || e);
  process.exit(1);
});
