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
// Date strings throughout are calendar dates in **the operator's local
// timezone** (`YYYY-MM-DD`). This matches what Claude Code's /stats view
// shows and what users expect when they say "today" — a session run at
// 11:30 PM PDT lands in today's bucket, not tomorrow's. ADR-0006 picked
// up `~/.claude/stats-cache.json` as the source of truth for daily
// aggregates; that cache uses the same local-date semantics, so the
// numbers line up by construction.

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
 * Extract the `YYYY-MM-DD` **local-timezone** calendar date from an ISO
 * 8601 timestamp. Uses the runtime's `getFullYear` / `getMonth` /
 * `getDate` (system TZ), so an 11 PM PDT session lands in the PDT day,
 * not the UTC day after midnight.
 *
 * Returns the literal first 10 chars unchanged if the timestamp doesn't
 * parse as a valid date — defensive for malformed input.
 */
export function dateOf(isoTimestamp: string): string {
  const ms = Date.parse(isoTimestamp);
  if (!Number.isFinite(ms)) return isoTimestamp.slice(0, 10);
  const d = new Date(ms);
  const yyyy = String(d.getFullYear()).padStart(4, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Today's calendar date in the operator's local timezone (YYYY-MM-DD).
 * Convenience for the common "what is today?" question — equivalent to
 * `dateOf(new Date().toISOString())`.
 */
export function localToday(now: Date = new Date()): string {
  const yyyy = String(now.getFullYear()).padStart(4, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
