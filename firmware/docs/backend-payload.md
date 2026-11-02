# Backend payload from the gateway

Two endpoints, two different credentials. Keep them apart: a node credential cannot write
gateway diagnostics and a gateway credential cannot invent sensor readings.

## 1. Forwarding a reading

```
POST /api/v1/devices/readings
Authorization: Bearer <SENSOR_TOKEN>
Content-Type: application/json
```

Body: the LoRa JSON, unchanged, plus `lora_rssi` measured by this gateway.

The token must belong to the `device_id` in the body. If it does not, the server answers
`403 device_mismatch`, which is what stops one compromised node from publishing under
another node's identity.

| HTTP | code                | gateway behaviour                                        |
| ---- | ------------------- | -------------------------------------------------------- |
| 200  | `duplicate: true`   | packet already stored — do not retry                      |
| 200  | `ok: true`          | stored; recalibrated and classified server-side           |
| 400  | `invalid_payload`   | schema mismatch — stop and fix the firmware, do not retry |
| 401  | `invalid_token`     | token revoked or wrong device — log and alert locally      |
| 403  | `device_mismatch`   | this token is not valid for that `device_id`               |
| 404  | `unknown_device`    | sensor not registered yet                                  |
| 429  | `rate_limited`      | back off using `retry_after_seconds`                       |

The gateway does not decide a water level. It sends raw counts; the server applies the
calibration and threshold that an administrator configured, and records
`received_at` from its own clock.

## 2. Reporting its own health

```
POST /api/v1/devices/gateway-status
Authorization: Bearer <GATEWAY_TOKEN>
Content-Type: application/json
```

```json
{
  "gateway_id": "FG-GATEWAY-002",
  "firmware_version": "1.0.0",
  "ip_address": "10.10.4.21",
  "latitude": 6.9271,
  "longitude": 79.8612,
  "gps_fix": true,
  "lora_rssi": -88,
  "battery_mv": 4100,
  "packets_received": 1284,
  "network_status": "ONLINE",
  "simulated": false
}
```

Rules the firmware must respect:

- `gps_fix` is `false` whenever the NEO-6M has no fix. Coordinates without a fix are
  ignored by the server, so a drifting cold-start position cannot overwrite the last good
  one.
- `ip_address` is a **diagnostic**. Identity is `gateway_id`. A GPRS address changes with
  every attach, and on most carrier NATs nothing can reach the device through it.
- `ip_address` is validated as digits, dots, colons and hex only — an injected
  `"\r\nX-Admin: true"` is a `400`, not a header.
- `packets_received` is a counter of what this gateway has accepted; the server also
  counts arrivals independently, so the two can be compared when a link is suspect.

## Provisioning order

1. Admin console → *Register a gateway* → `FG-GATEWAY-002`.
2. Admin console → *Issue gateway token* → paste into `firmware/gateway/config.h`.
3. Admin console → *Register a sensor* per node, then *Issue device token* inside that
   sensor's editor. Because the gateway relays on each node's behalf, it holds one device
   token per node it forwards for. That is a real trade-off, worth stating plainly: the
   benefit is per-device attribution, replay protection and independent revocation (one
   captured node cannot be used to publish as another); the cost is that ESP32-2 carries
   credentials for the nodes under it, so it must be physically protected. If you would
   rather not put node secrets on the gateway, either give a node its own direct link
   (WiFi or an LTE UART module) with its own token, or move the relay behind the token
   boundary and treat the gateway as a trusted concentrator.
4. Admin console → set calibration and thresholds once you have real measurements.

`config.h` is git-ignored in both firmware folders. Never commit a token, and never print
one on a public page — the site only ever shows the first ten characters of a token's
prefix.
