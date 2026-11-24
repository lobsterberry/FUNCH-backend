import "dotenv/config";
import {
  DatabaseError,
  Pool,
  escapeIdentifier,
  types,
  type PoolClient,
  type QueryResultRow,
} from "pg";

let pool: Pool | undefined;

export function createDatabasePool(connectionString: string): Pool {
  const url = new URL(connectionString);
  const schema = url.searchParams.get("schema") || "public";
  url.searchParams.delete("schema");

  const db = new Pool({
    connectionString: url.toString(),
    connectionTimeoutMillis: 10_000,
    allowExitOnIdle: true,
    types: {
      getTypeParser(oid, format) {
        if (!format || format === "text") {
          if (oid === types.builtins.TIMESTAMP) {
            return (value: string) => new Date(value.replace(" ", "T") + "Z");
          }
          if (oid === types.builtins.NUMERIC) {
            return (value: string) => value.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
          }
        }
        return types.getTypeParser(oid, format ?? "text");
      },
    },
    async onConnect(client) {
      await client.query("SELECT set_config('search_path', $1, false)", [
        escapeIdentifier(schema),
      ]);
      await client.query("SET TIME ZONE 'UTC'");
    },
  });
  db.on("error", (error) => console.error("PostgreSQL pool error", error));
  return db;
}

export function databasePool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL is required");
    pool = createDatabasePool(connectionString);
  }
  return pool;
}

export async function closeDatabasePool() {
  const db = pool;
  pool = undefined;
  await db?.end();
}

export type Database = Pool | PoolClient;

export async function queryRows<Row extends QueryResultRow>(
  db: Database,
  sql: string,
  values: readonly unknown[] = [],
) {
  const { rows } = await db.query<Row>(
    sql,
    values.map((value) => value instanceof Date ? value.toISOString() : value),
  );
  return rows;
}

export async function queryOne<Row extends QueryResultRow>(
  db: Database,
  sql: string,
  values?: readonly unknown[],
): Promise<Row | null> {
  return (await queryRows<Row>(db, sql, values))[0] ?? null;
}

export function required<Row>(row: Row | null): Row {
  if (row === null) throw new Error("Expected database row");
  return row;
}

export function isUniqueViolation(error: unknown, constraint?: string) {
  return error instanceof DatabaseError && error.code === "23505" &&
    (constraint === undefined || error.constraint === constraint);
}

export async function withTransaction<T>(
  operation: (client: PoolClient) => Promise<T>,
  { db = databasePool(), repeatableRead = false, timeoutMs = 5_000 } = {},
): Promise<T> {
  const client = await db.connect();
  let reusable = false;
  try {
    await client.query(repeatableRead ? "BEGIN ISOLATION LEVEL REPEATABLE READ" : "BEGIN");
    await client.query(
      "SELECT set_config('statement_timeout', $1, true), set_config('idle_in_transaction_session_timeout', $1, true)",
      [String(timeoutMs)],
    );
    const deadline = performance.now() + timeoutMs;
    const result = await operation(client);
    if (performance.now() >= deadline) throw new Error("Transaction timed out");
    const commit = await client.query("COMMIT");
    if (commit.command !== "COMMIT") throw new Error("Transaction rolled back");
    reusable = true;
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
      reusable = true;
    } catch {
      // A client that cannot roll back should be discarded.
    }
    throw error;
  } finally {
    client.release(!reusable);
  }
}
