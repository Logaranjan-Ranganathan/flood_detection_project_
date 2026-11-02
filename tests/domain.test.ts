import { describe, expect, it } from "vitest";
import {
  calibrateRawToCm,
  classifyLevel,
  effectiveStatus,
  isPlausibleWaterLevel,
} from "@/lib/calibration";
import {
  assignDevicesToZones,
  haversineMeters,
  isWithinZone,
  nearestZone,
} from "@/lib/geo";
import { buildDedupeKey, healthFromLastSeen } from "@/lib/health";
import { DEFAULT_THRESHOLDS } from "@/lib/status";

const CALIB = { zeroRaw: 200, spanRaw: 1000, referenceCm: 40, verified: true };

describe("calibration", () => {
  it("maps the two calibration points exactly", () => {
    expect(calibrateRawToCm(200, CALIB)).toBe(0);
    expect(calibrateRawToCm(1000, CALIB)).toBe(40);
  });

  it("interpolates between them", () => {
    expect(calibrateRawToCm(600, CALIB)).toBe(20);
    expect(calibrateRawToCm(812, CALIB)).toBeCloseTo(30.6, 1);
  });

  it("returns null until calibration is verified — a raw count is not a depth", () => {
    expect(calibrateRawToCm(812, { ...CALIB, verified: false })).toBeNull();
    expect(
      calibrateRawToCm(812, { zeroRaw: null, spanRaw: 1000, referenceCm: 40, verified: true }),
    ).toBeNull();
  });

  it("refuses a degenerate span instead of dividing by zero", () => {
    expect(
      calibrateRawToCm(500, { zeroRaw: 300, spanRaw: 300, referenceCm: 40, verified: true }),
    ).toBeNull();
  });
});

describe("classification", () => {
  const t = DEFAULT_THRESHOLDS; // watch 15, warning 30, critical 50

  it("uses inclusive lower bounds per band", () => {
    expect(classifyLevel(14.9, t)).toBe("NORMAL");
    expect(classifyLevel(15, t)).toBe("WATCH");
    expect(classifyLevel(30, t)).toBe("WARNING");
    expect(classifyLevel(50, t)).toBe("CRITICAL");
    expect(classifyLevel(500, t)).toBe("CRITICAL");
  });

  it("never invents a severity for an uncalibrated sensor", () => {
    expect(classifyLevel(null, t)).toBe("CALIBRATION_REQUIRED");
    expect(classifyLevel(Number.NaN, t)).toBe("CALIBRATION_REQUIRED");
  });

  it("honours admin-configured thresholds", () => {
    const raised = { watchCm: 40, warningCm: 80, criticalCm: 120 };
    expect(classifyLevel(60, raised)).toBe("WATCH");
    expect(classifyLevel(60, t)).toBe("CRITICAL");
    expect(classifyLevel(30, raised)).toBe("NORMAL");
  });

  it("lets communication loss outrank the water level", () => {
    expect(effectiveStatus("NORMAL", "OFFLINE")).toBe("SENSOR_OFFLINE");
    expect(effectiveStatus("CRITICAL", "STALE")).toBe("DATA_STALE");
    expect(effectiveStatus("WARNING", "ONLINE")).toBe("WARNING");
  });

  it("flags implausible levels", () => {
    expect(isPlausibleWaterLevel(3000)).toBe(true);
    expect(isPlausibleWaterLevel(50_000)).toBe(false);
    expect(isPlausibleWaterLevel(null)).toBe(true);
  });
});

