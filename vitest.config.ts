import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(process.cwd(), "src") },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Each file gets its own embedded PostgreSQL directory, so tests never
    // touch a developer's local data/pglite folder.
    pool: "forks",
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
