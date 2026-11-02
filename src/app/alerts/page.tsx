import { listAlerts } from "@/db/repo";
import { LiveRefresh } from "@/components/live-refresh";
import { EmptyState, SectionTitle, StatusBadge } from "@/components/ui";
import { formatUtc } from "@/lib/format";

export const dynamic = "force-dynamic";

const TYPE_TONE: Record<string, string> = {
  CRITICAL: "CRITICAL",
  WARNING: "WARNING",
  SENSOR_OFFLINE: "SENSOR_OFFLINE",
  DATA_STALE: "DATA_STALE",
  GATEWAY_OFFLINE: "SENSOR_OFFLINE",
  CALIBRATION_REQUIRED: "CALIBRATION_REQUIRED",
};

export default async function AlertsPage(props: {
  searchParams: Promise<{ view?: string }>;
}) {
  const sp = await props.searchParams;
  const showAll = sp.view === "all";
  const alerts = await listAlerts({ includeAcknowledged: showAll, limit: 200 });

  return (
    <div className="space-y-4">
      <LiveRefresh intervalMs={30_000} />
      <SectionTitle
        title="Alerts"
        subtitle="Flood warnings, offline sensors and stale-data notices raised by the server."
        action={
          <a
            href={showAll ? "/alerts" : "/alerts?view=all"}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-cyan-500/60"
          >
            {showAll ? "Show open only" : "Show acknowledged"}
          </a>
        }
      />

      {alerts.length === 0 ? (
        <EmptyState>
          {showAll
            ? "No alerts recorded yet."
            : "No open alerts. Sensors and gateways are reporting normally."}
        </EmptyState>
      ) : (
        <div className="card divide-y divide-slate-800">
          {alerts.map((alert) => (
            <div key={alert.alertId} className="flex flex-wrap gap-3 p-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded bg-slate-800 px-2 py-0.5 text-xs tracking-wide text-slate-300 uppercase">
                    {alert.alertType.replaceAll("_", " ")}
                  </span>
                  {alert.deviceId ? (
                    <span className="tabular text-xs text-slate-400">
                      sensor {alert.deviceId}
                    </span>
                  ) : null}
                  {alert.zoneId ? (
                    <span className="tabular text-xs text-slate-400">
                      zone {alert.zoneId}
                    </span>
                  ) : null}
                  {alert.gatewayId ? (
                    <span className="tabular text-xs text-slate-400">
                      gateway {alert.gatewayId}
                    </span>
                  ) : null}
                  {alert.acknowledgedAt ? (
                    <span className="text-xs text-emerald-300">
                      acknowledged {formatUtc(alert.acknowledgedAt)}
                    </span>
                  ) : (
                    <span className="text-xs text-amber-300">unacknowledged</span>
                  )}
                </div>
                <p className="mt-1.5 text-sm">{alert.message}</p>
                <div className="tabular mt-1 text-xs text-slate-500">
                  raised {formatUtc(alert.createdAt)}
                  {alert.waterLevelCm !== null && alert.waterLevelCm !== undefined
                    ? ` · level ${alert.waterLevelCm} cm`
                    : ""}
                </div>
              </div>
              <StatusBadge status={TYPE_TONE[alert.alertType] ?? "NORMAL"} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
