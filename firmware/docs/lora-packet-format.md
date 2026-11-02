# LoRa over-the-air packet format

One packet = one compact JSON object, no framing bytes, no line endings. `LoRa.endPacket()`
is called after `LoRa.write()` of the serialized body, and CRC is enabled on both sides.

Maximum size to respect: **255 bytes**, the default payload ceiling of the LoRa 0.8.0
library. A full reading with every optional field present is roughly 190 bytes, so there
is headroom. If you add fields, print `serializeJson()`'s return length before you fly a
configuration that silently truncates.

## Sensor → gateway

```json
{"device_id":"FG-SENSOR-001","gateway_id":"FG-GATEWAY-002","raw_sensor_value":812,"packet_sequence":137,"firmware_version":"1.0.0","battery_voltage":3.71,"simulated":false}
```

| field              | type        | required | notes                                                            |
| ------------------ | ----------- | -------- | ---------------------------------------------------------------- |
| `device_id`        | string      | yes      | registered sensor id, 3-64 chars of `A-Za-z0-9._-`               |
| `gateway_id`       | string      | yes      | intended receiver; the site shows which gateway carried the data |
| `raw_sensor_value` | int         | yes      | raw count from the sensor — **not** centimetres                  |
| `packet_sequence`  | int ≥ 0     | recommended | monotonically increasing; drives duplicate rejection         |
| `firmware_version` | string ≤32  | recommended | so a fleet can be audited after an incident                   |
| `battery_voltage`  | number      | optional | omit the key when not measured                                   |
| `simulated`        | bool        | yes      | `false` for real hardware, always                                |

Omitted fields are fine. The backend defaults every absent optional key to `null` rather
than rejecting the packet, because a LoRa payload budget is a real constraint. Unknown
keys are **rejected** — that is deliberate, so a node and a server that have drifted apart
fail loudly at the endpoint instead of quietly storing the wrong thing.

Deliberately absent from the radio: `calibrated_water_level_cm`, `flood_status`,
`latitude`, `longitude`, `lora_rssi`, `lora_snr`. The first two are computed by the server
(a node cannot self-assign a flood severity), positions only come from verified records,
and signal quality is measured where the antenna actually is — at the receiver.

## Duplicates

A node may retransmit after a watchdog reset, and LoRa itself can deliver twice. The
server stores a unique `dedupe_key` derived from
`device_id` + `packet_sequence` + a 5-minute bucket of the timestamp, so a replay is
acknowledged with `{"ok":true,"duplicate":true}` and counted once.

`packet_sequence` lives in `RTC_DATA_ATTR` memory, which survives deep sleep but **not** a
power cycle. After a battery swap a node restarts at 1, and the oldest replayed sequence in
that five-minute window is kept while later ones are dropped as duplicates. If you need
sequence continuity across power loss, store the counter in NVS (`Preferences.h`) instead.

## Gateway → backend

The gateway forwards the decoded object unchanged and adds only what it can measure at
the receiving antenna:

```json
{"device_id":"FG-SENSOR-001","gateway_id":"FG-GATEWAY-002","raw_sensor_value":812,"packet_sequence":137,"firmware_version":"1.0.0","battery_voltage":3.71,"simulated":false,"lora_rssi":-92}
```

It is sent as the body of `POST /api/v1/devices/readings` with
`Authorization: Bearer <sensor token>` — see [`backend-payload.md`](./backend-payload.md).
