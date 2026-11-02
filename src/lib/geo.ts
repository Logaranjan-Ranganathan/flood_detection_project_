const EARTH_RADIUS_M = 6_371_008.8;

const toRad = (deg: number) => (deg * Math.PI) / 180;

export interface LatLng {
  latitude: number;
  longitude: number;
}

/** Great-circle distance in metres (Haversine). */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function isValidLatitude(v: number | null | undefined): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= -90 && v <= 90;
}

export function isValidLongitude(v: number | null | undefined): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= -180 && v <= 180;
}

export function hasLocation(
  p: { latitude: number | null; longitude: number | null },
): p is { latitude: number; longitude: number } {
  return isValidLatitude(p.latitude) && isValidLongitude(p.longitude);
}

/**
 * A point is inside a monitoring zone when its great-circle distance to the
 * centre is <= radius. Location-unverified points are never auto-assigned.
 */
export function isWithinZone(
  point: LatLng,
  zone: { centerLatitude: number; centerLongitude: number; radiusMeters: number },
): boolean {
  return (
    haversineMeters(point, {
      latitude: zone.centerLatitude,
      longitude: zone.centerLongitude,
    }) <= zone.radiusMeters
  );
}

export interface ZoneMembership {
  zoneId: string;
  deviceIds: string[];
}

export interface LocationBearing {
  deviceId: string;
  latitude: number | null;
  longitude: number | null;
}

/**
 * Resolve which devices fall inside each 50 m zone.
 *
 * Zones may overlap geographically, so membership is computed per zone and each
 * zone holds a *set* of device ids — a reading is therefore counted once per
 * zone it belongs to, and never duplicated inside a single zone.
 */
export function assignDevicesToZones<T extends LocationBearing>(
  devicesIn: T[],
  zones: {
    zoneId: string;
    centerLatitude: number;
    centerLongitude: number;
    radiusMeters: number;
  }[],
): ZoneMembership[] {
  return zones.map((zone) => {
    const seen = new Set<string>();
    const deviceIds: string[] = [];
    for (const d of devicesIn) {
      if (!hasLocation(d)) continue;
      if (seen.has(d.deviceId)) continue;
      if (isWithinZone({ latitude: d.latitude, longitude: d.longitude }, zone)) {
        seen.add(d.deviceId);
        deviceIds.push(d.deviceId);
      }
    }
    return { zoneId: zone.zoneId, deviceIds };
  });
}

/** Nearest zone for a device, used to suggest a primary assignment. */
export function nearestZone(
  point: LatLng,
  zones: { zoneId: string; centerLatitude: number; centerLongitude: number }[],
): { zoneId: string; distanceMeters: number } | null {
  let best: { zoneId: string; distanceMeters: number } | null = null;
  for (const z of zones) {
    const distanceMeters = haversineMeters(point, {
      latitude: z.centerLatitude,
      longitude: z.centerLongitude,
    });
    if (!best || distanceMeters < best.distanceMeters) {
      best = { zoneId: z.zoneId, distanceMeters };
    }
  }
  return best;
}
