import fs from "node:fs";
import path from "node:path";
import type { PgDatabase } from "drizzle-orm/pg-core";
import * as schema from "./schema";

export type Db = PgDatabase<never, typeof schema>;

const MIGRATIONS_DIR = path.join(process.cwd(), "drizzle");

interface RuntimeState {
  ready: Promise<Db> | null;
  close: (() => Promise<void>) | null;
}

const globalScope = globalThis as unknown as { __floodguardDb?: RuntimeState };

function state(): RuntimeState {
  globalScope.__floodguardDb ??= { ready: null, close: null };
  return globalScope.__floodguardDb;
}

export function driverName(): "pglite" | "postgres" {
  const url = process.env.DATABASE_URL?.trim();
  const configured = process.env.DB_DRIVER?.trim().toLowerCase();
  if (configured === "postgres") return "postgres";
  if (configured === "pglite") return "pglite";
  return url ? "postgres" : "pglite";
}

export function pgDataDir(): string {
  return (
    process.env.PGLITE_DATA_DIR?.trim() ||
    path.join(process.cwd(), "data", "pglite")
  );
}

/**
 * Applies every `drizzle/*.sql` migration not yet recorded, in filename order.
 * Idempotent, so it is safe to run on first database access.
 */
async function applyMigrations(db: Db): Promise<void> {
  const applied = new Set(await readAppliedMigrations(db));

  if (!fs.existsSync(MIGRATIONS_DIR)) {
    throw new Error(
      `Migration directory not found at ${MIGRATIONS_DIR}. Run \`npm run db:generate\`.`,
    );
  }

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    for (const statement of splitSql(sql)) {
      await db.execute(statement);
    }
    await db.execute(
      `INSERT INTO "__floodguard_migrations" (name) VALUES ('${file.replace(/'/g, "''")}')`,
    );
  }
}

/** Names of the migrations already recorded, oldest first. Creates the ledger on first call. */
async function readAppliedMigrations(db: Db): Promise<string[]> {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS "__floodguard_migrations" (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  const rows = (await db.execute(
    `SELECT name FROM "__floodguard_migrations" ORDER BY name`,
  )) as unknown;
  return migrationNames(rows);
}

/** `execute()` returns a driver result object for pg and a row array for PGlite. */
function migrationNames(rows: unknown): string[] {
  if (Array.isArray(rows)) {
    return rows
      .map((r) => (r as { name?: string }).name)
      .filter((n): n is string => typeof n === "string");
  }
  const inner = (rows as { rows?: unknown })?.rows;
  if (Array.isArray(inner)) {
    return inner
      .map((r) => (r as { name?: string }).name)
      .filter((n): n is string => typeof n === "string");
  }
  return [];
}

/** Split on `--> statement-breakpoint`, dropping comment-only lines. */
function splitSql(sql: string): string[] {
  return sql
    .split(/--> statement-breakpoint/g)
    .map((chunk) =>
      chunk
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n")
        .trim(),
    )
    .filter((chunk) => chunk.length > 0)
    .map((chunk) => chunk.replace(/;\s*$/, ""));
}

async function createDb(): Promise<Db> {
  const s = state();

  if (driverName() === "postgres") {
    const url = process.env.DATABASE_URL?.trim();
    if (!url) throw new Error("DATABASE_URL is required when DB_DRIVER=postgres");
    const [{ Pool }, { drizzle }] = await Promise.all([
      import("pg"),
      import("drizzle-orm/node-postgres"),
    ]);
    const pool = new Pool({
      connectionString: url,
      max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    });
    s.close = () => pool.end();
    const db = drizzle(pool, { schema }) as unknown as Db;
    await applyMigrations(db);
    return db;
  }

  const [{ PGlite }, { drizzle }] = await Promise.all([
    import("@electric-sql/pglite"),
    import("drizzle-orm/pglite"),
  ]);
  const dir = pgDataDir();
  fs.mkdirSync(dir, { recursive: true });
  const client = new PGlite(dir);
  s.close = () => client.close();
  const db = drizzle(client, { schema }) as unknown as Db;
  await applyMigrations(db);
  return db;
}

/** Lazily create (and migrate) the shared database handle. */
export async function getDb(): Promise<Db> {
  const s = state();
  s.ready ??= createDb();
  return s.ready;
}

/** Migrations recorded in the database, after connecting (which applies pending ones). */
export async function listAppliedMigrations(): Promise<string[]> {
  return readAppliedMigrations(await getDb());
}

/** Close the handle so the next `getDb()` reconnects (used by tests). */
export async function closeDb(): Promise<void> {
  const s = state();
  const ready = s.ready;
  s.ready = null;
  const close = s.close;
  s.close = null;
  if (ready) {
    try {
      await ready;
    } catch {
      // connection never came up; nothing to close
    }
  }
  await close?.();
}
