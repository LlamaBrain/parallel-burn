// Reader for Claude Code's own stats cache at ~/.claude/stats-cache.json.
//
// Background: ADR-0003 committed ParallelBurn to reading session
// transcripts under ~/.claude/projects/ as the source of truth for token
// usage. That works for per-message detail but has two failure modes
// surfaced in practice:
//
//   1. Claude Code prunes transcripts older than ~30 days, so anything
//      involving longer-window aggregates (streaks, all-time totals)
//      can't be computed from transcripts alone.
//   2. ParallelBurn's "streak" computed from the transcript window did
//      not match the streak shown in Claude Code's own /stats view,
//      which is the number users see and compare against. That makes
//      ParallelBurn look wrong even when its math is internally correct.
//
// Solution (ADR-0006): use `~/.claude/stats-cache.json` as the source
// of truth for *day-aggregated* metrics (streak, daily activity), and
// keep transcripts as the source for per-session detail (today's
// numbers, the per-session table). The cache is maintained by Claude
// Code itself, holds months of history, and is the same data the
// /stats view renders — so matching it is matching the user-visible
// authoritative number by construction.

import { homedir } from "node:os";
import { join } from "node:path";

import { readJsonOptional } from "./store.js";
import { previousDay } from "./streak.js";

const STATS_CACHE_RELATIVE_PATH = ".claude/stats-cache.json";
const SUPPORTED_CACHE_VERSIONS: readonly number[] = [3];

export type DailyActivity = {
  readonly date: string; // YYYY-MM-DD
  readonly sessionCount: number;
  readonly messageCount: number;
  readonly toolCallCount: number;
};

export type DailyModelTokens = {
  readonly date: string;
  readonly tokensByModel: Readonly<Record<string, number>>;
};

export type ClaudeStatsCache = {
  readonly version: number;
  readonly lastComputedDate: string; // YYYY-MM-DD
  readonly firstSessionDate: string; // ISO 8601
  readonly totalSessions: number;
  readonly totalMessages: number;
  readonly dailyActivity: readonly DailyActivity[];
  readonly dailyModelTokens: readonly DailyModelTokens[];
};

export function defaultStatsCachePath(): string {
  return join(homedir(), STATS_CACHE_RELATIVE_PATH);
}

/**
 * Read and validate Claude Code's stats cache. Returns null if the file
 * is missing, malformed, or uses an unsupported version (in which case
 * the caller should fall back to transcript-only aggregation).
 */
export async function readStatsCache(
  path: string = defaultStatsCachePath(),
): Promise<ClaudeStatsCache | null> {
  const raw = await readJsonOptional(path);
  return parseStatsCache(raw);
}

export function parseStatsCache(raw: unknown): ClaudeStatsCache | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;

  const version = obj["version"];
  if (typeof version !== "number" || !SUPPORTED_CACHE_VERSIONS.includes(version)) {
    return null;
  }
  const lastComputedDate = obj["lastComputedDate"];
  const firstSessionDate = obj["firstSessionDate"];
  if (typeof lastComputedDate !== "string") return null;
  if (typeof firstSessionDate !== "string") return null;

  const totalSessions = typeof obj["totalSessions"] === "number" ? obj["totalSessions"] : 0;
  const totalMessages = typeof obj["totalMessages"] === "number" ? obj["totalMessages"] : 0;

  const dailyActivity = parseDailyActivity(obj["dailyActivity"]);
  const dailyModelTokens = parseDailyModelTokens(obj["dailyModelTokens"]);

  return {
    version,
    lastComputedDate,
    firstSessionDate,
    totalSessions,
    totalMessages,
    dailyActivity,
    dailyModelTokens,
  };
}

function parseDailyActivity(raw: unknown): DailyActivity[] {
  if (!Array.isArray(raw)) return [];
  const out: DailyActivity[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const e = entry as Record<string, unknown>;
    if (typeof e["date"] !== "string") continue;
    out.push({
      date: e["date"],
      sessionCount: typeof e["sessionCount"] === "number" ? e["sessionCount"] : 0,
      messageCount: typeof e["messageCount"] === "number" ? e["messageCount"] : 0,
      toolCallCount: typeof e["toolCallCount"] === "number" ? e["toolCallCount"] : 0,
    });
  }
  return out;
}

function parseDailyModelTokens(raw: unknown): DailyModelTokens[] {
  if (!Array.isArray(raw)) return [];
  const out: DailyModelTokens[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const e = entry as Record<string, unknown>;
    if (typeof e["date"] !== "string") continue;
    const tbm = e["tokensByModel"];
    if (typeof tbm !== "object" || tbm === null || Array.isArray(tbm)) continue;
    const filtered: Record<string, number> = {};
    for (const [model, n] of Object.entries(tbm as Record<string, unknown>)) {
      if (typeof n === "number" && Number.isFinite(n) && n >= 0) {
        filtered[model] = n;
      }
    }
    out.push({ date: e["date"], tokensByModel: filtered });
  }
  return out;
}

/**
 * Compute the active-day streak ending on `today`. An "active day" is
 * one where Claude Code's cache shows `sessionCount > 0`. Returns 0 if
 * today is not active. `todayHasActivityOverride` lets the caller
 * stamp the *current* day as active even if it's after the cache's
 * `lastComputedDate` (which it almost always will be — the cache is
 * recomputed offline).
 */
export function computeActiveStreak(
  today: string,
  dailyActivity: readonly DailyActivity[],
  todayHasActivityOverride: boolean,
): number {
  const map = new Map<string, number>();
  for (const e of dailyActivity) map.set(e.date, e.sessionCount);
  if (todayHasActivityOverride) {
    map.set(today, Math.max(1, map.get(today) ?? 0));
  }
  let streak = 0;
  let cursor = today;
  const MAX_DAYS = 3_650;
  for (let i = 0; i < MAX_DAYS; i++) {
    const count = map.get(cursor) ?? 0;
    if (count <= 0) break;
    streak++;
    cursor = previousDay(cursor);
  }
  return streak;
}

/**
 * Longest-ever active-day streak observed in the cache, optionally
 * extended by today if `todayHasActivityOverride` is set (the cache
 * lags by one day, so the live current streak may exceed the longest
 * fully-recorded historical streak by exactly 1).
 */
export function computeLongestActiveStreak(
  dailyActivity: readonly DailyActivity[],
  today?: string,
  todayHasActivityOverride: boolean = false,
): number {
  const map = new Map<string, number>();
  for (const e of dailyActivity) if (e.sessionCount > 0) map.set(e.date, e.sessionCount);
  if (today !== undefined && todayHasActivityOverride) {
    map.set(today, Math.max(1, map.get(today) ?? 0));
  }
  const dates = [...map.keys()].sort();
  let longest = 0;
  let current = 0;
  let prevDate: string | null = null;
  for (const d of dates) {
    if (prevDate === null || previousDay(d) !== prevDate) {
      current = 1;
    } else {
      current++;
    }
    if (current > longest) longest = current;
    prevDate = d;
  }
  return longest;
}
