"use client";

import "leaflet/dist/leaflet.css";
import {
  Circle,
  CircleMarker,
  MapContainer,
  Popup,
  TileLayer,
  Tooltip,
  useMap,
} from "react-leaflet";
import { STATUS_COLOR } from "./ui";

export interface MapZone {
  zoneId: string;
  name: string;
  centerLatitude: number;
  centerLongitude: number;
  radiusMeters: number;
  highestStatus: string;
  deviceCount: number;
}

export interface MapSensor {
  deviceId: string;
  label: string;
  latitude: number | null;
  longitude: number | null;
  hasLocation: boolean;
  effectiveStatus: string;
  calibratedWaterLevelCm: number | null;
  rawSensorValue: number | null;
  receivedAt: string | null;
  zoneIds: string[];
  simulated: boolean;
}

export interface MapGateway {
  gatewayId: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  status: string;
}

function FitToData({ points }: { points: [number, number][] }) {
  const map = useMap();
  if (points.length) {
    map.fitBounds(points, { padding: [48, 48], maxZoom: 16 });
  }
  return null;
}

function levelText(s: MapSensor): string {
  if (s.calibratedWaterLevelCm !== null) {
    return `${s.calibratedWaterLevelCm.toFixed(1)} cm (raw ${s.rawSensorValue})`;
  }
  if (s.rawSensorValue !== null) {
    return `raw ${s.rawSensorValue} — calibration required`;
  }
  return "Waiting for sensor data";
}

export function MapView({
  zones,
  sensors,
  gateways,
}: {
  zones: MapZone[];
  sensors: MapSensor[];
  gateways: MapGateway[];
}) {
  const placed = sensors.filter((s) => s.hasLocation && s.latitude && s.longitude);
  const unplaced = sensors.filter(
    (s) => !(s.hasLocation && s.latitude && s.longitude),
  );

  const points: [number, number][] = [
    ...placed.map((s) => [s.latitude as number, s.longitude as number] as [number, number]),
    ...zones.map((z) => [z.centerLatitude, z.centerLongitude] as [number, number]),
    ...gateways
      .filter((g) => g.latitude !== null && g.longitude !== null)
      .map((g) => [g.latitude as number, g.longitude as number] as [number, number]),
  ];

  const center: [number, number] = points.length
    ? [
        points.reduce((a, p) => a + p[0], 0) / points.length,
        points.reduce((a, p) => a + p[1], 0) / points.length,
      ]
    : [6.9271, 79.8612];

  return (
    <div className="card overflow-hidden">
      <MapContainer
        center={center}
        zoom={14}
        className="h-[600px] w-full"
        scrollWheelZoom
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {/* 50 m observation zones. Not administrative wards. */}
        {zones.map((zone) => (
          <Circle
            key={zone.zoneId}
            center={[zone.centerLatitude, zone.centerLongitude]}
            radius={zone.radiusMeters}
            pathOptions={{
              color: STATUS_COLOR[zone.highestStatus] ?? "#38bdf8",
              weight: 1.5,
              fillColor: STATUS_COLOR[zone.highestStatus] ?? "#38bdf8",
              fillOpacity: 0.12,
              dashArray: "4 4",
            }}
          >
            <Tooltip direction="top" offset={[0, -6]}>
              {zone.zoneId} · {zone.name} · r={zone.radiusMeters} m
            </Tooltip>
            <Popup>
              <div className="space-y-1 text-xs">
                <div className="font-semibold">{zone.zoneId}</div>
                <div>{zone.name}</div>
                <div>
                  Centre {zone.centerLatitude.toFixed(5)}, {zone.centerLongitude.toFixed(5)}
                </div>
                <div>Radius {zone.radiusMeters} m</div>
                <div>Sensors in zone {zone.deviceCount}</div>
                <div>Highest severity {zone.highestStatus}</div>
                <div className="text-amber-300">
                  Monitoring zone only — not an official ward boundary.
                </div>
              </div>
            </Popup>
          </Circle>
        ))}

        {placed.map((s) => (
          <CircleMarker
            key={s.deviceId}
            center={[s.latitude as number, s.longitude as number]}
            radius={8}
            pathOptions={{
              color: "#0b1220",
              weight: 1.5,
              fillColor: STATUS_COLOR[s.effectiveStatus] ?? "#94a3b8",
              fillOpacity: 0.95,
            }}
          >
            <Tooltip direction="right" offset={[8, 0]}>
              {s.deviceId} · {levelText(s)}
            </Tooltip>
            <Popup>
              <div className="space-y-1 text-xs">
                <div className="font-semibold">{s.deviceId}</div>
                <div>{s.label}</div>
                <div>{s.effectiveStatus}</div>
                <div>{levelText(s)}</div>
                <div>Zones: {s.zoneIds.join(", ") || "none"}</div>
                <div>
                  Last report: {s.receivedAt ? new Date(s.receivedAt).toLocaleString() : "never"}
                </div>
                {s.simulated ? (
                  <div className="text-amber-300">SIMULATED demo reading</div>
                ) : null}
              </div>
            </Popup>
          </CircleMarker>
        ))}

        {gateways.map((g) =>
          g.latitude !== null && g.longitude !== null ? (
            <CircleMarker
              key={g.gatewayId}
              center={[g.latitude, g.longitude]}
              radius={10}
              pathOptions={{
                color: "#e2e8f0",
                weight: 2,
                fillColor: g.status === "ONLINE" ? "#22d3ee" : "#64748b",
                fillOpacity: 0.9,
              }}
            >
              <Tooltip direction="bottom" offset={[0, 10]} permanent={false}>
                {g.gatewayId} (gateway)
              </Tooltip>
              <Popup>
                <div className="space-y-1 text-xs">
                  <div className="font-semibold">{g.gatewayId}</div>
                  <div>{g.name}</div>
                  <div>Status: {g.status}</div>
                  <div className="text-sky-300">
                    GPS coordinates belong to the gateway, not to its remote sensors.
                  </div>
                </div>
              </Popup>
            </CircleMarker>
          ) : null,
        )}

        <FitToData points={points} />
      </MapContainer>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-slate-700/70 px-4 py-3 text-xs text-slate-400">
        {Object.entries(STATUS_COLOR)
          .filter(([k]) => k !== "NO_DATA")
          .map(([label, color]) => (
            <span key={label} className="inline-flex items-center gap-1.5">
              <span
                className="inline-block size-2.5 rounded-full"
                style={{ background: color }}
              />
              {label.replaceAll("_", " ").toLowerCase()}
            </span>
          ))}
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block size-3 rounded-full border border-white bg-cyan-400" />
          gateway
        </span>
        <span className="ml-auto">
          Dashed circles are 50 m monitoring zones, not administrative wards
        </span>
      </div>

      {unplaced.length ? (
        <div className="border-t border-slate-700/70 px-4 py-3 text-xs text-slate-400">
          <span className="font-medium text-slate-300">
            Location unavailable
          </span>{" "}
          — {unplaced.length} sensor{unplaced.length === 1 ? "" : "s"} not shown on
          the map until coordinates are verified: {unplaced.map((s) => s.deviceId).join(", ")}
        </div>
      ) : null}
    </div>
  );
}

export default MapView;
