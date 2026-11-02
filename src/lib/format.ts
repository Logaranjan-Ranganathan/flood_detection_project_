/**
 * Deterministic timestamp formatting. Server-rendered values must not depend on
 * the server locale, otherwise hydration disagrees with the rendered HTML.
 */
export function formatUtc(d: Date | null | undefined): string {
  if (!d) return "—";
  const iso = d.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)} UTC`;
}

export function formatAgeMinutes(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return "never";
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ${minutes % 60} min ago`;
  const days = Math.floor(hours / 24);
  return `${days} d ${hours % 24} h ago`;
}

export function formatCm(cm: number | null | undefined): string {
  if (cm === null || cm === undefined) return "—";
  return `${cm.toFixed(1)} cm`;
}

export function formatVolts(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return `${v.toFixed(2)} V`;
}

export function formatSigned(v: number | null | undefined, unit = ""): string {
  if (v === null || v === undefined) return "—";
  return `${v}${unit}`;
}
