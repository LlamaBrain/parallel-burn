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

/**
 * Default gap tolerance for `mergeIntervals` and `computeCompression`.
 * Set to 15 minutes — the same threshold the operator's reference
 * session-summary skill uses. Two sessions separated by ≤ 15 min are
 * treated as a single block of active work; a longer break is a real
 * gap and bookends two distinct blocks.
 *
 * Pass `gapToleranceMs: 0` to fall back to the strict-overlap merge
 * (the pre-RC4 behavior; preserved for symmetry with anyone reading
 * SPEC.md §8 literally).
 */
export const DEFAULT_GAP_TOLERANCE_MS = 15 * 60 * 1000;

export type MergeOptions = {
  /** Treat gaps ≤ this many ms as in-block continuations. Default: 15 minutes. */
  readonly gapToleranceMs?: number;
};

export function mergeIntervals(
  intervals: readonly Interval[],
  options: MergeOptions = {},
): Interval[] {
  const gapTolerance = options.gapToleranceMs ?? DEFAULT_GAP_TOLERANCE_MS;
  if (intervals.length === 0) return [];
  const sorted = [...intervals]
    .filter((i) => i.end > i.start)
    .sort((a, b) => a.start - b.start);
  if (sorted.length === 0) return [];

  const out: { start: number; end: number }[] = [];
  for (const next of sorted) {
    const last = out[out.length - 1];
    if (last !== undefined && next.start - last.end <= gapTolerance) {
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
 * components and the ratio in one shot. Defaults to the 15-min gap
 * tolerance (see `DEFAULT_GAP_TOLERANCE_MS`); pass
 * `{ gapToleranceMs: 0 }` for strict-overlap merging.
 */
export function computeCompression(
  intervals: readonly Interval[],
  options: MergeOptions = {},
): {
  sessionContextMs: number;
  wallClockWindowMs: number;
  /** Naive max(end) - min(start), counts all gaps. */
  spanMs: number;
  ratio: number;
} {
  const sessionContextMs = totalIntervalDurationMs(intervals);
  const wallClockWindowMs = totalIntervalDurationMs(mergeIntervals(intervals, options));
  const spanMs = computeSpanMs(intervals);
  return {
    sessionContextMs,
    wallClockWindowMs,
    spanMs,
    ratio: compressionRatio(sessionContextMs, wallClockWindowMs),
  };
}

/**
 * Naive temporal span: the calendar window from the earliest start to
 * the latest end, ignoring gaps. Useful as a diagnostic — if `span`
 * is much larger than `wallClockWindow`, the day had long idle
 * stretches between active blocks.
 */
export function computeSpanMs(intervals: readonly Interval[]): number {
  if (intervals.length === 0) return 0;
  let earliest = Number.POSITIVE_INFINITY;
  let latest = Number.NEGATIVE_INFINITY;
  for (const i of intervals) {
    if (i.start < earliest) earliest = i.start;
    if (i.end > latest) latest = i.end;
  }
  if (!Number.isFinite(earliest) || !Number.isFinite(latest)) return 0;
  return Math.max(0, latest - earliest);
}
