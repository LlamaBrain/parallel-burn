// Streak detection.
//
// SPEC.md §8: "Streak — Consecutive calendar days with at least one session
// above a configurable minimum (default $50 retail)."
//
// We walk backwards from `today`, counting consecutive days whose total
// cost meets or exceeds the threshold. The first day below the threshold
// breaks the streak. The streak length is the number of qualifying days
// counted, *inclusive* of today if today qualifies.
//
// Date strings throughout are ISO calendar dates (`YYYY-MM-DD`) in UTC. We
// don't try to do local-timezone arithmetic — the operator who cares about
// 11:59 PM vs 12:01 AM rollover can configure their TZ and the dates will
// fall out correctly from the timestamps.

export const DEFAULT_DAILY_THRESHOLD_USD = 50;
export const MS_PER_DAY = 86_400_000;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Compute the streak length ending on `today`. If today's cost is below
 * the threshold, the streak is 0.
 */
export function computeStreak(
  dailyCostUsd: ReadonlyMap<string, number>,
  today: string,
  thresholdUsd: number = DEFAULT_DAILY_THRESHOLD_USD,
): number {
  if (!DATE_PATTERN.test(today)) {
    throw new Error(`computeStreak: invalid date ${JSON.stringify(today)}`);
  }
  let streak = 0;
  let cursor = today;
  // Walk backwards. A missing entry counts as 0, which breaks the streak
  // unless threshold is 0 — see the threshold check inside the loop.
  // Cap iterations to a year to prevent runaway loops on degenerate input.
  const MAX_DAYS = 366;
  for (let i = 0; i < MAX_DAYS; i++) {
    const cost = dailyCostUsd.get(cursor) ?? 0;
    if (cost < thresholdUsd) break;
    streak++;
    cursor = previousDay(cursor);
  }
  return streak;
}

/**
 * Return the calendar date one day before the given `YYYY-MM-DD` date.
 */
export function previousDay(yyyyMMdd: string): string {
  if (!DATE_PATTERN.test(yyyyMMdd)) {
    throw new Error(`previousDay: invalid date ${JSON.stringify(yyyyMMdd)}`);
  }
  const ms = Date.parse(`${yyyyMMdd}T00:00:00Z`);
  return new Date(ms - MS_PER_DAY).toISOString().slice(0, 10);
}

/**
 * Extract the `YYYY-MM-DD` UTC date prefix from an ISO 8601 timestamp.
 */
export function dateOf(isoTimestamp: string): string {
  return isoTimestamp.slice(0, 10);
}
