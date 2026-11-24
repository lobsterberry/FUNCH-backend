import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { escapeIdentifier } from "pg";
import { createDatabasePool, queryOne, queryRows, required, withTransaction } from "../src/lib/db.ts";
import { applyMigrations, inspectMigrationSchema, readMigrations } from "./db-migrations.mjs";
import { verifyPassword } from "../src/utils/password.ts";

const schema = "cars_test_" + randomUUID().replaceAll("-", "");
const legacy = process.argv.includes("--legacy");

const url = new URL(process.env.DATABASE_URL);
assert.ok(["localhost", "127.0.0.1"].includes(url.hostname),
  "This runner only creates test schemas on local PostgreSQL");
url.searchParams.set("schema", schema);
const testUrl = url.toString();
const env = {
  ...process.env,
  DATABASE_URL: testUrl,
  AUTH_TEST_DATABASE_URL: testUrl,
  NODE_ENV: "test",
  SEED_USER_PASSWORD: "",
};
const serverUrl = new URL(url);
serverUrl.searchParams.delete("schema");
const admin = createDatabasePool(serverUrl.href);
const db = createDatabasePool(testUrl);
const identifier = escapeIdentifier(schema);
let createdSchema = false;

function run(args) {
  const result = spawnSync(process.execPath, args, { env, stdio: "inherit" });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, "Command failed: " + args.join(" "));
}
const rows = (sql, parameters) => queryRows(db, sql, parameters);
const row = async (sql, parameters) => required(await queryOne(db, sql, parameters));

