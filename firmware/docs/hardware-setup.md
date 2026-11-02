# Hardware setup and the limits of what it can honestly measure

## Board roles

| board     | parts on it                          | job                                        |
| --------- | ------------------------------------ | ------------------------------------------ |
| ESP32-1   | SX1278 (433 MHz), water-level sensor | sense and transmit; no internet connection |
| ESP32-2   | SX1278, SIM800L, NEO-6M              | receive, upload, report its own diagnostics |

Nothing on ESP32-1 has a clock or a position. Only ESP32-2 has GPS, so **the website
labels those coordinates as gateway coordinates** and never assigns them to a remote
sensor. A sensor's own position stays `unverified` until an administrator pins it.

## Wiring

The pin numbers in `config.example.h` are placeholders that match the common
"ESP32 Dev Module" pinout. **Confirm them against the silkscreen on your board** — a
30-pin and a 38-pin devkit disagree about where VSCH and the extra UARTs land, and a
wrong pin is how people end up with a board that appears dead.

SX1278 ↔ ESP32 (both boards, same SPI bus):

| SX1278 | default in these sketches |
| ------ | ------------------------- |
| NSS/SS | 5                         |
| SCK    | 18                        |
| MISO   | 19                        |
| MOSI   | 23                        |
| DIO0   | 26                        |
| RST    | 14                        |
| 3.3V   | 3.3 V, **not** 5 V        |
| GND    | common with the ESP32     |

Both radios must share frequency, spreading factor, bandwidth and coding rate. The
four values are in `config.example.h` on each side and they must match exactly.

## Power

- SIM800L: 3.7–4.2 V capable of 2 A peaks. A LiPo cell plus a dedicated 3.3 V LDO for
  the logic side, or a DEV-V3.0 carrier board. Brown-out during `AT+CIICR` is almost
  always a supply problem, not a code problem.
- SX1278 TX at +17 dBm pulls ~120 mA — decouple with 10 µF + 100 nF at its VCC pin.
- ESP32 deep sleep with a battery divider lets the node report battery voltage; without
  `BATTERY_SENSING_PIN` wired, leave it `-1` so the site shows "—" instead of a lie.

## The water-level sensor: three cases, one raw integer

The sketch does **not** assume your sensor model. Pick the branch that matches the part
you actually own, because the meaning of the raw number differs completely:

| `SENSOR_TYPE`   | typical part                      | raw value                        | can it become cm?                       |
| --------------- | --------------------------------- | -------------------------------- | --------------------------------------- |
| `SENSOR_DIGITAL`| float switch, reed, presence pad  | count of "wet" samples out of N  | no — only a threshold per installed unit |
| `SENSOR_ANALOG` | resistive tape, 0-10 V transmitter| averaged ADC count               | yes, with a two-point calibration        |
| `SENSOR_PULSE`  | HC-SR04-style distance            | mm from the sensor to the surface| yes, via `reference − distance`          |

### Two-point calibration, which the server performs

The administrator records three numbers per sensor in the admin console:

```
zero_raw       the raw count at a known reference depth of 0 cm
span_raw       the raw count at a known reference depth of reference_cm
reference_cm   that measured depth, in centimetres
```

`level_cm = (raw − zero_raw) / (span_raw − zero_raw) × reference_cm`

Until all three are saved *and* marked verified, the site shows
**"Raw sensor reading — calibration required."** and the status is
`CALIBRATION_REQUIRED`. That is deliberate: a raw ADC count is not a centimetre, and
presenting one as such is how a flood dashboard loses credibility.

To get those numbers you need one real measurement: lower the sensor into a bucket and
note the raw count at two known depths (for example dry and at 40 cm). Record them, and
check a third depth afterwards as a sanity test.

## Flow is not measured here

A water-level sensor measures level. Litres per minute needs a flow meter, or a
documented hydraulic model with a channel cross-section and a slope. Neither exists in
this build, so `water_flow_lpm` stays null, the node must not send it, and the site
prints **"Flow data unavailable — additional sensor or validated model required."**
Set `flow_supported` in the admin console only for a node that genuinely has a flow
meter wired to it.

## LoRa range expectations at 433 MHz

With +17 dBm, SF9/125 kHz and small wire antennas, expect a few hundred metres in a
built-up area and more in open ground. Before mounting anything: put the node on a pole
at the site, walk the gateway to the intended position, and log RSSI for an hour.
`lora_rssi` is measured by the **receiving** gateway, not reported by the node.

The LoRa 0.8.0 library exposes RSSI but not SNR, so `lora_snr` remains null unless your
fork of the library provides it. The site displays "—" rather than inventing a number.
