import { closeDatabasePool, withTransaction } from "../src/lib/db.ts";
import { applyMigrations } from "./db-migrations.mjs";

try {
  const { applied, baselined } = await withTransaction(applyMigrations, { timeoutMs: 300_000 });
  if (baselined.length) console.log("Recorded existing SQL migrations:", baselined);
  if (applied.length) console.log("Applied SQL migrations:", applied);
  else console.log("Database schema is up to date.");
} catch (error) {
  console.error("Database migration failed:", error.message);
  process.exitCode = 1;
} finally {
  await closeDatabasePool();
}
