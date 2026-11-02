/*
  FloodGuard gateway — ESP32-2 + SX1278 433 MHz + SIM800L GPRS + NEO-6M GPS.

  Listens for sensor_node packets, forwards each one unchanged to the FloodGuard
  ingestion API, and separately reports its own diagnostics (identity, GPS fix,
  RSSI, battery, packet counter) to /api/v1/devices/gateway-status.

  Identity is GATEWAY_ID plus a gateway token issued in the admin console. The IP
  address the module happens to be given is reported as a diagnostic and is never
  used as a credential.

  Libraries: LoRa 0.8.0, ArduinoJson 7.x, TinyGPSPlus 1.0.3, ESP32 Arduino core 2.0.x.
  The SIM800L is driven with plain AT commands, so no modem library is needed.
*/

#include <ArduinoJson.h>
#include <LoRa.h>
#include <TinyGPSPlus.h>

#include "config.h"

static TinyGPSPlus gps;
static uint32_t packetsReceived = 0;
static uint32_t uploadsSent = 0;
static uint32_t uploadsFailed = 0;
static uint8_t lastHttpStatus = 0;
static uint32_t lastHeartbeatAtMs = 0;
static String reportedIpAddress;

/* ------------------------------------------------------------ SIM800L AT */

static bool atResponse(const char *expect, uint32_t timeoutMs) {
  const uint32_t deadline = millis() + timeoutMs;
  String line;
  while (millis() < deadline) {
    while (MODEM_SERIAL.available()) {
      line += (char)MODEM_SERIAL.read();
      if (line.endsWith("\n")) {
        line.trim();
        Serial.println(line);
        if (line.length() && line.indexOf(expect) >= 0) return true;
        if (line.indexOf("ERROR") >= 0 || line.indexOf("+CME ERROR") >= 0) return false;
        line = "";
      }
    }
  }
  return false;
}

static void atCommand(const char *cmd, uint32_t timeoutMs = 3000) {
  Serial.print(F("AT> "));
  Serial.println(cmd);
  MODEM_SERIAL.println(cmd);
  atResponse("OK", timeoutMs);
}

