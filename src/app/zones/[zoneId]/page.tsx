import Link from "next/link";
import { notFound } from "next/navigation";
import { getZoneDetail } from "@/lib/services/overview";
import { LiveRefresh } from "@/components/live-refresh";
import { LevelDisplay, SectionTitle, SimulatedTag, StatusBadge } from "@/components/ui";
import { formatAgeMinutes, formatCm, formatUtc } from "@/lib/format";
import { ageInMinutes } from "@/lib/health";
import { FLOW_UNAVAILABLE_NOTICE } from "@/lib/status";

export const dynamic = "force-dynamic";

export default async function ZoneDetailPage(props: {
  params: Promise<{ zoneId: string }>;
}) {
  const { zoneId } = await props.params;
  const detail = await getZoneDetail(zoneId);
  if (!detail) notFound();

  const { zone, members } = detail;

  return (
    <div className="space-y-6">
      <LiveRefresh intervalMs={30_000} />

      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold">{zone.name}</h1>
          <StatusBadge status={zone.highestStatus} />
        </div>
        <p className="tabular mt-1 text-sm text-slate-400">
          {zone.zoneId} · centre {zone.centerLatitude.toFixed(5)},{" "}
          {zone.centerLongitude.toFixed(5)} · radius {zone.radiusMeters} m
        </p>
        {zone.localityNote ? (
          <p className="mt-1 text-xs text-slate-500">{zone.localityNote}</p>
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="card p-4">
          <div className="text-xs text-slate-400 uppercase">Sensors in zone</div>
          <div className="tabular mt-1 text-2xl font-semibold">{zone.deviceCount}</div>
        </div>
        <div className="card p-4">
          <div className="text-xs text-slate-400 uppercase">Highest level</div>
          <div className="tabular mt-1 text-2xl font-semibold">
            {zone.hasAnyCalibratedData ? formatCm(zone.highestLevelCm) : "—"}
          </div>
          {!zone.hasAnyCalibratedData ? (
            <div className="text-xs text-sky-300">calibration required</div>
          ) : null}
        </div>
        <div className="card p-4">
          <div className="text-xs text-slate-400 uppercase">Flow</div>
          <div className="mt-1 text-sm">
            {zone.hasFlowData ? "reported by member sensors" : FLOW_UNAVAILABLE_NOTICE}
          </div>
        </div>
        <div className="card p-4">
          <div className="text-xs text-slate-400 uppercase">Last update</div>
          <div className="mt-1 text-sm">{formatAgeMinutes(
            ageInMinutes(zone.lastUpdate, detail.generatedAt),
          )}</div>
          <div className="tabular text-xs text-slate-500">
            {formatUtc(zone.lastUpdate)}
          </div>
        </div>
      </div>

      <section>
        <SectionTitle
          title="Assigned sensors"
          subtitle="Membership is computed from each sensor's verified coordinates against this zone's radius."
          action={
            <Link href="/map" className="text-sm text-cyan-300 hover:underline">
              View on map
            </Link>
          }
        />
        {members.length === 0 ? (
          <div className="card p-6 text-sm text-slate-400">
            No sensors are inside this zone yet. Assign a sensor in the admin console,
            or verify a sensor location within {zone.radiusMeters} m of the centre.
          </div>
        ) : (
          <div className="card divide-y divide-slate-800">
            {members.map((m) => (
              <Link
                key={m.deviceId}
                href={`/sensors/${m.deviceId}`}
                className="flex items-center justify-between gap-4 p-4 hover:bg-slate-800/40"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{m.label}</span>
                    {m.lastReading?.simulated ? <SimulatedTag /> : null}
                  </div>
                  <div className="tabular mt-0.5 text-xs text-slate-400">
                    {m.deviceId} · {m.hasLocation ? "located" : "location unavailable"} ·
                    last report {formatAgeMinutes(m.ageMinutes)}
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  <StatusBadge status={m.effectiveStatus} />
                  <LevelDisplay device={m} />
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
