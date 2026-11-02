/** Shared vocabulary for flood severity and data health. */

export const LEVEL_STATUSES = [
  "NORMAL",
  "WATCH",
  "WARNING",
  "CRITICAL",
  "CALIBRATION_REQUIRED",
] as const;
export type LevelStatus = (typeof LEVEL_STATUSES)[number];

export const HEALTH_STATUSES = ["ONLINE", "STALE", "OFFLINE"] as const;
export type HealthStatus = (typeof HEALTH_STATUSES)[number];

/** The seven classifications the UI is allowed to show. */
export const EFFECTIVE_STATUSES = [
  "NORMAL",
  "WATCH",
  "WARNING",
  "CRITICAL",
  "SENSOR_OFFLINE",
  "DATA_STALE",
  "CALIBRATION_REQUIRED",
] as const as unknown as readonly string[];

export type EffectiveStatus =
  | LevelStatus
  | "SENSOR_OFFLINE"
  | "DATA_STALE";

export type DataQuality =
  | "OK"
  | "UNCALIBRATED"
  | "LOCATION_UNAVAILABLE"
  | "FLOW_NOT_SUPPORTED"
  | "OUT_OF_RANGE"
  | "SUSPECT_JUMP";

/** Ordering used to pick a zone's highest reported severity. */
export const SEVERITY_RANK: Record<string, number> = {
  NORMAL: 0,
  CALIBRATION_REQUIRED: 1,
  WATCH: 2,
  DATA_STALE: 3,
  WARNING: 4,
  SENSOR_OFFLINE: 5,
  CRITICAL: 6,
};

export interface Thresholds {
  watchCm: number;
  warningCm: number;
  criticalCm: number;
}

export interface HealthWindow {
  /** Minutes without a packet before a sensor is considered stale. */
  staleAfterMinutes: number;
  /** Minutes without a packet before a sensor is considered offline. */
  offlineAfterMinutes: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  watchCm: 15,
  warningCm: 30,
  criticalCm: 50,
};

export const DEFAULT_HEALTH_WINDOW: HealthWindow = {
  staleAfterMinutes: 30,
  offlineAfterMinutes: 120,
};

export const DEFAULT_MONITORING_ZONE_RADIUS_M = 50;

export const STATUS_LABELS: Record<EffectiveStatus, string> = {
  NORMAL: "Normal",
  WATCH: "Watch",
  WARNING: "Warning",
  CRITICAL: "Critical",
  SENSOR_OFFLINE: "Sensor offline",
  DATA_STALE: "Data stale",
  CALIBRATION_REQUIRED: "Calibration required",
};

export const RAW_READING_NOTICE = "Raw sensor reading — calibration required.";
export const FLOW_UNAVAILABLE_NOTICE =
  "Flow data unavailable — additional sensor or validated model required.";
export const LOCATION_UNAVAILABLE_NOTICE = "Location unavailable";
export const WAITING_FOR_DATA_NOTICE = "Waiting for sensor data";