/* Runs a read command and keeps the last data line before OK/ERROR. */
static String atQuery(const char *cmd, uint32_t timeoutMs) {
  Serial.print(F("AT> "));
  Serial.println(cmd);
  MODEM_SERIAL.println(cmd);
  String out;
  String line;
  const uint32_t deadline = millis() + timeoutMs;
  while (millis() < deadline) {
    while (MODEM_SERIAL.available()) {
      line += (char)MODEM_SERIAL.read();
      if (!line.endsWith("
")) continue;
      line.trim();
      if (line.length() > 0) {
        if (line.indexOf("OK") >= 0 || line.indexOf("ERROR") >= 0) return out;
        out = line;
      }
      line = "";
    }
  }
  return out;
}

/* Reads a line of modem output without blocking the LoRa loop for long. */
static void modemDrain(uint32_t ms) {
  const uint32_t deadline = millis() + ms;
  while (millis() < deadline) {
    while (MODEM_SERIAL.available()) Serial.write((char)MODEM_SERIAL.read());
    delay(5);
  }
}

static bool modemPowerUp() {
  MODEM_SERIAL.begin(MODEM_BAUD, SERIAL_8N1, MODEM_RX_PIN, MODEM_TX_PIN);
  pinMode(MODEM_PWRKEY_PIN, OUTPUT);
  digitalWrite(MODEM_PWRKEY_PIN, HIGH);
  delay(1500);
  digitalWrite(MODEM_PWRKEY_PIN, LOW);
  delay(3000);
  digitalWrite(MODEM_PWRKEY_PIN, HIGH);

  for (uint8_t attempt = 0; attempt < 8; attempt++) {
    MODEM_SERIAL.println("AT");
    if (atResponse("OK", 1200)) return true;
    delay(1000);
  }
  Serial.println(F("SIM800L did not answer AT — check power (2 A peaks) and wiring"));
  return false;
}

static void bearerAttach() {
  atCommand("AT+CMEE=2");
  atCommand("AT+CSQ");
  atCommand("AT+CIPMUX=0");
  atCommand("AT+CSTT=\"" SIM800_APN "\",\"\",\"\"");
  atCommand("AT+CIICR", 20000);
  /* The address we later report as a diagnostic. It is not an identity and the
     website never uses it to decide which gateway is speaking. */
  reportedIpAddress = atQuery("AT+CIFSR", 8000);
}

/*
  One HTTPS-or-HTTP POST of a JSON body, using the SIM800 HTTP command set.

  Whether TLS is actually available depends on the module revision, its firmware and
  the 2G network — see firmware/docs/sim800l-transport.md. USE_TLS must be 0 unless
  you have confirmed `AT+HTTPPARA="SSL",1` negotiates on YOUR module, and even then a
  433 MHz sensor fleet deserves a transport you can prove is encrypted.
*/
static bool httpPost(const char *path, const String &body) {
  MODEM_SERIAL.println("AT+HTTPINIT");
  if (!atResponse("OK", 5000)) return false;

  MODEM_SERIAL.println("AT+HTTPPARA=\"CID\",\"1\"");
  atResponse("OK", 3000);
#if USE_TLS
  MODEM_SERIAL.println("AT+HTTPPARA=\"SSL\",1");
  atResponse("OK", 3000);
#endif
  char url[192];
  snprintf(url, sizeof(url), "AT+HTTPPARA=\"URL\",\"%s://%s%s\"", USE_TLS ? "https" : "http",
           API_HOST, path);
  MODEM_SERIAL.println(url);
  atResponse("OK", 5000);

  MODEM_SERIAL.println("AT+HTTPPARA=\"CONTENT\",\"application/json\"");
  atResponse("OK", 3000);

  /* Bearer token as a user-defined header: never in the URL, never in the body. */
  char auth[128];
  snprintf(auth, sizeof(auth), "AT+HTTPPARA=\"USERDATA\",\"Authorization: Bearer %s\"", API_TOKEN);
  MODEM_SERIAL.println(auth);
  atResponse("OK", 3000);

  MODEM_SERIAL.print("AT+HTTPDATA=");
  MODEM_SERIAL.print(body.length());
  MODEM_SERIAL.println(",10000");
  if (!atResponse("DOWNLOAD", 8000)) {
    MODEM_SERIAL.println("AT+HTTPTERM");
    return false;
  }
  MODEM_SERIAL.print(body);
  if (!atResponse("OK", 12000)) {
    MODEM_SERIAL.println("AT+HTTPTERM");
    return false;
  }

  MODEM_SERIAL.println("AT+HTTPACTION=1");  // 1 = POST
  if (!atResponse("+HTTPACTION:", 45000)) {
    MODEM_SERIAL.println("AT+HTTPTERM");
    return false;
  }

  /* +HTTPACTION: 1,<statusCode>,<length> — the server's code, not the modem's. */
  String line;
  const uint32_t deadline = millis() + 8000;
  while (millis() < deadline) {
    while (MODEM_SERIAL.available()) {
      line += (char)MODEM_SERIAL.read();
      if (line.endsWith("\n")) {
        if (line.indexOf("+HTTPACTION:") >= 0) {
          const int comma = line.indexOf(',', line.indexOf(':'));
          lastHttpStatus = (uint8_t)line.substring(comma + 1, line.indexOf(',', comma + 1)).toInt();
        }
        line = "";
      }
    }
  }

  MODEM_SERIAL.println("AT+HTTPREAD");
  modemDrain(2500);
  MODEM_SERIAL.println("AT+HTTPTERM");
  return lastHttpStatus >= 200 && lastHttpStatus < 300;
}

/* ------------------------------------------------------------------ LoRa */

static void loRaBegin() {
  LoRa.setPins(LORA_SS_PIN, LORA_RESET_PIN, LORA_DIO0_PIN);
  if (!LoRa.begin(LORA_FREQUENCY_MHZ)) {
    Serial.println(F("LoRa init failed — check SPI wiring"));
    ESP.restart();
  }
  LoRa.setSpreadingFactor(LORA_SPREADING_FACTOR);
  LoRa.setSignalBandwidth(LORA_SIGNAL_BANDWIDTH_HZ);
  LoRa.setCodingRate4(LORA_CODING_RATE_DENOMINATOR);
  LoRa.enableCrc();
}

static void pumpGps() {
  while (GPS_SERIAL.available()) gps.encode(GPS_SERIAL.read());
}

static void sendHeartbeat() {
  JsonDocument doc;
  doc["gateway_id"] = GATEWAY_ID;
  doc["firmware_version"] = GATEWAY_FIRMWARE_VERSION;
  doc["simulated"] = false;
  doc["packets_received"] = packetsReceived;
  doc["network_status"] = lastHttpStatus == 0 ? "UNKNOWN" : "ONLINE";
  if (reportedIpAddress.length() > 0) doc["ip_address"] = reportedIpAddress;
  if (gps.location.isValid()) {
    doc["latitude"] = gps.location.lat();
    doc["longitude"] = gps.location.lng();
    doc["gps_fix"] = true;
  } else {
    /* A cold sky is reported as no fix, never as a guessed position. */
    doc["gps_fix"] = false;
  }
  /* LoRa 0.8.0 exposes RSSI but not SNR, so snr stays absent unless your fork adds it. */

  String body;
  serializeJson(doc, body);
  if (httpPost("/api/v1/devices/gateway-status", body)) uploadsSent++;
  else uploadsFailed++;
}

/* ------------------------------------------------------------------- main */

void setup() {
  Serial.begin(115200);
  GPS_SERIAL.begin(GPS_BAUD, SERIAL_8N1, GPS_RX_PIN, GPS_TX_PIN);
  loRaBegin();

#if HAS_SIM800
  if (modemPowerUp()) bearerAttach();
#endif
}

void loop() {
  pumpGps();

  int size = LoRa.parsePacket();
  if (size > 0) {
    String packet;
    while (LoRa.available()) packet += (char)LoRa.read();
    /* The CRC check above means a truncated packet is dropped before we parse it. */
    const int16_t rssi = LoRa.packetRssi();

    JsonDocument doc;
    if (deserializeJson(doc, packet)) {
      Serial.println(F("malformed LoRa packet ignored"));
      return;
    }
    doc["lora_rssi"] = rssi;  /* measured here, at the receiving antenna */
    packetsReceived++;

    String body;
    serializeJson(doc, body);
    Serial.print(F("uploading "));
    Serial.println(body);
#if HAS_SIM800
    if (httpPost("/api/v1/devices/readings", body)) uploadsSent++;
    else uploadsFailed++;
#else
    Serial.println(F("no modem configured — packet kept in the local log only"));
#endif
  }

  if (millis() - lastHeartbeatAtMs >= HEARTBEAT_INTERVAL_MS) {
    lastHeartbeatAtMs = millis();
#if HAS_SIM800
    sendHeartbeat();
#endif
  }
}
