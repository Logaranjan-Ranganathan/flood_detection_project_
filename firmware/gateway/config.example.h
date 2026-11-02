/*
  Gateway configuration — copy this file to config.h and fill it in.

  config.h is git-ignored. It is the only place the ingestion token exists, and that
  token is printed once by the admin console and cannot be read back out of the
  database afterwards (only its SHA-256 hash is stored).
*/

#pragma once

/* -------------------------------------------------------------- identity */
/* Registered in the admin console. This, not an IP address, is who we are. */
#define GATEWAY_ID "FG-GATEWAY-002"
#define GATEWAY_FIRMWARE_VERSION "1.0.0"

/*
  Gateway token issued by Admin console -> "Issue gateway token".
  A sensor token will be refused on the gateway-status endpoint, and this token
  cannot post sensor readings, so a compromised gateway cannot invent sensors.
*/
#define API_TOKEN "paste-the-gateway-token-here"

/* ---------------------------------------------------------------- backend */
#define API_HOST "your-site.example.com"  /* host only, no https:// prefix */
#define USE_TLS 0  /* 0 = plain HTTP over GPRS. Read docs/sim800l-transport.md first. */

/* ------------------------------------------------------------ SIM800L     */
/*
  The SIM800L is 2G-only and draws 2 A peaks: power it from its own 3.7-4.2 V supply,
  not from the ESP32 pin header. Logic level is 3.3 V, so no level shifter is needed
  on the UART, but keep the wires short.
*/
#define HAS_SIM800 1
#define MODEM_SERIAL Serial2
#define MODEM_TX_PIN 16  /* ESP32 TX -> SIM800L RX */
#define MODEM_RX_PIN 17  /* ESP32 RX <- SIM800L TX */
#define MODEM_BAUD 9600
#define MODEM_PWRKEY_PIN 4

/* Your APN. Leave the user/password empty for the ordinary public-internet APNs. */
#define SIM800_APN "dialogbb"

/* ------------------------------------------------------------------- GPS  */
/* NEO-6M on the gateway: 9600 default, wire its TX to ESP32 RX. */
#define GPS_SERIAL Serial1
#define GPS_TX_PIN 22
#define GPS_RX_PIN 23
#define GPS_BAUD 9600

/* ------------------------------------------------------------------ LoRa */
#define LORA_SS_PIN 5
#define LORA_RESET_PIN 14
#define LORA_DIO0_PIN 26
#define LORA_FREQUENCY_MHZ 433.0f
#define LORA_SPREADING_FACTOR 9
#define LORA_SIGNAL_BANDWIDTH_HZ 125E3
#define LORA_CODING_RATE_DENOMINATOR 7

/* ---------------------------------------------------------------- timing */
#define HEARTBEAT_INTERVAL_MS 300000UL
