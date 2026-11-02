"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import type {
  MapGateway,
  MapSensor,
  MapZone,
} from "@/components/map-view";
import { SectionTitle } from "@/components/ui";

const MapView = dynamic(() => import("@/components/map-view"), {
  ssr: false,
  loading: () => (
    <div className="card flex h-[600px] items-center justify-center text-sm text-slate-400">
      Loading map…
    </div>
  ),
});

interface OverviewResponse {
  ok: boolean;
  devices: {
    deviceId: string;
    label: string;
    latitude: number | null;
    longitude: number | null;
    hasLocation: boolean;
    effectiveStatus: string;
    lastReading: {
      calibratedWaterLevelCm: number | null;
      rawSensorValue: number;
      receivedAt: string;
      simulated: boolean;
    } | null;
    zoneIds: string[];
  }[];
  zones: {
    zoneId: string;
    name: string;
    centerLatitude: number;
    centerLongitude: number;
    radiusMeters: number;
    highestStatus: string;
    deviceCount: number;
  }[];
  gateways: {
    gatewayId: string;
    name: string;
    latitude: number | null;
    longitude: number | null;
    status: string;
  }[];
}

export default function MapPage() {
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch("/api/v1/public/overview", { cache: "no-store" });
        const json = (await res.json()) as OverviewResponse;
        if (!cancelled && json.ok) setData(json);
        if (!cancelled) setError(null);
      } catch {
        if (!cancelled) setError("Could not reach the FloodGuard API");
      }
    }

    load();
    const id = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const sensors: MapSensor[] = (data?.devices ?? []).map((d) => ({
    deviceId: d.deviceId,
    label: d.label,
    latitude: d.latitude,
    longitude: d.longitude,
    hasLocation: d.hasLocation,
    effectiveStatus: d.effectiveStatus,
    calibratedWaterLevelCm: d.lastReading?.calibratedWaterLevelCm ?? null,
    rawSensorValue: d.lastReading?.rawSensorValue ?? null,
    receivedAt: d.lastReading?.receivedAt ?? null,
    zoneIds: d.zoneIds,
    simulated: d.lastReading?.simulated ?? false,
  }));

  const zones: MapZone[] = (data?.zones ?? []).map((z) => ({
    zoneId: z.zoneId,
    name: z.name,
    centerLatitude: z.centerLatitude,
    centerLongitude: z.centerLongitude,
    radiusMeters: z.radiusMeters,
    highestStatus: z.highestStatus,
    deviceCount: z.deviceCount,
  }));

  const gateways: MapGateway[] = (data?.gateways ?? []).map((g) => ({
    gatewayId: g.gatewayId,
    name: g.name,
    latitude: g.latitude,
    longitude: g.longitude,
    status: g.status,
  }));

  return (
    <div className="space-y-4">
      <SectionTitle
        title="Live flood map"
        subtitle="Sensor positions, gateway position and 50-metre monitoring zones. Refreshes every 30 seconds from the database."
      />

      {error ? (
        <div className="card border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">
          {error}
        </div>
      ) : null}

      {!data && !error ? (
        <div className="card p-6 text-sm text-slate-400">Waiting for sensor data…</div>
      ) : null}

      {data ? (
        <>
          <MapView zones={zones} sensors={sensors} gateways={gateways} />
          <p className="text-xs text-slate-500">
            Zones are drawn from each monitoring point&rsquo;s coordinates with a
            50 m radius. They are observation areas, not administrative wards. A
            sensor without verified coordinates is deliberately left off the map
            rather than shown at the gateway&rsquo;s position.
          </p>
        </>
      ) : null}
    </div>
  );
}
