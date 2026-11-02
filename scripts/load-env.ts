/**
 * Standalone scripts (seed, migrate) run outside Next.js, which means nothing loads
 * `.env` for them. Without this the seeder would silently fall back to its defaults and
 * an operator would get an admin password they had not chosen.
 */
import fs from "node:fs";
import path from "node:path";

const file = path.join(process.cwd(), ".env");

if (fs.existsSync(file)) {
  for (const rawLine of fs.readFileSync(file, "utf8").split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
