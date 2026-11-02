# FloodGuard firmware

Two ESP32 boards, two SX1278 433 MHz LoRa modules and a SIM800L + NEO-6M pair on
the gateway:

```
water-level sensor ──▶ ESP32-1 (sensor_node) ──▶ SX1278 TX
                                                  │  433 MHz LoRa, compact JSON
                                                  ▼
                       SX1278 RX ──▶ ESP32-2 (gateway) ──▶ SIM800L GPRS ──▶ POST /api/v1/devices/readings
```

| folder           | board     | role                                                                  |
| ---------------- | --------- | --------------------------------------------------------------------- |
| `sensor_node/`   | ESP32-1   | reads the water-level sensor, transmits one LoRa JSON packet per cycle |
| `gateway/`       | ESP32-2   | receives LoRa, holds the NEO-6M GPS + SIM800L link, uploads to FloodGuard |

## Before you flash anything

Both sketches read their settings from a `config.h` that you create by copying the
shipped `config.example.h`. **Nothing in this folder assumes your wiring.** The
water-level sensor model, its pin, and the LoRa module pinout are all configuration
constants, and the sketches refuse to compile until you set them.

Required reading, in order:

1. [`docs/hardware-setup.md`](./docs/hardware-setup.md) — pins, sensor types, power,
   the SX1278 433 MHz caveats, and what must be measured before you can claim centimetres.
2. [`docs/lora-packet-format.md`](./docs/lora-packet-format.md) — the exact JSON on the air.
3. [`docs/backend-payload.md`](./docs/backend-payload.md) — what the gateway POSTs and how
   the device token is used.
4. [`docs/sim800l-transport.md`](./docs/sim800l-transport.md) — why HTTPS from a SIM800L is
   not a given, and the two safe arrangements.

## Libraries

Installed through the Arduino Library Manager, and `#include`d by the sketches:

| library        | version tested against | used for                       |
| -------------- | ---------------------- | ------------------------------ |
| ESP32 Arduino  | 2.0.17                 | board support, WiFi/UART/RTC   |
| LoRa           | 0.8.0 (Sandor Dombi)   | SX1278 433 MHz transmit/receive |
| ArduinoJson    | 7.2.1                  | packet encode/decode           |
| TinyGPSPlus    | 1.0.3                  | NEO-6M NMEA parsing (gateway)  |

No other dependency is required: the SIM800L is driven with plain AT commands over a
hardware UART, so no modem library has to be installed.

## Status of this firmware

These sketches are written to match the ingestion schema the backend validates, and
they were reviewed line by line against the LoRa and ArduinoJson APIs. **They have not
been compiled or run on your hardware** — this workspace has no Arduino toolchain and no
attached boards, so nobody should claim otherwise. Load them in the Arduino IDE, select
*ESP32 Dev Module*, resolve any compile error that is specific to your board variant,
then bench-test one node and the gateway together before mounting anything on a pole.

Device identity is a **gateway ID and sensor ID**, never an IP address:
`FG-SENSOR-001`, `FG-GATEWAY-002`. The token is a secret the admin console prints once.
