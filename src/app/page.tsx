import Link from "next/link";
import { getOverview } from "@/lib/services/overview";
import { LiveRefresh } from "@/components/live-refresh";
import {
  EmptyState,
  LevelDisplay,
  SectionTitle,
  SimulatedTag,
  StatusBadge,
} from "@/components/ui";
import { formatAgeMinutes, formatUtc } from "@/lib/format";
import { STATUS_LABELS } from "@/lib/status";

export const dynamic = "force-dynamic";

function Stat({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: number | string;
  tone?: string;
  hint?: string;
}) {
  return (
    <div className="card p-4">
      <div className="text-xs tracking-wide text-slate-400 uppercase">{label}</div>
      <div className="tabular mt-1 text-2xl font-semibold" style={{ color: tone }}>
        {value}
      </div>
      {hint ? <div className="mt-1 text-xs text-slate-500">{hint}</div> : null}
    </div>
  );
}

export default async function DashboardPage() {
  const overview = await getOverview();
  const { stats } = overview;
  const anySimulated = overview.devices.some((d) => d.lastReading?.simulated);

  return (
    <div className="space-y-8">
      <LiveRefresh intervalMs={30_000} />

      <section>
        <SectionTitle
          title="FloodGuard"
          subtitle="Community water-level monitoring from LoRa sensors, refreshed from the database on every poll."
          action={
            <div className="text-right text-xs text-slate-400">
              <div>Last successful data update</div>
              <div className="tabular text-sm text-slate-200">
                {formatUtc(overview.lastUpdate)}
              </div>
              <div>{formatAgeMinutes(
                overview.lastUpdate
                  ? Math.max(
                      0,
                      Math.round(
                        (overview.generatedAt.getTime() -
                          overview.lastUpdate.getTime()) /
                        60_000,
                      ),
                    )
                  : null,
              )}</div>
            </div>
          }
        />

        {anySimulated ? (
          <div className="card mb-4 border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
            <span className="font-semibold">Demo mode.</span> Some readings below
            are generated sample data and are labelled <SimulatedTag />. They are
            not measurements of a real flood. Connect the ESP32 hardware to replace
            them.
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Registered sensors" value={stats.totalSensors} />
          <Stat label="Online" value={stats.onlineSensors} tone="#10b981" />
          <Stat label="Offline" value={stats.offlineSensors} tone="#64748b" />
          <Stat label="Warning" value={stats.warningSensors} tone="#f97316" />
          <Stat label="Critical" value={stats.criticalSensors} tone="#dc2626" />
          <Stat label="Monitoring zones" value={stats.zoneCount} tone="#38bdf8" />
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Stale data" value={stats.staleSensors} tone="#a855f7" />
          <Stat label="Needs calibration" value={stats.uncalibratedSensors} tone="#0ea5e9" />
          <Stat
            label="Gateways"
            value={`${stats.onlineGateways}/${stats.gatewayCount}`}
            hint="online / registered"
          />
          <Stat label="Open alerts" value={stats.activeAlerts} tone="#f97316" />
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-5">
        <section className="lg:col-span-3">
          <SectionTitle
            title="Latest reported water levels"
            action={
              <Link href="/sensors" className="text-sm text-cyan-300 hover:underline">
                All sensors
              </Link>
            }
          />
          {overview.devices.length === 0 ? (
            <EmptyState>
              No sensors are registered yet. Waiting for sensor data — register a
              device in the admin console, then point your ESP32 gateway at
              <code className="mx-1 rounded bg-slate-800 px-1">POST /api/v1/devices/readings</code>.
            </EmptyState>
          ) : (
            <div className="card divide-y divide-slate-800">
              {overview.devices.map((device) => (
                <Link
                  key={device.deviceId}
                  href={`/sensors/${device.deviceId}`}
                  className="flex items-center justify-between gap-4 p-4 transition hover:bg-slate-800/40"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{device.label}</span>
                      {device.lastReading?.simulated ? <SimulatedTag /> : null}
                    </div>
                    <div className="tabular mt-0.5 text-xs text-slate-400">
                      {device.deviceId} · {device.gatewayId ?? "no gateway"} ·{" "}
                      {device.zoneIds.join(", ") || "no zone"}
                    </div>
                    <div className="mt-0.5 text-xs text-slate-500">
                      last report {formatAgeMinutes(device.ageMinutes)}
                      {device.hasLocation ? "" : " · location unavailable"}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <StatusBadge status={device.effectiveStatus} />
                    <LevelDisplay device={device} />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>

        <section className="lg:col-span-2">
          <SectionTitle
            title="Latest alerts"
            action={
              <Link href="/alerts" className="text-sm text-cyan-300 hover:underline">
                All alerts
              </Link>
            }
          />
          {overview.alerts.length === 0 ? (
            <EmptyState>No open alerts.</EmptyState>
          ) : (
            <ul className="card divide-y divide-slate-800">
              {overview.alerts.slice(0, 8).map((alert) => (
                <li key={alert.alertId} className="p-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="text-sm">{alert.message}</div>
                    <StatusBadge status={alert.severity} />
                  </div>
                  <div className="tabular mt-1 text-xs text-slate-500">
                    {STATUS_LABELS[alert.alertType as keyof typeof STATUS_LABELS] ??
                      alert.alertType}{" "}
                    · {formatUtc(alert.createdAt)}
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-4">
            <SectionTitle title="Monitoring zones" />
            <div className="grid gap-3 sm:grid-cols-2">
              {overview.zones.map((zone) => (
                <Link
                  key={zone.zoneId}
                  href={`/zones/${zone.zoneId}`}
                  className="card p-3.5 transition hover:border-cyan-500/50"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="tabular text-xs text-slate-400">{zone.zoneId}</span>
                    <StatusBadge status={zone.highestStatus} />
                  </div>
                  <div className="mt-1 truncate text-sm font-medium">{zone.name}</div>
                  <div className="mt-1 text-xs text-slate-500">
                    {zone.deviceCount} sensor{zone.deviceCount === 1 ? "" : "s"} ·{" "}
                    {zone.radiusMeters} m radius
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
