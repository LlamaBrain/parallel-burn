// Compression-ratio math.
//
// SPEC.md §8:
//   - Session-context time = sum of per-session active durations on a day.
//   - Wall-clock window     = merged-interval duration of all active sessions
//     on the same day (NOT naive first-to-last; overlapping intervals are
//     collapsed).
//   - Compression ratio     = session-context / wall-clock-window.
//
// The headline metric. If you run four parallel sessions for an hour each
// inside the same one-hour wall-clock window, that's 4×. If you run them
// strictly back-to-back, that's 1×. The ratio is always ≥ 1 when at least
// one session has nonzero duration, and undefined for empty input.

export type Interval = { readonly start: number; readonly end: number };

export function mergeIntervals(intervals: readonly Interval[]): Interval[] {
  if (intervals.length === 0) return [];
  const sorted = [...intervals]
    .filter((i) => i.end > i.start)
    .sort((a, b) => a.start - b.start);
  if (sorted.length === 0) return [];

  const out: { start: number; end: number }[] = [];
  for (const next of sorted) {
    const last = out[out.length - 1];
    if (last !== undefined && next.start <= last.end) {
      last.end = Math.max(last.end, next.end);
    } else {
      out.push({ start: next.start, end: next.end });
    }
  }
  return out.map((i) => ({ start: i.start, end: i.end }));
}

export function totalIntervalDurationMs(intervals: readonly Interval[]): number {
  let sum = 0;
  for (const i of intervals) {
    if (i.end > i.start) sum += i.end - i.start;
  }
  return sum;
}

/**
 * Compression ratio = session-context time ÷ wall-clock window.
 *
 * Returns `0` when there is no wall-clock window (e.g. empty input). The
 * ratio is always ≥ 1 when both inputs are positive — by definition, the
 * sum of durations can never be less than the merged duration.
 */
export function compressionRatio(
  sessionContextMs: number,
  wallClockWindowMs: number,
): number {
  if (wallClockWindowMs <= 0) return 0;
  return sessionContextMs / wallClockWindowMs;
}

/**
 * Convenience: given the raw session intervals for a day, return both
 * components and the ratio in one shot.
 */
export function computeCompression(intervals: readonly Interval[]): {
  sessionContextMs: number;
  wallClockWindowMs: number;
  ratio: number;
} {
  const sessionContextMs = totalIntervalDurationMs(intervals);
  const wallClockWindowMs = totalIntervalDurationMs(mergeIntervals(intervals));
  return {
    sessionContextMs,
    wallClockWindowMs,
    ratio: compressionRatio(sessionContextMs, wallClockWindowMs),
  };
}