describe("geography", () => {
  const a = { latitude: 6.9271, longitude: 79.8612 };

  it("measures short distances realistically", () => {
    // ~0.00045 deg latitude is roughly 50 m at the equator scale.
    const fifty = haversineMeters(a, { latitude: 6.92755, longitude: 79.8612 });
    expect(fifty).toBeGreaterThan(40);
    expect(fifty).toBeLessThan(60);
  });

  it("treats a point 5 m away as inside a 50 m zone and 500 m away as outside", () => {
    const near = { centerLatitude: 6.9271, centerLongitude: 79.8612, radiusMeters: 50 };
    expect(
      isWithinZone({ latitude: 6.92714, longitude: 79.8612 }, near),
    ).toBe(true);
    expect(
      isWithinZone({ latitude: 6.9316, longitude: 79.8612 }, near),
    ).toBe(false);
  });

  it("counts a device in every overlapping zone but never twice in one", () => {
    const zones = [
      { zoneId: "FG-ZONE-001", centerLatitude: 6.9271, centerLongitude: 79.8612, radiusMeters: 50 },
      // Overlapping neighbour: same point, so both circles contain the sensor.
      { zoneId: "FG-ZONE-002", centerLatitude: 6.9272, centerLongitude: 79.8613, radiusMeters: 50 },
    ];
    const devices = [
      { deviceId: "FG-SENSOR-001", latitude: 6.92712, longitude: 79.86122 },
    ];
    const membership = assignDevicesToZones(devices, zones);
    expect(membership.map((m) => m.zoneId)).toEqual(["FG-ZONE-001", "FG-ZONE-002"]);
    expect(membership[0].deviceIds).toEqual(["FG-SENSOR-001"]);
    expect(membership[1].deviceIds).toEqual(["FG-SENSOR-001"]);
    expect(new Set(membership[0].deviceIds).size).toBe(membership[0].deviceIds.length);
  });

  it("will not place a sensor with no verified coordinates", () => {
    const membership = assignDevicesToZones(
      [{ deviceId: "FG-SENSOR-005", latitude: null, longitude: null }],
      [
        { zoneId: "FG-ZONE-001", centerLatitude: 6.9271, centerLongitude: 79.8612, radiusMeters: 50 },
      ],
    );
    expect(membership[0].deviceIds).toEqual([]);
  });

  it("ignores duplicate device rows", () => {
    const membership = assignDevicesToZones(
      [
        { deviceId: "FG-SENSOR-001", latitude: 6.92712, longitude: 79.86122 },
        { deviceId: "FG-SENSOR-001", latitude: 6.92712, longitude: 79.86122 },
      ],
      [
        { zoneId: "FG-ZONE-001", centerLatitude: 6.9271, centerLongitude: 79.8612, radiusMeters: 50 },
      ],
    );
    expect(membership[0].deviceIds).toEqual(["FG-SENSOR-001"]);
  });

  it("finds the nearest zone centre", () => {
    const nearest = nearestZone(a, [
      { zoneId: "FG-ZONE-003", centerLatitude: 6.9006, centerLongitude: 79.8558 },
      { zoneId: "FG-ZONE-001", centerLatitude: 6.92715, centerLongitude: 79.86125 },
    ]);
    expect(nearest?.zoneId).toBe("FG-ZONE-001");
  });
});

describe("health and duplicate detection", () => {
  const window = { staleAfterMinutes: 30, offlineAfterMinutes: 120 };
  const now = new Date("2026-11-02T12:00:00Z");

  it("classifies a silent sensor as stale then offline", () => {
    expect(healthFromLastSeen(new Date(now.getTime() - 5 * 60_000), now, window)).toBe("ONLINE");
    expect(healthFromLastSeen(new Date(now.getTime() - 31 * 60_000), now, window)).toBe("STALE");
    expect(healthFromLastSeen(new Date(now.getTime() - 121 * 60_000), now, window)).toBe("OFFLINE");
    expect(healthFromLastSeen(null, now, window)).toBe("OFFLINE");
  });

  it("treats a clock ahead of the server as untrustworthy, not fresh", () => {
    expect(healthFromLastSeen(new Date(now.getTime() + 90 * 60_000), now, window)).toBe("STALE");
  });

  it("recognises a retransmission of the same packet", () => {
    const reported = new Date("2026-11-02T11:58:00Z");
    const first = buildDedupeKey({
      deviceId: "FG-SENSOR-001",
      packetSequence: 42,
      deviceReportedAt: reported,
      receivedAt: new Date("2026-11-02T11:58:04Z"),
    });
    const resent = buildDedupeKey({
      deviceId: "FG-SENSOR-001",
      packetSequence: 42,
      deviceReportedAt: reported,
      receivedAt: new Date("2026-11-02T11:58:31Z"),
    });
    const nextPacket = buildDedupeKey({
      deviceId: "FG-SENSOR-001",
      packetSequence: 43,
      deviceReportedAt: reported,
      receivedAt: new Date("2026-11-02T11:58:04Z"),
    });
    expect(first).toBe(resent);
    expect(first).not.toBe(nextPacket);
  });

  it("does not collide across devices or after a reboot without sequence numbers", () => {
    const at = new Date("2026-11-02T11:58:20Z");
    const base = { deviceReportedAt: null, receivedAt: at };
    expect(
      buildDedupeKey({ ...base, deviceId: "FG-SENSOR-001", packetSequence: null }),
    ).not.toBe(buildDedupeKey({ ...base, deviceId: "FG-SENSOR-002", packetSequence: null }));
    expect(
      buildDedupeKey({ ...base, deviceId: "FG-SENSOR-001", packetSequence: 7 }),
    ).not.toBe(buildDedupeKey({ ...base, deviceId: "FG-SENSOR-001", packetSequence: null }));
  });
});
