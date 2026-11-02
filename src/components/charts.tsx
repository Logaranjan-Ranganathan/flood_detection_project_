"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export interface HistoryPoint {
  receivedAt: string;
  rawSensorValue: number;
  calibratedWaterLevelCm: number | null;
  waterFlowLpm: number | null;
}

const tooltipStyle = {
  background: "#0f1a2d",
  border: "1px solid #334155",
  borderRadius: 8,
  fontSize: 12,
  color: "#e2e8f0",
};

function tick(ts: string) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function WaterLevelChart({ data }: { data: HistoryPoint[] }) {
  const calibrated = data.filter((d) => d.calibratedWaterLevelCm !== null);
  const series = calibrated.length ? calibrated : data;

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={series} margin={{ top: 8, right: 12, bottom: 0, left: -18 }}>
          <defs>
            <linearGradient id="levelFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#38bdf8" stopOpacity={0.55} />
              <stop offset="100%" stopColor="#38bdf8" stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
          <XAxis dataKey="receivedAt" tickFormatter={tick} stroke="#64748b" fontSize={11} minTickGap={28} />
          <YAxis
            stroke="#64748b"
            fontSize={11}
            width={64}
            label={
              calibrated.length
                ? { value: "cm", angle: 0, position: "insideTopLeft", fill: "#64748b", fontSize: 11 }
                : { value: "raw", angle: 0, position: "insideTopLeft", fill: "#64748b", fontSize: 11 }
            }
          />
          <Tooltip contentStyle={tooltipStyle} labelFormatter={(v) => new Date(String(v)).toLocaleString()} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {calibrated.length ? (
            <Area
              type="monotone"
              dataKey="calibratedWaterLevelCm"
              name="Water level (cm)"
              stroke="#38bdf8"
              fill="url(#levelFill)"
              strokeWidth={2}
              isAnimationActive={false}
            />
          ) : (
            <Area
              type="monotone"
              dataKey="rawSensorValue"
              name="Raw sensor value (uncalibrated)"
              stroke="#0ea5e9"
              strokeDasharray="5 4"
              fill="url(#levelFill)"
              isAnimationActive={false}
            />
          )}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function FlowChart({ data }: { data: HistoryPoint[] }) {
  const series = data.filter((d) => d.waterFlowLpm !== null);
  if (!series.length) {
    return (
      <div className="rounded-lg border border-dashed border-slate-700 p-6 text-sm text-slate-400">
        Flow data unavailable — additional sensor or validated model required.
      </div>
    );
  }
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={series} margin={{ top: 8, right: 12, bottom: 0, left: -18 }}>
          <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
          <XAxis dataKey="receivedAt" tickFormatter={tick} stroke="#64748b" fontSize={11} minTickGap={28} />
          <YAxis stroke="#64748b" fontSize={11} width={64} />
          <Tooltip contentStyle={tooltipStyle} labelFormatter={(v) => new Date(String(v)).toLocaleString()} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Line
            type="monotone"
            dataKey="waterFlowLpm"
            name="Flow (L/min)"
            stroke="#34d399"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
