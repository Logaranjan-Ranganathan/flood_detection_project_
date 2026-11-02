"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { AlertView } from "@/db/repo";
import type { DeviceSnapshot, GatewayView, ZoneSummary } from "@/lib/views";
import type { HealthWindow, Thresholds } from "@/lib/status";
import { StatusBadge } from "../ui";

interface CredentialRow {
  credential_id: number;
  device_id: string | null;
  gateway_id: string | null;
  label: string;
  token_prefix: string;
  last_used_at: Date | null;
  revoked: boolean;
}

export interface ConsoleData {
  devices: DeviceSnapshot[];
  zones: ZoneSummary[];
  gateways: (GatewayView & { status: string })[];
  thresholds: Thresholds;
  healthWindow: HealthWindow;
  alerts: AlertView[];
  credentials: CredentialRow[];
}

/** Shape of the JSON our admin endpoints return; unknown extras are allowed. */
type ResponseBody = {
  ok?: boolean;
  message?: string;
  issues?: string[];
  token?: string;
  [key: string]: unknown;
};

async function postJson(url: string, body?: unknown, method = "POST") {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = ((await res.json().catch(() => ({}))) ?? {}) as ResponseBody;
  return { ok: res.ok && json.ok !== false, json };
}

function Panel({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="card p-5">
      <h2 className="text-base font-semibold">{title}</h2>
      {description ? (
        <p className="mt-1 text-sm text-slate-400">{description}</p>
      ) : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

const inputClass =
  "w-full rounded-lg border border-slate-700 bg-slate-900/70 px-3 py-2 text-sm outline-none focus:border-cyan-500";
const btnClass =
  "rounded-lg bg-cyan-500 px-3 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:opacity-60";
const ghostBtnClass =
  "rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300 transition hover:border-cyan-500/60";

function Result({ result }: { result: { kind: string; text: string } | null }) {
  if (!result) return null;
  return (
    <p
      className={`mt-2 rounded-lg px-3 py-2 text-sm ${
        result.kind === "error"
          ? "border border-red-500/40 bg-red-500/10 text-red-200"
          : "border border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
      }`}
    >
      {result.text}
    </p>
  );
}

export function AdminConsole(data: ConsoleData) {
  const router = useRouter();
  const [result, setResult] = useState<{ kind: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [issuedToken, setIssuedToken] = useState<string | null>(null);

  async function run(
    label: string,
    fn: () => Promise<{ ok: boolean; json: ResponseBody }>,
  ) {
    setBusy(true);
    setResult(null);
    try {
      const r = await fn();
      setResult(
        r.ok
          ? { kind: "ok", text: `${label} succeeded.` }
          : {
              kind: "error",
              text: `${label} failed: ${r.json?.message ?? "server rejected the request"}`,
            },
      );
      if (r.ok) router.refresh();
      return r;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Administrator console</h1>
          <p className="text-sm text-slate-400">
            {data.devices.length} sensors · {data.zones.length} zones ·{" "}
            {data.gateways.length} gateways · {data.alerts.length} open alerts
          </p>
        </div>
        <div className="flex gap-2">
          <button
            className={ghostBtnClass}
            disabled={busy}
            onClick={() => run("Health sweep", () => postJson("/api/v1/admin/sweep"))}
          >
            Re-run stale/offline sweep
          </button>
          <button
            className={ghostBtnClass}
            onClick={async () => {
              await postJson("/api/v1/admin/auth/logout");
              router.push("/admin/login");
              router.refresh();
            }}
          >
            Sign out
          </button>
        </div>
      </div>

      <Result result={result} />

      <Panel
        title="Flood thresholds"
        description="Classifications apply to calibrated centimetre values. Uncalibrated sensors are never assigned a severity."
      >
        <ThresholdsForm initial={data.thresholds} initialWindow={data.healthWindow} onDone={(r) => setResult(r)} busy={setBusy} />
      </Panel>

      <Panel
        title="Register a sensor"
        description="Creates the device record. A token can then be issued for the ESP32-1 node."
      >
        <DeviceForm
          gateways={data.gateways.map((g) => g.gatewayId)}
          zones={data.zones.map((z) => z.zoneId)}
          onDone={(r) => setResult(r)}
        />
      </Panel>

      <Panel
        title="Register a gateway"
        description="Gateways are identified by their gateway ID. IP addresses are diagnostics only."
      >
        <GatewayForm onDone={(r) => setResult(r)} />
        <GatewayTokenIssuer
          gateways={data.gateways.map((g) => g.gatewayId)}
          onToken={setIssuedToken}
        />
      </Panel>

      <Panel
        title="Configure monitoring zones"
        description="Each zone is a circle with a radius in metres around a centre point. 50 m is the default."
      >
        <ZoneForm onDone={(r) => setResult(r)} />
      </Panel>

      <Panel title="Sensors — calibration, location and thresholds">
        <div className="space-y-3">
          {data.devices.length === 0 ? (
            <p className="text-sm text-slate-400">No sensors registered.</p>
          ) : (
            data.devices.map((device) => (
              <DeviceEditor
                key={device.deviceId}
                device={device}
                gateways={data.gateways.map((g) => g.gatewayId)}
                zones={data.zones.map((z) => z.zoneId)}
                thresholds={data.thresholds}
                onDone={(r) => setResult(r)}
                onToken={(token) => setIssuedToken(token)}
              />
            ))
          )}
        </div>

        {issuedToken ? (
          <div className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
            <p className="text-sm font-semibold text-amber-200">
              Ingestion token — shown once, store it in the firmware now
            </p>
            <code className="mt-1 block break-all rounded bg-slate-950/60 p-2 text-xs text-amber-100">
              {issuedToken}
            </code>
            <p className="mt-2 text-xs text-amber-200/80">
              Never commit this value to Git or display it on a public page. It is
              stored only as a SHA-256 hash.
            </p>
            <button className={ghostBtnClass + " mt-2"} onClick={() => setIssuedToken(null)}>
              Dismiss
            </button>
          </div>
        ) : null}
      </Panel>

      <Panel
        title="Device credentials"
        description="Only the token prefix is recoverable. A sensor token cannot post gateway diagnostics and a gateway token cannot post sensor readings."
      >
        {data.credentials.length === 0 ? (
          <p className="text-sm text-slate-400">No credentials issued.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs tracking-wide text-slate-400 uppercase">
                <tr>
                  <th className="py-2 pr-4">Principal</th>
                  <th className="py-2 pr-4">Label</th>
                  <th className="py-2 pr-4">Prefix</th>
                  <th className="py-2 pr-4">Last used</th>
                  <th className="py-2 pr-4">State</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {data.credentials.map((c) => (
                  <tr key={c.credential_id}>
                    <td className="tabular py-2 pr-4">
                      {c.gateway_id ? `gateway · ${c.gateway_id}` : c.device_id}
                    </td>
                    <td className="py-2 pr-4">{c.label}</td>
                    <td className="tabular py-2 pr-4 text-slate-400">{c.token_prefix}…</td>
                    <td className="py-2 pr-4 text-slate-400">
                      {c.last_used_at ? new Date(c.last_used_at).toISOString().slice(0, 16) : "never"}
                    </td>
                    <td className="py-2 pr-4">
                      {c.revoked ? (
                        <span className="text-red-300">revoked</span>
                      ) : (
                        <span className="text-emerald-300">active</span>
                      )}
                    </td>
                    <td className="py-2 text-right">
                      {!c.revoked ? (
                        <button
                          className={ghostBtnClass}
                          onClick={() =>
                            run("Revoke", () =>
                              postJson(
                                `/api/v1/admin/credentials?credential_id=${c.credential_id}`,
                                undefined,
                                "DELETE",
                              ),
                            )
                          }
                        >
                          Revoke
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="Alerts to review">
        {data.alerts.length === 0 ? (
          <p className="text-sm text-slate-400">No open alerts.</p>
        ) : (
          <ul className="space-y-2">
            {data.alerts.map((alert) => (
              <li key={alert.alertId} className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-800 p-3">
                <StatusBadge status={alert.severity} />
                <span className="min-w-0 flex-1 text-sm">{alert.message}</span>
                <button
                  className={ghostBtnClass}
                  onClick={() =>
                    run("Acknowledgement", () =>
                      postJson("/api/v1/admin/alerts", {
                        alert_id: alert.alertId,
                        action: "acknowledge",
                      }),
                    )
                  }
                >
                  Acknowledge
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function ThresholdsForm({
  initial,
  initialWindow,
  onDone,
}: {
  initial: Thresholds;
  initialWindow: HealthWindow;
  onDone: (r: { kind: string; text: string }) => void;
  busy: (b: boolean) => void;
}) {
  const [watch, setWatch] = useState(String(initial.watchCm));
  const [warning, setWarning] = useState(String(initial.warningCm));
  const [critical, setCritical] = useState(String(initial.criticalCm));
  const [stale, setStale] = useState(String(initialWindow.staleAfterMinutes));
  const [offline, setOffline] = useState(String(initialWindow.offlineAfterMinutes));

  return (
    <form
      className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5"
      onSubmit={async (e) => {
        e.preventDefault();
        const res = await postJson("/api/v1/admin/settings", {
          thresholds: {
            watchCm: Number(watch),
            warningCm: Number(warning),
            criticalCm: Number(critical),
          },
          health_window: {
            staleAfterMinutes: Number(stale),
            offlineAfterMinutes: Number(offline),
          },
        });
        onDone(
          res.ok
            ? { kind: "ok", text: "Thresholds saved." }
            : {
                kind: "error",
                text:
                  res.json?.issues?.join("; ") ??
                  res.json?.message ??
                  "Could not save thresholds",
              },
        );
      }}
    >
      {(
        [
          ["Watch cm", watch, setWatch],
          ["Warning cm", warning, setWarning],
          ["Critical cm", critical, setCritical],
          ["Stale after (min)", stale, setStale],
          ["Offline after (min)", offline, setOffline],
        ] as const
      ).map(([label, value, setter]) => (
        <label key={label} className="text-xs text-slate-400">
          {label}
          <input
            className={inputClass + " mt-1"}
            value={value}
            inputMode="decimal"
            onChange={(e) => setter(e.target.value)}
          />
        </label>
      ))}
      <button className={btnClass + " self-end"} type="submit">
        Save thresholds
      </button>
    </form>
  );
}

function DeviceForm({
  gateways,
  zones,
  onDone,
}: {
  gateways: string[];
  zones: string[];
  onDone: (r: { kind: string; text: string }) => void;
}) {
  const [deviceId, setDeviceId] = useState("FG-SENSOR-");
  const [label, setLabel] = useState("");
  const [gatewayId, setGatewayId] = useState(gateways[0] ?? "");
  const [zoneId, setZoneId] = useState(zones[0] ?? "");

  return (
    <form
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"
      onSubmit={async (e) => {
        e.preventDefault();
        const res = await postJson("/api/v1/admin/devices", {
          device_id: deviceId,
          label: label || deviceId,
          gateway_id: gatewayId || null,
          zone_id: zoneId || null,
          latitude: null,
          longitude: null,
          location_verified: false,
          location_source: "UNVERIFIED",
          flow_supported: false,
        });
        onDone(
          res.ok
            ? { kind: "ok", text: `Registered ${deviceId}. Issue a token below to let it ingest.` }
            : { kind: "error", text: res.json?.message ?? "Registration failed" },
        );
        if (res.ok) setLabel("");
      }}
    >
      <label className="text-xs text-slate-400">
        Device ID
        <input className={inputClass + " mt-1"} value={deviceId} onChange={(e) => setDeviceId(e.target.value)} />
      </label>
      <label className="text-xs text-slate-400">
        Label
        <input className={inputClass + " mt-1"} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Canal bridge — upstream" />
      </label>
      <label className="text-xs text-slate-400">
        Gateway
        <select className={inputClass + " mt-1"} value={gatewayId} onChange={(e) => setGatewayId(e.target.value)}>
          <option value="">unassigned</option>
          {gateways.map((g) => (
            <option key={g} value={g}>{g}</option>
          ))}
        </select>
      </label>
      <label className="text-xs text-slate-400">
        Primary zone
        <select className={inputClass + " mt-1"} value={zoneId} onChange={(e) => setZoneId(e.target.value)}>
          <option value="">none</option>
          {zones.map((z) => (
            <option key={z} value={z}>{z}</option>
          ))}
        </select>
      </label>
      <button className={btnClass + " self-end"} type="submit">
        Register sensor
      </button>
    </form>
  );
}

function GatewayForm({ onDone }: { onDone: (r: { kind: string; text: string }) => void }) {
  const [gatewayId, setGatewayId] = useState("FG-GATEWAY-");
  const [name, setName] = useState("");

  return (
    <form
      className="grid gap-3 sm:grid-cols-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const res = await postJson("/api/v1/admin/gateways", {
          gateway_id: gatewayId,
          name: name || gatewayId,
          firmware_version: null,
          hardware_note: null,
        });
        onDone(
          res.ok
            ? { kind: "ok", text: `Gateway ${gatewayId} registered.` }
            : { kind: "error", text: res.json?.message ?? "Could not register the gateway" },
        );
      }}
    >
      <label className="text-xs text-slate-400">
        Gateway ID
        <input className={inputClass + " mt-1"} value={gatewayId} onChange={(e) => setGatewayId(e.target.value)} />
      </label>
      <label className="text-xs text-slate-400">
        Name
        <input className={inputClass + " mt-1"} value={name} onChange={(e) => setName(e.target.value)} placeholder="ESP32-2 gateway" />
      </label>
      <button className={btnClass + " self-end"} type="submit">
        Register gateway
      </button>
    </form>
  );
}

/**
 * ESP32-2 authenticates with its gateway ID and its own token, so a sensor
 * token can never publish gateway diagnostics.
 */
function GatewayTokenIssuer({
  gateways,
  onToken,
}: {
  gateways: string[];
  onToken: (token: string) => void;
}) {
  const [gatewayId, setGatewayId] = useState(gateways[0] ?? "");
  const [busy, setBusy] = useState(false);

  if (gateways.length === 0) {
    return (
      <p className="mt-3 text-xs text-slate-400">
        Register a gateway first, then issue its ingestion token here.
      </p>
    );
  }

  return (
    <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-slate-800 pt-4">
      <label className="text-xs text-slate-400">
        Issue gateway token
        <select
          className={inputClass + " mt-1"}
          value={gatewayId}
          onChange={(e) => setGatewayId(e.target.value)}
        >
          {gateways.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>
      </label>
      <button
        className={btnClass}
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          const res = await postJson("/api/v1/admin/credentials", {
            gateway_id: gatewayId,
            label: "issued from console",
          });
          if (res.ok && res.json.token) {
            onToken(res.json.token);
          }
          setBusy(false);
        }}
      >
        Issue token
      </button>
      <p className="text-xs text-slate-500">
        Shown once. The database keeps only its SHA-256 hash.
      </p>
    </div>
  );
}

function ZoneForm({ onDone }: { onDone: (r: { kind: string; text: string }) => void }) {
  const [zoneId, setZoneId] = useState("FG-ZONE-");
  const [name, setName] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [radius, setRadius] = useState("50");

  return (
    <form
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6"
      onSubmit={async (e) => {
        e.preventDefault();
        const res = await postJson("/api/v1/admin/zones", {
          zone_id: zoneId,
          name: name || zoneId,
          center_latitude: Number(lat),
          center_longitude: Number(lng),
          radius_meters: Number(radius),
          locality_note: "Configured monitoring zone — not an official ward boundary",
        });
        onDone(
          res.ok
            ? { kind: "ok", text: `Zone ${zoneId} saved with a ${radius} m radius.` }
            : {
                kind: "error",
                text:
                  res.json?.message ??
                  "Zone must have a valid ID, name and latitude between -90 and 90 / longitude between -180 and 180",
              },
        );
      }}
    >
      <label className="text-xs text-slate-400">
        Zone ID
        <input className={inputClass + " mt-1"} value={zoneId} onChange={(e) => setZoneId(e.target.value)} />
      </label>
      <label className="text-xs text-slate-400">
        Name
        <input className={inputClass + " mt-1"} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="text-xs text-slate-400">
        Centre latitude
        <input className={inputClass + " mt-1"} value={lat} onChange={(e) => setLat(e.target.value)} placeholder="6.9271" />
      </label>
      <label className="text-xs text-slate-400">
        Centre longitude
        <input className={inputClass + " mt-1"} value={lng} onChange={(e) => setLng(e.target.value)} placeholder="79.8612" />
      </label>
      <label className="text-xs text-slate-400">
        Radius (m)
        <input className={inputClass + " mt-1"} value={radius} onChange={(e) => setRadius(e.target.value)} inputMode="numeric" />
      </label>
      <button className={btnClass + " self-end"} type="submit">
        Save zone
      </button>
    </form>
  );
}

function DeviceEditor({
  device,
  gateways,
  zones,
  thresholds,
  onDone,
  onToken,
}: {
  device: DeviceSnapshot;
  gateways: string[];
  zones: string[];
  thresholds: Thresholds;
  onDone: (r: { kind: string; text: string }) => void;
  onToken: (token: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [zeroRaw, setZeroRaw] = useState("");
  const [spanRaw, setSpanRaw] = useState("");
  const [refCm, setRefCm] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [watchCm, setWatchCm] = useState("");
  const [warningCm, setWarningCm] = useState("");
  const [criticalCm, setCriticalCm] = useState("");

  async function patch(body: Record<string, unknown>, text: string) {
    const res = await postJson(
      `/api/v1/admin/devices/${device.deviceId}`,
      body,
      "PATCH",
    );
    onDone(
      res.ok
        ? { kind: "ok", text }
        : {
            kind: "error",
            text:
            res.json?.issues?.join("; ") ??
            res.json?.message ??
            "Update rejected",
          },
    );
  }

  return (
    <div className="rounded-lg border border-slate-800">
      <button
        type="button"
        className="flex w-full flex-wrap items-center gap-3 p-3 text-left"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="tabular text-sm font-medium">{device.deviceId}</span>
        <span className="min-w-0 flex-1 truncate text-sm text-slate-400">{device.label}</span>
        <span className="text-xs text-slate-500">
          {device.calibrationVerified ? "calibrated" : "uncalibrated"} ·{" "}
          {device.hasLocation ? "located" : "no location"} ·{" "}
          {device.flowSupported ? "flow sensor" : "no flow sensor"}
        </span>
        <StatusBadge status={device.effectiveStatus} />
        <span className="text-xs text-cyan-300">{open ? "hide" : "configure"}</span>
      </button>

      {open ? (
        <div className="space-y-4 border-t border-slate-800 p-4">
          <div>
            <h3 className="text-sm font-semibold">Two-point calibration</h3>
            <p className="mt-1 text-xs text-slate-400">
              Record the raw count when the sensor is dry (0 cm) and the raw count at a
              measured reference depth. Until both are set the site shows the raw value
              only, and no flood severity is claimed.
            </p>
            <div className="mt-2 grid gap-2 sm:grid-cols-4">
              <label className="text-xs text-slate-400">
                Raw at 0 cm
                <input className={inputClass + " mt-1"} value={zeroRaw} onChange={(e) => setZeroRaw(e.target.value)} inputMode="numeric" />
              </label>
              <label className="text-xs text-slate-400">
                Raw at reference
                <input className={inputClass + " mt-1"} value={spanRaw} onChange={(e) => setSpanRaw(e.target.value)} inputMode="numeric" />
              </label>
              <label className="text-xs text-slate-400">
                Reference cm
                <input className={inputClass + " mt-1"} value={refCm} onChange={(e) => setRefCm(e.target.value)} inputMode="decimal" />
              </label>
              <button
                className={btnClass + " self-end"}
                onClick={() =>
                  patch(
                    {
                      calibration: {
                        zeroRaw: Number(zeroRaw),
                        spanRaw: Number(spanRaw),
                        referenceCm: Number(refCm),
                        verified: true,
                      },
                    },
                    `Calibration saved for ${device.deviceId}.`,
                  )
                }
              >
                Save calibration
              </button>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold">Location</h3>
            <p className="mt-1 text-xs text-slate-400">
              Enter the sensor&rsquo;s own coordinates. The gateway&rsquo;s GPS position is
              never copied onto a remote sensor automatically.
            </p>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              <label className="text-xs text-slate-400">
                Latitude
                <input className={inputClass + " mt-1"} value={lat} onChange={(e) => setLat(e.target.value)} placeholder="6.92710" />
              </label>
              <label className="text-xs text-slate-400">
                Longitude
                <input className={inputClass + " mt-1"} value={lng} onChange={(e) => setLng(e.target.value)} placeholder="79.86120" />
              </label>
              <button
                className={btnClass + " self-end"}
                onClick={() =>
                  patch(
                    {
                      location: {
                        latitude: Number(lat),
                        longitude: Number(lng),
                        verified: true,
                        source: "MANUAL",
                      },
                    },
                    `Location saved for ${device.deviceId}.`,
                  )
                }
              >
                Save location
              </button>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold">Assignment</h3>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              <label className="text-xs text-slate-400">
                Gateway
                <select
                  className={inputClass + " mt-1"}
                  defaultValue={device.gatewayId ?? ""}
                  onChange={(e) => patch({ gateway_id: e.target.value || null }, "Gateway assignment saved.")}
                >
                  <option value="">unassigned</option>
                  {gateways.map((g) => (
                    <option key={g} value={g}>{g}</option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-slate-400">
                Primary zone
                <select
                  className={inputClass + " mt-1"}
                  defaultValue={device.zoneId ?? ""}
                  onChange={(e) => patch({ zone_id: e.target.value || null }, "Zone assignment saved.")}
                >
                  <option value="">none</option>
                  {zones.map((z) => (
                    <option key={z} value={z}>{z}</option>
                  ))}
                </select>
              </label>
              <label className="flex items-end gap-2 text-xs text-slate-400">
                <input
                  type="checkbox"
                  defaultChecked={device.flowSupported}
                  className="size-4 accent-cyan-500"
                  onChange={(e) =>
                    patch(
                      { flow_supported: e.target.checked },
                      e.target.checked
                        ? "Flow sensor enabled. Only report measured flow."
                        : "Flow sensor disabled. Flow will be shown as unavailable.",
                    )
                  }
                />
                <span>Has a real flow sensor</span>
              </label>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold">Per-device thresholds (optional)</h3>
            <p className="mt-1 text-xs text-slate-400">
              Global thresholds are watch {thresholds.watchCm} cm, warning{" "}
              {thresholds.warningCm} cm, critical {thresholds.criticalCm} cm.
            </p>
            <div className="mt-2 grid gap-2 sm:grid-cols-4">
              <label className="text-xs text-slate-400">
                Watch cm
                <input className={inputClass + " mt-1"} value={watchCm} onChange={(e) => setWatchCm(e.target.value)} />
              </label>
              <label className="text-xs text-slate-400">
                Warning cm
                <input className={inputClass + " mt-1"} value={warningCm} onChange={(e) => setWarningCm(e.target.value)} />
              </label>
              <label className="text-xs text-slate-400">
                Critical cm
                <input className={inputClass + " mt-1"} value={criticalCm} onChange={(e) => setCriticalCm(e.target.value)} />
              </label>
              <button
                className={btnClass + " self-end"}
                onClick={() =>
                  patch(
                    {
                      thresholds_override: {
                        watchCm: Number(watchCm),
                        warningCm: Number(warningCm),
                        criticalCm: Number(criticalCm),
                      },
                    },
                    `Threshold override saved for ${device.deviceId}.`,
                  )
                }
              >
                Save override
              </button>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 border-t border-slate-800 pt-4">
            <button
              className={btnClass}
              onClick={async () => {
                const res = await postJson("/api/v1/admin/credentials", {
                  device_id: device.deviceId,
                  label: "issued from console",
                });
                if (res.ok && res.json?.token) {
                  onToken(res.json.token);
                  onDone({ kind: "ok", text: `Token issued for ${device.deviceId}.` });
                } else {
                  onDone({ kind: "error", text: res.json?.message ?? "Could not issue a token" });
                }
              }}
            >
              Issue device token
            </button>
            <button
              className={ghostBtnClass}
              onClick={() =>
                patch({ calibration: null }, `Calibration cleared for ${device.deviceId}; readings return to raw.`)
              }
            >
              Clear calibration
            </button>
            <button
              className={ghostBtnClass}
              onClick={() => patch({ thresholds_override: null }, "Per-device thresholds removed.")}
            >
              Reset thresholds
            </button>
            <button
              className={ghostBtnClass + " text-red-300 hover:border-red-500/60"}
              onClick={async () => {
                const res = await fetch(`/api/v1/admin/devices/${device.deviceId}`, {
                  method: "DELETE",
                });
                onDone(
                  res.ok
                    ? { kind: "ok", text: `Deleted ${device.deviceId}.` }
                    : { kind: "error", text: "Could not delete the sensor" },
                );
              }}
            >
              Delete sensor
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
