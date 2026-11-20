import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { lockCarInventory } from "../src/lib/inventory-queries.ts";
import { queryRows } from "../src/lib/db.ts";

const migrationsDir = new URL("../db/migrations/", import.meta.url);
const baselineFile = new URL("../db/baseline-signatures.json", import.meta.url);
const managedTables = [
  "countries", "locations", "users", "cars", "car_models", "car_model_locations",
  "car_movements", "bookings",
];
const managedEnums = [
  "Role", "BookingStatus", "DrivingSide", "SteeringSide", "CarCategory",
  "TransmissionType", "BookingSource", "VehicleStatus",
];

const checksum = (value) => createHash("sha256").update(value).digest("hex");

export async function readMigrations() {
  const names = (await readdir(migrationsDir))
    .filter((name) => /^\d{14}_[a-z0-9_]+\.sql$/.test(name))
    .sort();
  if (!names.length) throw new Error("No SQL migrations found");
  return Promise.all(names.map(async (name) => {
    const sql = (await readFile(new URL(name, migrationsDir), "utf8")).replaceAll("\r\n", "\n");
    return { name, sql, checksum: checksum(sql) };
  }));
}

export async function inspectMigrationSchema(tx) {
  const objects = await queryRows(tx, `
    WITH managed AS (
      SELECT c.oid, c.relname, c.relkind
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = current_schema() AND c.relname = ANY($1::text[])
    )
    SELECT 'relation' AS kind, m.relname AS name, m.relname AS parent,
      to_jsonb(m.relkind) AS definition FROM managed m
    UNION ALL
    SELECT 'column', a.attname, m.relname,
      jsonb_build_array(format_type(a.atttypid, a.atttypmod), a.attnotnull,
        pg_get_expr(d.adbin, d.adrelid), a.attidentity, a.attgenerated)
    FROM managed m JOIN pg_attribute a ON a.attrelid = m.oid
    LEFT JOIN pg_attrdef d ON d.adrelid = m.oid AND d.adnum = a.attnum
    WHERE a.attnum > 0 AND NOT a.attisdropped
    UNION ALL
    SELECT 'constraint', c.conname, m.relname,
      jsonb_build_array(pg_get_constraintdef(c.oid), c.convalidated)
    FROM managed m JOIN pg_constraint c ON c.conrelid = m.oid
    -- The odometer check was optional in existing deployments.
    WHERE NOT (m.relname = 'cars' AND c.conname = 'cars_odometer_nonnegative')
    UNION ALL
    SELECT 'index', idx.relname, m.relname,
      jsonb_build_array(am.amname, i.indisunique, i.indisprimary, i.indisvalid, i.indnullsnotdistinct,
        pg_get_expr(i.indpred, i.indrelid), ARRAY(SELECT pg_get_indexdef(i.indexrelid, k, true)
          FROM generate_series(1, i.indnatts) k ORDER BY k))
    FROM managed m JOIN pg_index i ON i.indrelid = m.oid
    JOIN pg_class idx ON idx.oid = i.indexrelid JOIN pg_am am ON am.oid = idx.relam
    UNION ALL
    SELECT 'enum', t.typname, t.typname, jsonb_agg(e.enumlabel ORDER BY e.enumsortorder)
    FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE n.nspname = current_schema() AND t.typname = ANY($2::text[])
    GROUP BY t.typname`, [managedTables, managedEnums]);
  return objects.length ? checksum(objects.map((object) => JSON.stringify(object)).sort().join("\n")) : null;
}

// The caller owns the transaction so schema changes and the ledger commit together.
export async function applyMigrations(tx) {
  const migrations = await readMigrations();
  await lockCarInventory(tx);
  await tx.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY,
    checksum text NOT NULL,
    "appliedAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  const history = await queryRows(tx, "SELECT name, checksum FROM schema_migrations ORDER BY name");
  for (const [index, entry] of history.entries()) {
    const expected = migrations[index];
    if (entry.name !== expected?.name || entry.checksum !== expected.checksum) {
      throw new Error("SQL migration history does not match the checked-in files at " + entry.name);
    }
  }
  const record = (migration) => tx.query(
    "INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)",
    [migration.name, migration.checksum],
  );
  const baselined = [];
  if (!history.length) {
    const signature = await inspectMigrationSchema(tx);
    if (signature) {
      const signatures = JSON.parse(await readFile(baselineFile, "utf8"));
      const version = signatures[signature];
      const index = migrations.findIndex(({ name }) => name === version);
      if (index === -1) {
        throw new Error("Existing database structure does not match a known migration. Inspect its schema before upgrading.");
      }
      for (const migration of migrations.slice(0, index + 1)) {
        await record(migration);
        baselined.push(migration.name);
      }
    }
  }
  const applied = [];
  for (const migration of migrations.slice(history.length + baselined.length)) {
    await tx.query(migration.sql);
    await record(migration);
    applied.push(migration.name);
  }
  return { applied, baselined };
}
