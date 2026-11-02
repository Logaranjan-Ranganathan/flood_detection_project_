import Link from "next/link";
import { getOverview } from "@/lib/services/overview";
import { LiveRefresh } from "@/components/live-refresh";
import { EmptyState, SectionTitle, StatusBadge } from "@/components/ui";
import { formatAgeMinutes, formatCm } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ZonesPage() {
  const overview = await getOverview();
  const ageOf = (d: Date | null) =>
    formatAgeMinutes(
      d ? Math.max(0, Math.round((overview.generatedAt.getTime() - d.getTime()) / 60_000)) : null,
    );

  return (
    <div className="space-y-4">
      <LiveRefresh intervalMs={30_000} />
      <SectionTitle
        title="Monitoring zones"
        subtitle="50-metre observation circles around each configured monitoring point."
      />

      <div className="card border-sky-500/30 bg-sky-500/5 p-3 text-sm text-sky-200">
        These are IoT monitoring zones, not administrative wards. A sensor inside
        overlapping zones is counted once per zone, and its reading is never
        duplicated between them.
      </div>

      {overview.zones.length === 0 ? (
        <EmptyState>No monitoring zones configured yet.</EmptyState>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {overview.zones.map((zone) => (
            <Link
              key={zone.zoneId}
              href={`/zones/${zone.zoneId}`}
              className="card p-4 transition hover:border-cyan-500/50"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="tabular text-xs text-slate-400">{zone.zoneId}</div>
                  <div className="mt-0.5 font-medium">{zone.name}</div>
                </div>
                <StatusBadge status={zone.highestStatus} />
              </div>

              <dl className="mt-3 space-y-1 text-sm">
                <div className="flex justify-between">
                  <dt className="text-slate-400">Sensors</dt>
                  <dd className="tabular">{zone.deviceCount}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-400">Highest level</dt>
                  <dd className="tabular">
                    {zone.hasAnyCalibratedData ? formatCm(zone.highestLevelCm) : "uncalibrated"}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-400">Flow</dt>
                  <dd className="text-xs">
                    {zone.hasFlowData ? "reported" : "unavailable"}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-400">Last update</dt>
                  <dd>{ageOf(zone.lastUpdate)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-400">Centre</dt>
                  <dd className="tabular text-xs">
                    {zone.centerLatitude.toFixed(5)}, {zone.centerLongitude.toFixed(5)}
                  </dd>
                </div>
              </dl>

              {zone.containsSimulatedOnly ? (
                <div className="mt-3 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-xs text-amber-200">
                  Contains simulated demo data only
                </div>
              ) : null}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
