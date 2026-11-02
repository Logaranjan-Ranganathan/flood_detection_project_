import Link from "next/link";
import { getOverview } from "@/lib/services/overview";
import { LiveRefresh } from "@/components/live-refresh";
import { EmptyState, SectionTitle, SimulatedTag, StatusBadge } from "@/components/ui";
import { formatAgeMinutes, formatCm, formatUtc, formatVolts } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function SensorsPage() {
  const overview = await getOverview();

  return (
    <div className="space-y-4">
      <LiveRefresh intervalMs={30_000} />
      <SectionTitle
        title="Sensors"
        subtitle="Every registered water-level node, with its latest packet and radio link."
      />

      {overview.devices.length === 0 ? (
        <EmptyState>Waiting for sensor data — no devices are registered yet.</EmptyState>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-800 text-left text-xs tracking-wide text-slate-400 uppercase">
              <tr>
                <th className="px-4 py-3">Sensor</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Water level</th>
                <th className="px-4 py-3">Flow</th>
                <th className="px-4 py-3">Gateway</th>
                <th className="px-4 py-3">LoRa</th>
                <th className="px-4 py-3">Battery</th>
                <th className="px-4 py-3">Last report</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80">
              {overview.devices.map((d) => (
                <tr key={d.deviceId} className="transition hover:bg-slate-800/30">
                  <td className="px-4 py-3">
                    <Link
                      href={`/sensors/${d.deviceId}`}
                      className="font-medium text-cyan-300 hover:underline"
                    >
                      {d.deviceId}
                    </Link>
                    <div className="text-xs text-slate-500">{d.label}</div>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">
                      {d.lastReading?.simulated ? <SimulatedTag /> : null}
                      {d.calibrationVerified ? null : (
                        <span className="text-sky-300">calibration required</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={d.effectiveStatus} />
                  </td>
                  <td className="tabular px-4 py-3">
                    {d.lastReading
                      ? d.lastReading.calibratedWaterLevelCm !== null
                        ? formatCm(d.lastReading.calibratedWaterLevelCm)
                        : `raw ${d.lastReading.rawSensorValue}`
                      : "—"}
                  </td>
                  <td className="tabular px-4 py-3">
                    {d.flowValue !== null ? `${d.flowValue.toFixed(1)} L/min` : (
                      <span className="text-xs text-slate-500">unavailable</span>
                    )}
                  </td>
                  <td className="tabular px-4 py-3 text-slate-400">
                    {d.gatewayId ?? "—"}
                    <div className="text-xs">{d.zoneIds.join(", ") || "no zone"}</div>
                  </td>
                  <td className="tabular px-4 py-3 text-slate-400">
                    {d.lastReading?.loraRssi !== null && d.lastReading?.loraRssi !== undefined
                      ? `${d.lastReading.loraRssi} dBm`
                      : "—"}
                    <div className="text-xs">
                      {d.lastReading?.loraSnr !== null && d.lastReading?.loraSnr !== undefined
                        ? `SNR ${d.lastReading.loraSnr}`
                        : ""}
                    </div>
                  </td>
                  <td className="tabular px-4 py-3 text-slate-400">
                    {formatVolts(d.lastReading?.batteryVoltage ?? null)}
                  </td>
                  <td className="px-4 py-3 text-slate-400">
                    <div>{formatAgeMinutes(d.ageMinutes)}</div>
                    <div className="text-xs">
                      {formatUtc(d.lastReading?.receivedAt ?? null)}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
