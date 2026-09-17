// Chart downsampling (PRD §7.10/§9).
// A run with 100k steps must never ship 100k points to the browser —
// render at most a few thousand points per line. v1 uses deterministic
// stride-based downsampling server-side (bounded payload regardless of run
// length); LTTB is a documented v2 tradeoff if charts ever look lossy.

export interface ChartPoint {
  step: number;
  value: number;
}

export function downsample(
  points: ChartPoint[],
  maxPoints: number,
): ChartPoint[] {
  if (maxPoints < 1) throw new Error("maxPoints must be >= 1");
  if (points.length <= maxPoints) return points;
  if (maxPoints === 1) return [points[points.length - 1]!];
  const stride = Math.ceil(points.length / maxPoints);
  const out: ChartPoint[] = [];
  for (let i = 0; i < points.length; i += stride) {
    out.push(points[i]!);
  }
  // Always keep the true last point so charts don't lie about run extent.
  // If the stride grid already fills the budget, swap the final slot instead
  // of growing past maxPoints.
  const last = points[points.length - 1]!;
  if (out[out.length - 1] !== last) {
    if (out.length >= maxPoints) out[out.length - 1] = last;
    else out.push(last);
  }
  return out;
}
