import "dotenv/config";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { closeDatabasePool, queryRows, queryOne, withTransaction } from "../src/lib/db.ts";
import { lockCarInventory } from "../src/lib/inventory-queries.ts";
import { applyMigrations } from "./db-migrations.mjs";

const url = new URL(process.env.DATABASE_URL);
assert.ok(["localhost", "127.0.0.1"].includes(url.hostname),
  "Use the deployment backup procedure for a remote database");
const snapshots = {
  cars: "SELECT to_jsonb(c) AS data FROM cars c ORDER BY id",
  bookings: "SELECT to_jsonb(b) AS data FROM bookings b ORDER BY id",
};
try {
  const result = await withTransaction(async (tx) => {
    await lockCarInventory(tx);
    await tx.query("LOCK TABLE cars, bookings IN SHARE MODE");
    const cars = await queryRows(tx, snapshots.cars);
    const bookings = await queryRows(tx, snapshots.bookings);
    mkdirSync("backups", { recursive: true });
    const backup = "backups/cars-" + new Date().toISOString().replaceAll(/[:.]/g, "-") + ".json";
    writeFileSync(backup, JSON.stringify({ createdAt: new Date().toISOString(), cars, bookings }, null, 2), { flag: "wx" });
    console.log("Saved " + cars.length + " cars and " + bookings.length + " bookings to " + backup);

    const migrations = await applyMigrations(tx);
    for (const [table, before] of Object.entries({ cars, bookings })) {
      const after = await queryRows(tx, snapshots[table]);
      assert.equal(after.length, before.length, table + " row count changed");
      for (const [index, { data }] of before.entries()) {
        for (const [key, value] of Object.entries(data)) {
          if (table === "cars" && key === "imageUrl" && !(key in after[index].data)) continue;
          assert.deepEqual(after[index].data[key], value, table + "/" + data.id + ": " + key + " changed");
        }
      }
    }
    const counts = await queryOne(tx, `SELECT
      (SELECT count(*)::integer FROM car_models) AS models,
      (SELECT count(*)::integer FROM car_model_locations) AS offers,
      count(*) FILTER (WHERE "carModelLocationId" IS NOT NULL)::integer AS "assignedCars",
      count(*) FILTER (WHERE "carModelLocationId" IS NULL)::integer AS "unassignedCars"
      FROM cars`);
    return { ...migrations, counts };
  }, { timeoutMs: 300_000 });
  console.log("Verified all retained car and booking fields are unchanged.");
  console.log(result);
} finally {
  await closeDatabasePool();
}
