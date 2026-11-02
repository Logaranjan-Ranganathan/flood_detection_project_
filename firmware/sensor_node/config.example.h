/*
  Sensor node configuration — copy this file to config.h and fill it in.

  config.h is committed-free by design: it holds only wiring and identity, never the
  device token. The token lives on the gateway, which is the only board that talks to
  the website, and the admin console prints it exactly once.
*/

#pragma once

/* -------------------------------------------------------------- identity */
/* Unique sensor id, registered in the admin console. 3-64 chars: A-Z a-z 0-9 . _ - */
#define SENSOR_ID "FG-SENSOR-001"

/* The gateway this node transmits to. The packet is refused if it is unknown. */
#define GATEWAY_ID "FG-GATEWAY-002"

#define FIRMWARE_VERSION "1.0.0"

/* ------------------------------------------------------------------ LoRa */
/* SX1278 433 MHz. SPI pins depend on your ESP32 board — check the silkscreen. */
#define LORA_SS_PIN 5
#define LORA_RESET_PIN 14
#define LORA_DIO0_PIN 26
#define LORA_FREQUENCY_MHZ 433.0f

/* Both ends must use the same four values or nothing is ever received. */
#define LORA_SPREADING_FACTOR 9
#define LORA_SIGNAL_BANDWIDTH_HZ 125E3
#define LORA_CODING_RATE_DENOMINATOR 7
#define LORA_TX_POWER_DBM 17

/* ------------------------------------------------------------ the sensor */
/*
  Pick ONE type. This is intentionally a compile-time choice: the correct wiring and
  the meaning of the raw number differ completely between the three, and guessing on
  the operator's behalf is how a dashboard ends up reporting centimetres that were
  never measured.
*/
#define SENSOR_DIGITAL 1  /* float / reed / water-presence switch            */
#define SENSOR_ANALOG 2   /* resistive tape or analog water-level transmitter */
#define SENSOR_PULSE 3    /* HC-SR04 style echo = distance to the surface     */

#define SENSOR_TYPE SENSOR_DIGITAL

#define SENSOR_INPUT_PIN 34  /* SENSOR_DIGITAL or SENSOR_ANALOG */

/* SENSOR_DIGITAL only */
#define SENSOR_DIGITAL_SAMPLES 20
#define SENSOR_DIGITAL_SAMPLE_GAP_MS 50
#define SENSOR_DIGITAL_ACTIVE_LEVEL HIGH  /* or LOW for a switch that pulls down */

/* SENSOR_ANALOG only */
#define SENSOR_ANALOG_SAMPLES 16
#define SENSOR_ANALOG_RESOLUTION_BITS 12

/* SENSOR_PULSE only */
#define SENSOR_TRIGGER_PIN 25
#define SENSOR_ECHO_PIN 23
#define SENSOR_PULSE_SAMPLES 8
#define SENSOR_PULSE_TIMEOUT_US 25000

/* Does this node carry its own GNSS module? Almost every build puts GPS on the */
/* gateway only, in which case leave this 0 and the server keeps the location   */
/* unverified instead of borrowing the gateway's coordinates.                   */
#define SENSOR_HAS_OWN_GPS 0

/* -------------------------------------------------------------- battery  */
/* Set to -1 when the node is USB/mains powered. */
#define BATTERY_SENSING_PIN 35
#define BATTERY_ADC_REFERENCE_V 3.3f
/* Ratio of the divider, e.g. 100k + 100k = 2.0, 100k + 33k = 4.03. */
#define BATTERY_DIVIDER_RATIO 2.0f

/* ---------------------------------------------------------------- timing */
/* Deep-sleep interval between transmissions, in milliseconds. */
#define SEND_INTERVAL_MS 300000UL
/* Give the LoRa stack a moment to finish before powering down. */
#define SEND_SETTLE_MS 250
