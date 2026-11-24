import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
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
  SEED_USER_PASSWORD: "CarsTestSeedPassword123!",
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
  const migrations = await readMigrations();
  const split = migrations.findIndex(({ name }) => name === "20261117000000_model_fleet_locations.sql");
  assert.ok(split > 0, "Model/fleet migration is missing");
  await withTransaction(async (tx) => {
    for (const { sql } of migrations.slice(0, split)) await tx.query(sql);
  }, { db });
  await db.query(`INSERT INTO countries (code,name,"nameTh",flag,"currencyCode","drivingSide")
    VALUES ('ZZ','Migration fixture','Migration fixture','ZZ','THB','LEFT')`);
  await db.query(`INSERT INTO locations (id,name,"nameTh",city,"cityTh","countryCode","timeZone")
    VALUES ('legacy-A','A','A','Test','Test','ZZ','UTC'), ('legacy-B','B','B','Test','Test','ZZ','UTC')`);
  await db.query(`INSERT INTO users (id,email,password,name,"updatedAt")
    VALUES ('legacy-user','legacy@migration.example','fixture','Migration',NOW())`);
  for (const [id, location, rate, steering] of [
    ["legacy-1", "legacy-A", 100, "RHD"], ["legacy-2", "legacy-A", 100, "RHD"],
    ["legacy-3", "legacy-B", 200, "RHD"], ["legacy-4", "legacy-B", 100, "LHD"],
    ["legacy-unassigned", null, 100, "RHD"],
  ]) {
    await db.query(`INSERT INTO cars (id,brand,model,year,"licensePlate",country,"hourlyRate",
      "dailyRate","locationId","steeringSide","updatedAt")
      VALUES ($1,'Migration','Same name',2026,$1,'ZZ',$2,1000,$3,$4,NOW())`,
      [id, rate, location, steering]);
  }
  const photo = "https://example.com/legacy-car.jpg";
  await db.query('UPDATE cars SET "imageUrl" = $1 WHERE "locationId" IS NOT NULL', [photo]);
  await db.query(`INSERT INTO bookings (id,"bookingNumber","userId","carId","startDateTime","endDateTime",
    "totalPrice","hourlyRate","dailyRate","pickupLocationId","dropoffLocationId","updatedAt")
    VALUES ('legacy-booking','legacy-number','legacy-user','legacy-1','2030-01-01T09:00:00Z',
      '2030-01-01T17:00:00Z',1234.50,100,1000,'legacy-A','legacy-A',NOW())`);
  await db.query('UPDATE cars SET "isAvailable" = false WHERE id = $1', ["legacy-unassigned"]);
  const before = await row("SELECT to_jsonb(b) AS data FROM bookings b WHERE id = $1", ["legacy-booking"]);
  await db.query('UPDATE cars SET "imageUrl" = $2 WHERE id = $1', ["legacy-unassigned", photo]);
  await assert.rejects(
    withTransaction(applyMigrations, { db }),
    /contains photos that are missing from or differ from the linked model/,
  );
  assert.deepEqual(await row(`SELECT to_regclass('schema_migrations') AS ledger,
    to_regclass('car_models') AS models`), { ledger: null, models: null });
  await db.query('UPDATE cars SET "imageUrl" = NULL WHERE id = $1', ["legacy-unassigned"]);
  const result = await withTransaction(applyMigrations, { db });
  assert.deepEqual(result.baselined, migrations.slice(0, split).map(({ name }) => name));
  assert.deepEqual(result.applied, migrations.slice(split).map(({ name }) => name));
  const after = await row('SELECT to_jsonb(b) AS data, "totalPrice" FROM bookings b WHERE id = $1', ["legacy-booking"]);
  assert.equal(after.data.carId, "legacy-1");
  assert.equal(after.totalPrice, "1234.5");
  for (const [key, value] of Object.entries(before.data)) {
    assert.deepEqual(after.data[key], value, "Historical booking changed: " + key);
  }
  const cars = await rows(`SELECT c.*, o."carModelId", m."imageUrl" FROM cars c
    LEFT JOIN car_model_locations o ON o.id = c."carModelLocationId"
    LEFT JOIN car_models m ON m.id = o."carModelId" WHERE c.country = $1 ORDER BY c.id`, ["ZZ"]);
  assert.equal(cars[0].carModelLocationId, cars[1].carModelLocationId);
  assert.equal(cars[0].carModelId, cars[2].carModelId);
  assert.notEqual(cars[0].carModelLocationId, cars[2].carModelLocationId);
  assert.notEqual(cars[0].carModelId, cars[3].carModelId);
  assert.equal(cars[4].carModelLocationId, null);
  assert.equal(cars[4].operationalStatus, "INACTIVE");
  assert.equal(cars[0].operationalStatus, "AVAILABLE");
  assert.equal(cars[0].exteriorColor, null);
  assert.equal(cars[0].odometerKm, null);
  assert.equal(cars[0].vin, null);
  assert.equal(cars[0].imageUrl, photo);
  assert.deepEqual(await rows(`SELECT column_name FROM information_schema.columns
    WHERE table_schema = $1 AND table_name = 'cars' AND column_name = 'imageUrl'`, [schema]), []);
  console.log("Legacy data, prices and registration history verified.");
}

async function checkSeed() {
  const seed = () => run(["--import", "tsx", "scripts/seed/seed.ts"]);
  const counts = () => row(`SELECT (SELECT count(*) FROM car_models) AS models,
    (SELECT count(*) FROM car_model_locations) AS offers, (SELECT count(*) FROM cars) AS cars`);
  const detailFields = 'id, "exteriorColor", vin, "odometerKm"';
  const readDetails = (id) => row("SELECT " + detailFields + " FROM cars WHERE id = $1", [id]);
  const readSeedUser = () => row('SELECT password, "createdAt", "sessionVersion" FROM users WHERE id = $1',
    ["seed-user-admin"]);
  seed();
  const seededCounts = await counts();
  const seedUser = await readSeedUser();
  assert.ok(await verifyPassword(env.SEED_USER_PASSWORD, seedUser.password));
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
