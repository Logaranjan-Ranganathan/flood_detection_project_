import Link from "next/link";
import { notFound } from "next/navigation";
import { getSensorDetail } from "@/lib/services/overview";
import { LiveRefresh } from "@/components/live-refresh";
import { FlowChart, WaterLevelChart } from "@/components/charts";
import {
  FlowDisplay,
  LevelDisplay,
  SectionTitle,
  SimulatedTag,
  StatusBadge,
} from "@/components/ui";
import { formatAgeMinutes, formatUtc, formatVolts } from "@/lib/format";
import { FLOW_UNAVAILABLE_NOTICE, RAW_READING_NOTICE } from "@/lib/status";

export const dynamic = "force-dynamic";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-slate-800/80 py-2.5 last:border-0">
      <div className="text-xs tracking-wide text-slate-400 uppercase">{label}</div>
      <div className="tabular mt-0.5 text-sm">{children}</div>
    </div>
  );
}

export default async function SensorDetailPage(
  props: {
    params: Promise<{ deviceId: string }>;
    searchParams: Promise<{ hours?: string }>;
  },
) {
  const { deviceId } = await props.params;
  const sp = await props.searchParams;
  const hours = Math.min(Math.max(Number(sp.hours ?? 24) || 24, 1), 24 * 30);

  const detail = await getSensorDetail(deviceId, hours);
  if (!detail) notFound();

  const d = detail.snapshot;
  const history = detail.history.map((h) => ({
    receivedAt: h.receivedAt.toISOString(),
    rawSensorValue: h.rawSensorValue,
    calibratedWaterLevelCm: h.calibratedWaterLevelCm,
    waterFlowLpm: h.waterFlowLpm,
  }));

  return (
    <div className="space-y-6">
      <LiveRefresh intervalMs={30_000} />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold">{d.label}</h1>
            <StatusBadge status={d.effectiveStatus} />
            {d.lastReading?.simulated ? <SimulatedTag /> : null}
          </div>
          <p className="tabular mt-1 text-sm text-slate-400">
            {d.deviceId} · gateway {d.gatewayId ?? "not assigned"} ·{" "}
            {d.zoneIds.join(", ") || "no monitoring zone"}
          </p>
        </div>
        <div className="flex gap-2 text-sm">
          {[6, 24, 72, 168].map((h) => (
            <Link
              key={h}
              href={`/sensors/${d.deviceId}?hours=${h}`}
              className={`rounded-lg border px-3 py-1.5 text-xs ${
                hours === h
                  ? "border-cyan-500/60 bg-cyan-500/15 text-cyan-200"
                  : "border-slate-700 text-slate-400 hover:text-slate-200"
              }`}
            >
              {h === 168 ? "7 d" : h === 24 ? "24 h" : `${h} h`}
            </Link>
          ))}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          <div className="card p-4">
            <SectionTitle
              title="Historical water level"
              subtitle={
                d.calibrationVerified
                  ? "Calibrated centimetres derived from stored raw counts."
                  : RAW_READING_NOTICE
              }
            />
            {history.length ? (
              <WaterLevelChart data={history} />
            ) : (
              <p className="py-8 text-center text-sm text-slate-400">
                Waiting for sensor data — no readings in this window.
              </p>
            )}
          </div>

          <div className="card p-4">
            <SectionTitle
              title="Historical flow"
              subtitle={
                d.flowSupported
                  ? "Measured litres per minute from a flow sensor on this node."
                  : FLOW_UNAVAILABLE_NOTICE
              }
            />
            <FlowChart data={history} />
          </div>
        </div>

        <div className="space-y-4">
          <div className="card p-4">
            <SectionTitle title="Current reading" />
            <LevelDisplay device={d} />
            <div className="mt-3">
              <FlowDisplay device={d} />
            </div>
          </div>

          <div className="card px-4 py-2">
            <Field label="Flood status">
              <StatusBadge status={d.effectiveStatus} />
            </Field>
            <Field label="Last communication">
              {formatAgeMinutes(d.ageMinutes)}
              <div className="text-xs text-slate-500">
                {formatUtc(d.lastReading?.receivedAt ?? null)}
              </div>
            </Field>
            <Field label="LoRa link">
              {d.lastReading?.loraRssi !== null && d.lastReading?.loraRssi !== undefined
                ? `RSSI ${d.lastReading.loraRssi} dBm`
                : "not reported"}
              <div className="text-xs text-slate-500">
                {d.lastReading?.loraSnr !== null && d.lastReading?.loraSnr !== undefined
                  ? `SNR ${d.lastReading.loraSnr} dB`
                  : ""}
              </div>
            </Field>
            <Field label="Battery">
              {formatVolts(d.lastReading?.batteryVoltage ?? null)}
            </Field>
            <Field label="Packet sequence">
              {d.lastReading?.packetSequence ?? "—"}
            </Field>
            <Field label="Firmware">{d.firmwareVersion ?? "unknown"}</Field>
            <Field label="Location">
              {d.hasLocation ? (
                <>
                  {d.latitude?.toFixed(5)}, {d.longitude?.toFixed(5)}
                  <div className="text-xs text-slate-500">
                    source {d.locationSource} · verified
                  </div>
                </>
              ) : (
                <span className="text-amber-300">Location unavailable</span>
              )}
            </Field>
            <Field label="Data quality">
              {d.lastReading?.dataQuality ?? "NO_DATA"}
              <div className="text-xs text-slate-500">
                {d.calibrationVerified
                  ? "calibrated"
                  : "no calibration on file"}
              </div>
            </Field>
            <Field label="Stored readings">{detail.historyCount}</Field>
          </div>

          {d.notices.length ? (
            <ul className="card space-y-2 p-4 text-sm">
              {d.notices.map((notice) => (
                <li key={notice} className="text-slate-300">
                  • {notice}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </div>
  );
}