async function legacyRehearsal() {
  const [initial, ...pending] = await readMigrations();
  const { previousHistory } = JSON.parse(readFileSync(new URL("../db/baseline-signatures.json", import.meta.url), "utf8"));
  const previousEntries = Object.entries(previousHistory).sort(([a], [b]) => a.localeCompare(b));
  await withTransaction(async (tx) => {
    await tx.query(initial.sql);
    await tx.query(`CREATE TABLE schema_migrations (
      name text PRIMARY KEY,
      checksum text NOT NULL,
      "appliedAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    for (const entry of previousEntries.slice(0, -1)) {
      await tx.query("INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)", entry);
    }
  }, { db });
  await db.query(`INSERT INTO countries (code,name,"nameTh",flag,"currencyCode","drivingSide")
    VALUES ('ZZ','Migration fixture','Migration fixture','ZZ','THB','LEFT')`);
  await db.query(`INSERT INTO cars (id,brand,model,year,"licensePlate",country,"hourlyRate","dailyRate","updatedAt")
    VALUES ('legacy-1','Migration','Fixture',2026,'legacy-1','ZZ',100,1000,NOW())`);
  const readCar = () => row("SELECT * FROM cars WHERE id = $1", ["legacy-1"]);
  const readHistory = () => rows("SELECT name, checksum FROM schema_migrations ORDER BY name");
  const car = await readCar();
  const partialHistory = await readHistory();

  await assert.rejects(withTransaction(applyMigrations, { db }), /does not match the complete chain/);
  assert.deepEqual(await readHistory(), partialHistory);
  assert.deepEqual(await readCar(), car);

  await db.query("INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)", previousEntries.at(-1));
  const result = await withTransaction(applyMigrations, { db });
  assert.deepEqual(result.baselined, [initial.name]);
  assert.deepEqual(result.applied, pending.map(({ name }) => name));
  assert.deepEqual(await readHistory(), [initial, ...pending].map(({ name, checksum }) => ({ name, checksum })));
  assert.deepEqual(await readCar(), car);
  console.log("Previous migration history adopted with existing car data intact.");
}

async function checkSeed() {
  const seed = () => run(["--import", "tsx", "scripts/seed/seed.ts"]);
  const counts = () => row(`SELECT (SELECT count(*) FROM car_models) AS models,
    (SELECT count(*) FROM car_model_locations) AS offers, (SELECT count(*) FROM cars) AS cars`);
  const detailFields = 'id, "exteriorColor", vin, "odometerKm"';
  const readDetails = (id) => row("SELECT " + detailFields + " FROM cars WHERE id = $1", [id]);
  const readSeedUser = () => row('SELECT email, role, password, "createdAt", "sessionVersion" FROM users WHERE id = $1',
    ["seed-user-admin"]);
  seed();
  const seededCounts = await counts();
  const seedUser = await readSeedUser();
  assert.equal(seedUser.email, "admin@funch.example");
  assert.equal(seedUser.role, "ADMIN");
  assert.ok(await verifyPassword("FunchDemo2026!", seedUser.password));
  const seedMember = await row("SELECT password FROM users WHERE id = $1", ["seed-user-somchai"]);
  assert.ok(!(await verifyPassword("FunchDemo2026!", seedMember.password)));
  assert.equal(seedUser.createdAt.toISOString(), "2026-09-01T00:00:00.000Z");
  await db.query('UPDATE users SET "sessionVersion" = $1 WHERE id = $2', [3, "seed-user-admin"]);
  const demoCars = await rows("SELECT " + detailFields + " FROM cars WHERE starts_with(id, $1)", ["seed-car-"]);
  assert.equal(demoCars.length, 134);
  assert.equal(new Set(demoCars.map(({ vin }) => vin)).size, demoCars.length);
  for (const car of demoCars) {
    assert.ok(car.exteriorColor);
    assert.match(car.vin, /^FUNCH[0-9A-F]{12}$/);
    assert.ok(Number.isInteger(car.odometerKm) && car.odometerKm > 0);
  }
  const base = demoCars.find(({ id }) => id === "seed-car-tokyo-harrier");
  const expanded = demoCars.find(({ id }) => id === "seed-car-tokyo-harrier-fleet-1-1");
  await db.query('UPDATE cars SET "exteriorColor" = $2, vin = NULL, "odometerKm" = 0 WHERE id = $1',
    [base.id, "สีที่แก้ไข"]);
  await db.query('UPDATE cars SET "exteriorColor" = NULL, vin = $2, "odometerKm" = 12345 WHERE id = $1',
    [expanded.id, "EDITED-VIN"]);
  seed();
  assert.deepEqual(await counts(), seededCounts, "Seed must be idempotent");
  const reseededUser = await readSeedUser();
  assert.ok(reseededUser.password === seedUser.password, "Seed must retain the stored password hash");
  assert.deepEqual(reseededUser.createdAt, seedUser.createdAt);
  assert.equal(reseededUser.sessionVersion, 3);
  assert.deepEqual(await readDetails(base.id), { ...base, exteriorColor: "สีที่แก้ไข", odometerKm: 0 });
  assert.deepEqual(await readDetails(expanded.id), { ...expanded, vin: "EDITED-VIN", odometerKm: 12345 });
  if (legacy) {
    assert.deepEqual(await readDetails("legacy-1"), {
      id: "legacy-1", exteriorColor: null, vin: null, odometerKm: null,
    });
  }
  const undersizedModels = await rows(`SELECT DISTINCT o."carModelId" FROM cars c
    JOIN car_model_locations o ON o.id = c."carModelLocationId"
    WHERE starts_with(c.id, $1) AND c.id NOT LIKE $2 AND 3 > (
      SELECT count(*) FROM cars unit
      JOIN car_model_locations offer ON offer.id = unit."carModelLocationId"
      WHERE offer."carModelId" = o."carModelId"
    )`, ["seed-car-", "%-fleet-%"]);
  assert.deepEqual(undersizedModels, [], "Each seeded model must have several physical cars");
  const undersizedLocations = await rows(`SELECT l.id FROM locations l WHERE starts_with(l.id, $1)
    AND 2 > (SELECT count(*) FROM cars c WHERE c."locationId" = l.id)`, ["seed-location-"]);
  assert.deepEqual(undersizedLocations, [], "Each seeded location must hold several cars");
  const edited = await row("SELECT id FROM cars WHERE id LIKE $1 ORDER BY id LIMIT 1", ["%-fleet-%"]);
  await db.query('UPDATE cars SET "licensePlate" = $2, "isAvailable" = false WHERE id = $1',
    [edited.id, "EDITED-DEMO-REGISTRATION"]);
  const before = await row("SELECT * FROM cars WHERE id = $1", [edited.id]);
  const missingId = "seed-car-tokyo-harrier-fleet-1-2";
  const missingDetails = await readDetails(missingId);
  assert.notEqual(edited.id, missingId);
  await db.query("DELETE FROM cars WHERE id = $1", [missingId]);
  run(["--import", "tsx", "scripts/seed-cars.ts"]);
  assert.deepEqual(await readDetails(missingId), missingDetails, "Additive seed must recreate missing demo cars");
  assert.deepEqual(await row("SELECT * FROM cars WHERE id = $1", [edited.id]), before,
    "Additive car seeding must retain edits");
}

try {
  await admin.query("CREATE SCHEMA " + identifier);
  createdSchema = true;
  if (legacy) {
    await legacyRehearsal();
  } else {
    run(["--import", "tsx", "scripts/migrate-db.mjs"]);
    const signature = await inspectMigrationSchema(db);
    // Rehearse adoption of a final schema provisioned with the previous setup command.
    await db.query("DROP TABLE schema_migrations");
    await db.query("ALTER TABLE cars DROP CONSTRAINT cars_odometer_nonnegative");
    const adoption = await withTransaction(applyMigrations, { db });
    assert.equal(adoption.baselined.length, (await readMigrations()).length);
    assert.deepEqual(adoption.applied, []);
    assert.equal(await inspectMigrationSchema(db), signature);
  }
  assert.deepEqual(await withTransaction(applyMigrations, { db }), { applied: [], baselined: [] });
  await checkSeed();
  run(["--import", "tsx", "--test", "--test-concurrency=1",
    ...readdirSync("tests").filter((name) => name.endsWith(".test.ts")).map((name) => "tests/" + name)]);
} finally {
  try {
    await db.end();
    if (createdSchema) await admin.query("DROP SCHEMA " + identifier + " CASCADE");
  } finally {
    await admin.end();
  }
}
