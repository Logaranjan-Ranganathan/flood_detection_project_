import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite ships WASM + native binaries and `pg` is a CJS driver;
  // keep both out of the server bundler.
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
};

export default nextConfig;
