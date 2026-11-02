import "./load-env";
import { closeDb, driverName, getDb, listAppliedMigrations, pgDataDir } from "../src/db/client";

async function main() {
  await getDb(); // connecting applies every pending drizzle/*.sql
  const applied = await listAppliedMigrations();
  console.log(`driver: ${driverName()}`);
  if (driverName() === "pglite") console.log(`data dir: ${pgDataDir()}`);
  console.log(`migrations recorded: ${applied.length}`);
  for (const name of applied) console.log(`  ${name}`);
  await closeDb();
}

main()
  .then(() => {
    console.log("MIGRATE OK");
    process.exit(0);
  })
  .catch((err) => {
    console.error("MIGRATE FAILED:", err);
    process.exit(1);
  });
