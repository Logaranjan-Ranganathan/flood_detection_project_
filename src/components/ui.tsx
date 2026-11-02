import type { EffectiveStatus } from "@/lib/status";
import {
  FLOW_UNAVAILABLE_NOTICE,
  RAW_READING_NOTICE,
  STATUS_LABELS,
} from "@/lib/status";
import type { DeviceSnapshot } from "@/lib/views";

export const STATUS_COLOR: Record<string, string> = {
  NORMAL: "#10b981",
  WATCH: "#eab308",
  WARNING: "#f97316",
  CRITICAL: "#dc2626",
  SENSOR_OFFLINE: "#64748b",
  DATA_STALE: "#a855f7",
  CALIBRATION_REQUIRED: "#0ea5e9",
  NO_DATA: "#94a3b8",
  INFO: "#0ea5e9",
  GATEWAY_OFFLINE: "#64748b",
};

/** Alert severities are not water-level statuses, so they need their own words. */
const SEVERITY_LABELS: Record<string, string> = {
  INFO: "Information",
};

export function StatusBadge({
  status,
  className = "",
}: {
  status: EffectiveStatus | "NO_DATA" | string;
  className?: string;
}) {
  const color = STATUS_COLOR[status] ?? "#94a3b8";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap ${className}`}
      style={{ borderColor: `${color}66`, color, background: `${color}14` }}
    >
      <span
        className="inline-block size-1.5 rounded-full"
        style={{ background: color }}
      />
      {SEVERITY_LABELS[status] ?? STATUS_LABELS[status as EffectiveStatus] ?? status}
    </span>
  );
}

export function SimulatedTag() {
  return (
    <span
      className="rounded border border-amber-400/50 bg-amber-400/10 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-amber-300 uppercase"
      title="This value was generated for the demo mode, not measured by hardware"
    >
      Simulated
    </span>
  );
}

/**
 * Never present a raw count as a depth. Calibrated devices show centimetres;
 * everything else shows the raw value with the calibration notice.
 */
export function LevelDisplay({ device }: { device: DeviceSnapshot }) {
  const reading = device.lastReading;
  if (!reading) {
    return (
      <div className="text-sm text-slate-400">
        Waiting for sensor data
      </div>
    );
  }
  if (reading.calibratedWaterLevelCm === null) {
    return (
      <div>
        <div className="tabular text-lg font-semibold">
          raw {reading.rawSensorValue}
        </div>
        <div className="text-xs text-sky-300">{RAW_READING_NOTICE}</div>
      </div>
    );
  }
  return (
    <div>
      <div className="tabular text-lg font-semibold">
        {reading.calibratedWaterLevelCm.toFixed(1)} cm
      </div>
      <div className="text-xs text-slate-400">
        raw {reading.rawSensorValue}
      </div>
    </div>
  );
}

export function FlowDisplay({ device }: { device: DeviceSnapshot }) {
  if (device.flowValue === null) {
    return <div className="text-sm text-slate-400">{FLOW_UNAVAILABLE_NOTICE}</div>;
  }
  return (
    <div>
      <div className="tabular text-lg font-semibold">
        {device.flowValue.toFixed(1)} L/min
      </div>
      <div className="text-xs text-slate-400">
        Measured by a flow sensor fitted to this node
      </div>
    </div>
  );
}

export function SectionTitle({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        {subtitle ? <p className="text-sm text-slate-400">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="card p-6 text-sm text-slate-400">{children}</div>
  );
}
