import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { closeDb } from "@/db/client";

/**
 * Point the database client at a throwaway embedded PostgreSQL directory and
 * drop any cached connection. Called from every database-backed test file.
 */
export async function useTempDb(): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fg-test-"));
  process.env.DB_DRIVER = "pglite";
  process.env.DATABASE_URL = "";
  process.env.PGLITE_DATA_DIR = dir;
  await closeDb();
  return dir;
}

export async function disposeTempDb(dir: string): Promise<void> {
  await closeDb();
  fs.rmSync(dir, { recursive: true, force: true });
}
