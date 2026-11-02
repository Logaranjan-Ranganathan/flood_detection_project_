# FloodGuard HTTP API

Base path `/api/v1`. Every response is JSON. Errors are
`{"ok":false,"code":"...","message":"..."}` with an appropriate status code; messages are
safe to show to a device or a visitor and never contain a token, a stack trace or SQL.

## Device ingestion (used by firmware)

### `POST /api/v1/devices/readings`

Header: `Authorization: Bearer <device token>` — a **sensor** token. Gateway tokens are
rejected here.

```json
{
  "device_id": "FG-SENSOR-001",
  "gateway_id": "FG-GATEWAY-002",
  "raw_sensor_value": 0,
  "calibrated_water_level_cm": null,
  "water_flow_lpm": null,
  "flood_status": "CALIBRATION_REQUIRED",
  "latitude": null,
  "longitude": null,
  "battery_voltage": null,
  "lora_rssi": null,
  "lora_snr": null,
  "packet_sequence": 1,
  "firmware_version": "1.0.0",
  "simulated": false
}
```

This is a schema example, not a real measurement.

What the server does with it:

- **Validates** against a strict zod schema. Identifiers must match
  `[A-Za-z0-9][A-Za-z0-9._-]{2,63}` (so `../etc/passwd` and `'; DROP TABLE--` are refused),
  numbers are range-checked, unknown keys are rejected. Absent optional keys become `null`.
- **Authenticates** the bearer token against `device_credentials` (SHA-256 lookup) and
  requires the token's device to equal the body's `device_id`.
- **Ignores** `calibrated_water_level_cm`, `flood_status`, `latitude` and `longitude` from
  the device. The centimetre value and the severity are recomputed from the raw count using
  the calibration and thresholds on file; a position is only ever taken from a verified
  device record. A device cannot promote itself to `CRITICAL`.
- **Discards** `water_flow_lpm` unless the sensor is registered as flow-capable, because a
  level sensor does not measure flow.
- **Deduplicates** by `dedupe_key` (device + sequence + a 5-minute timestamp bucket). A
  replay returns `200` with `"duplicate":true` and is stored once.
- **Timestamps** with `received_at` from the server clock, keeping `device_reported_at`
  alongside it when the packet carried `device_timestamp_ms`.
- **Raises alerts** when the recomputed level escalates to `WARNING`/`CRITICAL` (deduplicated
  per device, per status, per hour) and when calibration is still missing (once a day).

Rate limited to 120 packets/minute per client → `429` with `retry_after_seconds`.

Responses: `200` accepted (echoing the recalibrated values), `200 duplicate`, `400
invalid_payload` (with `issues[]`), `401` missing/invalid token, `403 device_mismatch`,
`404 unknown_device`, `429`, `500`.

### `POST /api/v1/devices/gateway-status`

Header: `Authorization: Bearer <gateway token>` — a **gateway** token. Sensor tokens are
rejected here, so a captured node cannot rewrite ESP32-2's diagnostics.

Body fields: `gateway_id`, `firmware_version`, `ip_address`, `latitude`, `longitude`,
`gps_fix`, `lora_rssi`, `lora_snr`, `battery_mv`, `packets_received`, `network_status`,
`device_timestamp_ms`, `simulated`. Absent optionals are stored as `null`.

`ip_address` must match `[0-9a-fA-F:.]{1,64}` — it is stored for diagnostics only and is
never used as identity. Coordinates are only written when `gps_fix` is true, so a cold-start
drift cannot overwrite the last good position. `404 unknown_gateway` if the gateway was
never registered.

## Public reads (no authentication)

| endpoint                        | returns                                                              |
| ------------------------------- | -------------------------------------------------------------------- |
| `GET /api/v1/public/overview`   | stats, devices with snapshots, zones, gateways, alerts, `generatedAt` |
| `GET /api/v1/public/sensors/:id`| one sensor snapshot plus `?hours=6\|24\|72\|168` of history           |
| `GET /api/v1/public/zones/:id`  | a 50 m zone summary and its member sensors                            |
| `GET /api/v1/health`            | liveness plus which Postgres driver is serving this instance          |

Public payloads contain no credentials, no token prefixes and no admin e-mail addresses.
The map and dashboard read from these endpoints — nothing about water levels is hardcoded
in the frontend.

## Admin (session cookie `fg_admin_session`, HttpOnly)

`POST /admin/auth/login` · `POST /admin/auth/logout` · `GET /admin/auth/session`

Login is rate limited per IP (10 attempts / 15 minutes) and answers the same
`invalid_credentials` message whether the e-mail is unknown or the password is wrong.
Sessions are random tokens stored only as SHA-256 hashes with an 8-hour expiry; there is no
signing secret to manage.

| resource                          | methods              | purpose                                     |
| --------------------------------- | -------------------- | ------------------------------------------- |
| `/admin/devices`                  | GET, POST            | list, register a sensor                     |
| `/admin/devices/:deviceId`        | PATCH, DELETE        | calibration, location, thresholds, metadata |
| `/admin/gateways`                 | GET, POST            | gateways such as ESP32-2                     |
| `/admin/zones`                    | GET, POST, DELETE    | monitoring zones (default radius 50 m)      |
| `/admin/credentials`              | GET, POST, DELETE    | issue / revoke sensor or gateway tokens     |
| `/admin/settings`                 | GET, PUT             | thresholds, stale and offline windows       |
| `/admin/alerts`                   | POST                 | acknowledge or unacknowledge an alert       |
| `/admin/sweep`                    | POST                 | run the health sweep on demand              |

`POST /admin/credentials` takes **exactly one** of `device_id` or `gateway_id` plus an
optional `label`, and returns the plaintext token once. `GET /admin/credentials` only ever
exposes `token_prefix`. Every mutating admin route calls `requireAdmin()` server-side; the
frontend hiding a button is not the control.

`PATCH /admin/devices/:id` uses true partial semantics: an omitted key is left alone, and an
explicit `null` clears it.
