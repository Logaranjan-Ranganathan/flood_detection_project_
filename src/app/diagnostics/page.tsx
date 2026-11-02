import { getOverview } from "@/lib/services/overview";
import { LiveRefresh } from "@/components/live-refresh";
import { EmptyState, SectionTitle, StatusBadge } from "@/components/ui";
import { formatAgeMinutes, formatUtc } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function DiagnosticsPage() {
  const overview = await getOverview();

  return (
    <div className="space-y-5">
      <LiveRefresh intervalMs={30_000} />
      <SectionTitle
        title="Device diagnostics"
        subtitle="Status of the LoRa gateway that forwards sensor packets to this backend."
      />

      <div className="card border-sky-500/30 bg-sky-500/5 p-3 text-sm text-sky-200">
        Gateways are identified by a stable gateway ID, never by their IP address.
        The address below is diagnostic only: it changes with the mobile network and
        is not used to log the device in. Authentication tokens are never shown here.
      </div>

      {overview.gateways.length === 0 ? (
        <EmptyState>
          No gateway has reported yet. Waiting for sensor data from ESP32-2.
        </EmptyState>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {overview.gateways.map((gw) => (
            <div key={gw.gatewayId} className="card p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="tabular text-xs text-slate-400">{gw.gatewayId}</div>
                  <h2 className="text-lg font-semibold">{gw.name}</h2>
                  <p className="mt-0.5 text-xs text-slate-500">{gw.hardwareNote}</p>
                </div>
                <StatusBadge
                  status={
                    gw.status === "ONLINE"
                      ? "NORMAL"
                      : gw.status === "UNKNOWN"
                        ? "CALIBRATION_REQUIRED"
                        : "SENSOR_OFFLINE"
                  }
                />
              </div>

              {gw.status !== "ONLINE" ? (
                <div className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5 text-sm text-amber-200">
                  Gateway has not reported recently
                  {gw.ageMinutes !== null ? ` (last seen ${formatAgeMinutes(gw.ageMinutes)})` : ""}.
                  Readings shown for its sensors may be out of date.
                </div>
              ) : null}

              <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                <div>
                  <dt className="text-xs text-slate-400 uppercase">Last communication</dt>
                  <dd className="tabular">
                    {formatAgeMinutes(gw.ageMinutes)}
                    <div className="text-xs text-slate-500">{formatUtc(gw.lastSeenAt)}</div>
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-400 uppercase">Firmware</dt>
                  <dd className="tabular">{gw.firmwareVersion ?? "unknown"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-400 uppercase">Latest reported IP</dt>
                  <dd className="tabular">{gw.lastReportedIp ?? "not reported"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-400 uppercase">Network status</dt>
                  <dd>{gw.networkStatus}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-400 uppercase">GPS fix</dt>
                  <dd>
                    {gw.gpsFix === null || gw.gpsFix === undefined
                      ? "not reported"
                      : gw.gpsFix
                        ? "fix acquired"
                        : "no fix"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-400 uppercase">Gateway coordinates</dt>
                  <dd className="tabular">
                    {gw.latitude !== null && gw.longitude !== null
                      ? `${gw.latitude.toFixed(5)}, ${gw.longitude.toFixed(5)}`
                      : "Location unavailable"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-400 uppercase">LoRa RSSI / SNR</dt>
                  <dd className="tabular">
                    {gw.lastLoraRssi !== null ? `${gw.lastLoraRssi} dBm` : "—"}
                    {" / "}
                    {gw.lastLoraSnr !== null ? `${gw.lastLoraSnr} dB` : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-400 uppercase">Battery</dt>
                  <dd className="tabular">
                    {gw.batteryMv !== null ? `${gw.batteryMv} mV` : "not reported"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-400 uppercase">Packets received</dt>
                  <dd className="tabular">{gw.packetsReceived}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-400 uppercase">Sensors reporting</dt>
                  <dd className="tabular">
                    {overview.devices.filter((d) => d.gatewayId === gw.gatewayId).length}
                  </dd>
                </div>
              </dl>

              <p className="mt-3 text-xs text-slate-500">
                GPS coordinates recorded here are the gateway&rsquo;s own position.
                Remote sensors are never assumed to share it.
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
