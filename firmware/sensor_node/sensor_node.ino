/*
  FloodGuard sensor node — ESP32-1 + SX1278 433 MHz.

  Reads a water-level sensor, sends one compact JSON packet per cycle over LoRa to
  the gateway (ESP32-2), then sleeps. The packet carries a raw reading only: turning
  a raw count into centimetres is done on the server, from the calibration the
  administrator records, so a node can never publish an invented water level.

  Copy config.example.h to config.h and set every value for YOUR wiring first.
  Libraries: LoRa 0.8.0, ArduinoJson 7.x, ESP32 Arduino core 2.0.x.
*/

#include <ArduinoJson.h>
#include <LoRa.h>

#include "config.h"

#if !defined(SENSOR_TYPE)
#error "SENSOR_TYPE is not set — copy config.example.h to config.h first"
#endif

/* Persisted across deep sleep (kept in RTC memory; lost when the board is unpowered). */
RTC_DATA_ATTR uint32_t packetSequence = 0;

static void loRaBegin() {
  LoRa.setPins(LORA_SS_PIN, LORA_RESET_PIN, LORA_DIO0_PIN);
  if (!LoRa.begin(LORA_FREQUENCY_MHZ)) {
    Serial.println(F("LoRa init failed — check SPI wiring and the 433 MHz module"));
    ESP.restart();
  }
  LoRa.setSpreadingFactor(LORA_SPREADING_FACTOR);
  LoRa.setSignalBandwidth(LORA_SIGNAL_BANDWIDTH_HZ);
  LoRa.setCodingRate4(LORA_CODING_RATE_DENOMINATOR);
  LoRa.setTxPower(LORA_TX_POWER_DBM);
  LoRa.setPreambleLength(8);
  LoRa.enableCrc();
}

/*
  One raw integer, whatever the sensor physically produces:
    SENSOR_DIGITAL   -> how many of SENSOR_DIGITAL_SAMPLES saw the switch close
    SENSOR_ANALOG    -> raw ADC count (12-bit by default)
    SENSOR_PULSE     -> echo distance in millimetres
  None of these is a centimetre water level until it is calibrated.
*/
static int32_t readRawSensor() {
#if SENSOR_TYPE == SENSOR_DIGITAL
  pinMode(SENSOR_INPUT_PIN, INPUT);
  uint16_t active = 0;
  for (uint8_t i = 0; i < SENSOR_DIGITAL_SAMPLES; i++) {
    if (digitalRead(SENSOR_INPUT_PIN) == SENSOR_DIGITAL_ACTIVE_LEVEL) active++;
    delay(SENSOR_DIGITAL_SAMPLE_GAP_MS);
  }
  return (int32_t)active;
#elif SENSOR_TYPE == SENSOR_ANALOG
  analogReadResolution(SENSOR_ANALOG_RESOLUTION_BITS);
  uint32_t sum = 0;
  for (uint8_t i = 0; i < SENSOR_ANALOG_SAMPLES; i++) {
    sum += (uint32_t)analogRead(SENSOR_INPUT_PIN);
    delay(2);
  }
  return (int32_t)(sum / SENSOR_ANALOG_SAMPLES);
#elif SENSOR_TYPE == SENSOR_PULSE
  pinMode(SENSOR_TRIGGER_PIN, OUTPUT);
  pinMode(SENSOR_ECHO_PIN, INPUT);
  uint32_t travel = 0;
  uint8_t good = 0;
  for (uint8_t i = 0; i < SENSOR_PULSE_SAMPLES; i++) {
    digitalWrite(SENSOR_TRIGGER_PIN, LOW);
    delayMicroseconds(2);
    digitalWrite(SENSOR_TRIGGER_PIN, HIGH);
    delayMicroseconds(10);
    digitalWrite(SENSOR_TRIGGER_PIN, LOW);
    const uint32_t us = pulseIn(SENSOR_ECHO_PIN, HIGH, SENSOR_PULSE_TIMEOUT_US);
    if (us > 0) {
      travel += us;
      good++;
    }
    delay(5);
  }
  if (good == 0) return -1;  // no echo: the server marks the reading as suspect
  return (int32_t)((travel / good) * 1000UL / 58UL / 2UL);  // mm to the surface
#endif
}

/* Battery voltage from an ADC tap behind a divider, or 0 when not wired. */
static float readBatteryVolts() {
#if BATTERY_SENSING_PIN < 0
  return 0.0f;
#else
  analogReadResolution(12);
  const uint32_t raw = (uint32_t)analogRead(BATTERY_SENSING_PIN);
  const float pinVolts = (float)raw / 4095.0f * BATTERY_ADC_REFERENCE_V;
  return pinVolts * BATTERY_DIVIDER_RATIO;
#endif
}

static void setup() {
  Serial.begin(115200);
  delay(200);
  loRaBegin();
}

static void loop() {
  packetSequence++;

  const int32_t raw = readRawSensor();
  const float battery = readBatteryVolts();

  /*
    Field names are identical to POST /api/v1/devices/readings. Keeping one spelling
    across node, gateway, API, database and website is deliberate: drift between them
    is the most common way a deployment starts lying about its own data.
  */
  JsonDocument doc;
  doc["device_id"] = SENSOR_ID;
  doc["gateway_id"] = GATEWAY_ID;
  doc["raw_sensor_value"] = raw;
  doc["packet_sequence"] = packetSequence;
  doc["firmware_version"] = FIRMWARE_VERSION;
  if (battery > 0.0f) doc["battery_voltage"] = battery;
  doc["simulated"] = false;
#if SENSOR_HAS_OWN_GPS
  doc["latitude"] = 0;   // a node with its own GNSS module fills these in
  doc["longitude"] = 0;
#endif

  char packet[256];
  const size_t n = serializeJson(doc, packet);

  LoRa.beginPacket();
  LoRa.write((const uint8_t *)packet, n);
  const bool sent = LoRa.endPacket();

  Serial.print(F("packet "));
  Serial.print(packetSequence);
  Serial.print(F(" raw="));
  Serial.print(raw);
  Serial.print(F(" bytes="));
  Serial.print((unsigned)n);
  Serial.println(sent ? F(" sent") : F(" NOT sent"));

  delay(SEND_SETTLE_MS);
  esp_sleep_enable_timer_wakeup((uint64_t)SEND_INTERVAL_MS * 1000ULL);
  esp_deep_sleep_start();
}
