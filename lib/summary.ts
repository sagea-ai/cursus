// Run.summary merge logic: last-known value per metric key, kept fresh on
// every log batch so list views never touch the Metric table.
// summary is a denormalized last-known-value-per-key map so the run-list
// view stays O(runs) instead of O(runs × metrics). Updated on every log
// batch; read by the run list without touching the Metric table.

export interface SummaryPoint {
  key: string;
  value: number;
}

export function mergeSummary(
  existing: Record<string, number>,
  points: SummaryPoint[],
): Record<string, number> {
  const next: Record<string, number> = { ...existing };
  for (const p of points) {
    if (p.key.length === 0) continue;
    if (!Number.isFinite(p.value)) continue;
    next[p.key] = p.value;
  }
  return next;
}
