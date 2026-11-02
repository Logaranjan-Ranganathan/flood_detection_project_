# FloodGuard — IoT flood monitoring for a community

Public dashboard, live map with 50-metre monitoring zones, sensor history, device
diagnostics, alerts and an administrator console for an ESP32 + LoRa water-level fleet.

**FloodGuard is careful about what it does not know.** An uncalibrated sensor shows
*"Raw sensor reading — calibration required."* rather than fake centimetres. A water-level
sensor never claims litres-per-minute. A sensor without a verified position shows
*"Location unavailable"* and is left off the map instead of being dropped on the gateway's
coordinates. Demo rows are badged `SIMULATED`, and 50 m circles are labelled as configured
monitoring zones, not government wards.

## Quick start (no server, no Docker)

```bash
npm install
cp .env.example .env      # fill in the placeholders
npm run db:migrate        # applies drizzle migrations to the database
npm run db:seed           # demo sensors, zones, gateway and SIMULATED history
npm run dev               # http://localhost:3000
```

With `DB_DRIVER=pglite` the database is a real embedded Postgres (`@electric-sql/pglite`)
persisted under `data/pglite/` — historical readings are on disk, never in memory. Set
`DATABASE_URL` and `DB_DRIVER=postgres` to point at a managed PostgreSQL instance; the same
schema and migrations run on either driver.

`npm run db:seed` prints every device token **once**. They exist only so the demo has data;
delete `data/pglite` and drop the seeded rows before real hardware reports in. The seeder
refuses to run against a database that already contains non-simulated readings unless you
pass `--force`.

Administrator sign-in comes from `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`. If
`SEED_ADMIN_PASSWORD` is unset, a random password is generated and printed once — no
production password is ever hardcoded in this repository.

## Commands

| command             | what it does                                                   |
| ------------------- | -------------------------------------------------------------- |
| `npm run dev`       | Next.js dev server                                              |
| `npm run build`     | production build                                                |
| `npm run start`     | serve the built app                                             |
| `npm run test`      | Vitest suite (domain logic, schema, ingestion, auth, zones)     |
| `npm run lint`      | ESLint flat config                                              |
| `npm run typecheck` | `tsc --noEmit`                                                  |
| `npm run db:generate` | generate a SQL migration from `src/db/schema.ts`              |
| `npm run db:migrate`  | apply `drizzle/*.sql`                                           |
| `npm run db:seed`     | demo data (simulated, clearly labelled)                         |

## Pages

| route                      | content                                                            |
| -------------------------- | ------------------------------------------------------------------ |
| `/`                        | totals, warnings, criticals, latest readings, alerts, last update  |
| `/map`                     | sensors, gateways, 50 m zones, severity colours, popups            |
| `/sensors`, `/sensors/:id` | raw count, calibrated cm, level and flow history, LoRa and battery |
| `/zones`, `/zones/:id`     | zone membership, highest severity, latest level                    |
| `/diagnostics`             | ESP32-2 identity, last contact, GPS fix, RSSI, packet counts       |
| `/alerts`                  | warnings, criticals, offline and stale-data alerts                 |
| `/admin`                   | registration, calibration, thresholds, zones, credentials, ack     |

## How a reading becomes a number you can trust

```
water-level sensor → ESP32-1 → SX1278 TX → SX1278 RX → ESP32-2 → POST /api/v1/devices/readings
                                                                        ↓ authenticated + validated
                                                            PostgreSQL → website
```

The gateway sends a **raw** count. The server applies the two-point calibration an
administrator recorded, classifies the level against configured thresholds, drops any flow
value for a sensor that is not registered as flow-capable, ignores coordinates a device
tries to self-report, and records its own reception timestamp. Devices authenticate with
unique IDs (`FG-SENSOR-001`, `FG-GATEWAY-002`) and bearer tokens that are stored only as
SHA-256 hashes — an IP address is a diagnostic and never an identity, because GPRS
addresses move and are not reachable inbound.

Full contract: [`docs/api.md`](docs/api.md) and
[`firmware/docs/lora-packet-format.md`](firmware/docs/lora-packet-format.md).

## Hardware

Two ESP32 boards, two SX1278 433 MHz modules, one SIM800L, one NEO-6M, one water-level
sensor. Sketches, configuration templates and the wiring/calibration notes live in
[`firmware/`](firmware/). `config.h` (which holds the token) is git-ignored in both
folders.

The SIM800L is a 2G module: **do not assume HTTPS works on it.**
[`firmware/docs/sim800l-transport.md`](firmware/docs/sim800l-transport.md) explains how to
test it and lists two honest alternatives.

Those sketches have not been compiled or run on hardware — this workspace has no Arduino
toolchain and no attached boards. Treat them as a reviewed starting point, bench-test one
node with the gateway, and expect to set pins for your exact devkit.

## Security posture

- Admin mutations are rejected by the backend (`401`), not merely hidden in the UI.
- Sensor tokens cannot post gateway diagnostics, and gateway tokens cannot post readings.
- Login and ingestion are rate limited; error text is generic and the same whether the
  e-mail is unknown or the password wrong.
- Logs never include tokens, headers or passwords.
- `POST /admin/credentials` returns a plaintext token exactly once; only `token_prefix` is
  ever listable.
- Zone radius defaults to 50 m and is validated; overlapping zones count a sensor once per
  zone.

## Limitations you should know about before trusting this with a real flood

- Level → severity mapping needs your site's own threshold measurements. Default
  15/30/50 cm is a placeholder, not local knowledge.
- No flow data exists without a flow meter or a validated hydraulic model.
- `SENSOR_OFFLINE` / `DATA_STALE` depend on the stale and offline windows you configure;
  the defaults (30 min / 120 min) are guesses until you know the node's sleep interval.
- The public dashboard is informational. It is not an evacuation order, and the 50 m
  circles are not administrative boundaries.
