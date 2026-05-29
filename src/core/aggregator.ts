// Aggregator — walks SessionManifests, reads transcripts, produces
// per-day / per-project / per-session rollups.
//
// SPEC.md §10 Phase 4: "Walks all JSONL files in a date range, computes
// the metrics in section 8. Compression ratio uses merged-interval
// wall-clock-window, not naive first-to-last."
//
// The aggregator is the bridge between the on-disk data plane and the
// presentation layer (slash commands, summary, overlay). It is the only
// module that fans out to multiple sessions; everything below it is
// single-session-scoped.

import { readdir } from "node:fs/promises";

import { backfillMissingManifests, defaultClaudeProjectsDir } from "./backfill.js";
import { computeCost, type CostBreakdown } from "./cost.js";
import { computeCompression, type Interval } from "./compression.js";
import type { MessageEvent } from "./event.js";
import type { ProjectId, SessionId } from "./ids.js";
import {
  readManifestOptional,
  type SessionManifest,
} from "./manifest.js";
import {
  parallelBurnSessionMetaPath,
  parallelBurnSessionsDir,
} from "./paths.js";
import type { PricingProvider } from "./pricing.js";
import { dateOf } from "./streak.js";
import { readTranscript } from "./transcript.js";

export type SessionAggregate = {
  readonly sessionId: SessionId;
  readonly project: ProjectId;
  readonly model: string | null;
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly lastSeenActive: string;
  readonly durationMs: number;
  readonly messageCount: number;
  readonly costUsd: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly unknownModel: boolean;
};

export type ProjectAggregate = {
  readonly project: ProjectId;
  readonly durationMs: number;
  readonly costUsd: number;
  readonly sessionCount: number;
};

export type DailyAggregate = {
  readonly date: string;
  readonly sessions: readonly SessionAggregate[];
  readonly byProject: readonly ProjectAggregate[];
  /** Sum of per-session durations (numerator of the parallelism ratio). */
  readonly sessionContextMs: number;
  /** Merged-interval wall-clock window with a 15-min gap tolerance (matches the operator's session-summary skill). */
  readonly wallClockWindowMs: number;
  /** Naive max(end) - min(start). Diagnostic — counts cross-session idle gaps as wall. */
  readonly spanMs: number;
  /** sessionContextMs / wallClockWindowMs. */
  readonly compressionRatio: number;
  readonly totalCostUsd: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  /** cacheReadTokens / cacheWriteTokens — how hard the cache is working. */
  readonly cacheDisciplineRatio: number;
  /**
   * cacheReadTokens / (inputTokens + cacheWriteTokens + cacheReadTokens) — fraction of all
   * prompt-input bytes served from cache, as a percent in [0, 100].
   *
   * cacheWriteTokens is in the denominator because cache-creation is a *miss* — those
   * tokens had to be re-prompted to Anthropic to populate the cache, not served from it.
   * Excluding cacheWrite would make the metric asymptote to 100% after the first few
   * cache-priming turns of any long session and lose all signal.
   */
  readonly cacheHitPercent: number;
  /**
   * Number of sessions on this day whose model wasn't found in pricing.json
   * and was costed using the conservative-fallback policy (see
   * CONSERVATIVE_FALLBACK_POLICY in cost.ts). Their cost is still rolled
   * into `totalCostUsd` — the fallback is an upper bound — but a high
   * count means the displayed total has slack relative to the true number
   * and the operator should consider extending the rate card.
   */
  readonly unknownModelSessionCount: number;
};

export type AggregatorOptions = {
  /** Override the on-disk sessions directory (used by tests). */
  readonly sessionsDir?: string;
  /** Override the manifest path resolver (used by tests). */
  readonly metaPathFor?: (sessionId: SessionId) => string;
  /** Inject a transcript reader (used by tests). */
  readonly readTranscriptFor?: (manifest: SessionManifest) => Promise<MessageEvent[]>;
  /**
   * Claude Code projects directory to scan when auto-backfilling. Only
   * consulted by `aggregateDay`. Defaults to `~/.claude/projects/`.
   */
  readonly projectsDir?: string;
  /**
   * When true (default), `aggregateDay` synthesizes manifests for any
   * transcript on disk that doesn't yet have one — see ADR-0007. This
   * makes the report self-healing for sessions whose `SessionStart`
   * hook never fired (background/headless Claude Code runs, or any
   * project where the plugin isn't loaded). Set `false` in tests to
   * keep `aggregateDay` a pure read of the provided sessions dir.
   */
  readonly autoBackfill?: boolean;
};

/**
 * Aggregate a single session: read its manifest + transcript, sum the
 * cost and token totals, derive duration from the manifest. Returns null
 * when the manifest cannot be read.
 */
export async function aggregateSession(
  sessionId: SessionId,
  pricing: PricingProvider,
  options: AggregatorOptions = {},
): Promise<SessionAggregate | null> {
  const metaPath = (options.metaPathFor ?? parallelBurnSessionMetaPath)(sessionId);
  const manifest = await readManifestOptional(metaPath);
  if (manifest === null) return null;
  return aggregateFromManifest(manifest, pricing, options);
}

/**
 * Aggregate from an already-loaded manifest. Splits out for tests and to
 * avoid double-loading when the caller already has a manifest in hand.
 */
export async function aggregateFromManifest(
  manifest: SessionManifest,
  pricing: PricingProvider,
  options: AggregatorOptions = {},
): Promise<SessionAggregate> {
  const reader = options.readTranscriptFor ?? defaultReader;
  const events = await reader(manifest);
  return summarizeSession(manifest, events, pricing);
}

async function defaultReader(manifest: SessionManifest): Promise<MessageEvent[]> {
  try {
    return await readTranscript(manifest.transcript_path);
  } catch {
    return [];
  }
}

export function summarizeSession(
  manifest: SessionManifest,
  events: readonly MessageEvent[],
  pricing: PricingProvider,
): SessionAggregate {
  let cost = 0;
  let input = 0;
  let output = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  let unknownModel = false;
  let model: string | null = null;
  let latestEventTs: number | null = null;
  let earliestEventTs: number | null = null;

  for (const ev of events) {
    const breakdown: CostBreakdown = computeCost(ev, pricing);
    cost += breakdown.total;
    input += ev.usage.input_tokens;
    output += ev.usage.output_tokens;
    cacheRead += ev.usage.cache_read_input_tokens;
    cacheWrite += Math.max(
      ev.usage.cache_creation_input_tokens,
      ev.usage.cache_creation.ephemeral_5m_input_tokens +
        ev.usage.cache_creation.ephemeral_1h_input_tokens,
    );
    if (breakdown.unknownModel) unknownModel = true;
    if (model === null) model = ev.model;
    const t = Date.parse(ev.timestamp);
    if (Number.isFinite(t)) {
      if (latestEventTs === null || t > latestEventTs) latestEventTs = t;
      if (earliestEventTs === null || t < earliestEventTs) earliestEventTs = t;
    }
  }

  // The transcript's own event timestamps are ground truth for when a session
  // was *active*; the manifest's started_at / ended_at / last_seen_active are
  // reliable only for sessions our own hooks instrumented. For backfilled
  // sessions — background/headless runs, the claude-mem observer, any project
  // where the plugin isn't loaded — the manifest is synthesized from a narrow
  // window (often a few seconds) and would collapse a multi-minute session to
  // near-zero duration, silently erasing real concurrent context from the
  // parallelism numerator (the bug that made a 2.4x day read as 1.6x). So
  // whenever the transcript yielded timestamps, the active span is
  // [earliest event, latest event]; the manifest is only a fallback for
  // transcripts we couldn't read.
  // earliestEventTs and latestEventTs are set together — both null when the
  // transcript yielded no parseable timestamps, both non-null otherwise.
  const startedAt =
    earliestEventTs !== null
      ? new Date(earliestEventTs).toISOString()
      : manifest.started_at;
  const lastSeenActive =
    latestEventTs !== null
      ? new Date(latestEventTs).toISOString()
      : (manifest.ended_at ?? manifest.last_seen_active);

  const startMs = Date.parse(startedAt);
  const endMs = Date.parse(lastSeenActive);
  const durationMs = Number.isFinite(startMs) && Number.isFinite(endMs)
    ? Math.max(0, endMs - startMs)
    : 0;

  return {
    sessionId: manifest.session_id,
    project: manifest.project,
    model,
    startedAt,
    endedAt: manifest.ended_at,
    lastSeenActive,
    durationMs,
    messageCount: events.length,
    costUsd: cost,
    inputTokens: input,
    outputTokens: output,
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
    unknownModel,
  };
}

/**
 * List every session manifest currently on disk.
 */
/**
 * Distinct local-date strings (YYYY-MM-DD) across all manifests, sorted
 * ascending. Powers the overlay's "which days have data" strip — a
 * filled dot per active day next to the date picker. Cheap: reads
 * manifest headers only (no transcripts).
 */
export async function listActiveDates(options: AggregatorOptions = {}): Promise<string[]> {
  const manifests = await listSessions(options);
  const dates = new Set<string>();
  for (const m of manifests) {
    const lastActive = m.ended_at ?? m.last_seen_active;
    dates.add(dateOf(lastActive));
  }
  return Array.from(dates).sort();
}

export async function listSessions(options: AggregatorOptions = {}): Promise<SessionManifest[]> {
  const dir = options.sessionsDir ?? parallelBurnSessionsDir();
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (err) {
    if (isFileNotFound(err)) return [];
    throw err;
  }
  const out: SessionManifest[] = [];
  for (const name of entries) {
    if (!name.endsWith(".meta.json")) continue;
    const manifest = await readManifestOptional(`${dir}/${name}`);
    if (manifest !== null) out.push(manifest);
  }
  return out;
}

function isFileNotFound(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    err.code === "ENOENT"
  );
}

/**
 * Aggregate all sessions whose **last activity** falls on the given local
 * `date` (YYYY-MM-DD in the operator's timezone). A session counts as
 * today's if its `last_seen_active` (or `ended_at`) is today — that
 * catches sessions that started yesterday late and continued past
 * midnight, matching the operator's reference session-summary skill.
 *
 * `nowMs` lets tests pin "now" to a deterministic moment.
 */
/**
 * Per-day parallelism limit for transcript reads. Each session aggregation
 * does one transcript read + JSONL parse; on a busy day (100+ sessions)
 * the sequential `for (const m of onDay) { await … }` shape costs 15–30 s.
 * Fanning out via `Promise.all` collapses that to a handful of seconds.
 * We chunk rather than fire-and-forget so a 500-session day doesn't open
 * 500 file handles at once; 32 keeps the libuv pool saturated without
 * pathological memory pressure (each transcript can be MBs).
 */
const AGGREGATE_DAY_CONCURRENCY = 32;

export async function aggregateDay(
  date: string,
  pricing: PricingProvider,
  options: AggregatorOptions = {},
  nowMs: number = Date.now(),
): Promise<DailyAggregate> {
  // ADR-0007: ensure every transcript on disk has a manifest before
  // reading the sessions dir. Without this, sessions whose SessionStart
  // hook never fired (background/headless runs, projects where the
  // plugin isn't loaded) silently drop out of the headline parallelism
  // ratio — the bug that motivated the 1.0.1 patch. Best-effort; a
  // backfill failure must not block the report, so we swallow errors
  // and fall through to whatever manifests already exist.
  if (options.autoBackfill !== false) {
    try {
      await backfillMissingManifests({
        projectsDir: options.projectsDir ?? defaultClaudeProjectsDir(),
        ...(options.sessionsDir !== undefined && { sessionsDir: options.sessionsDir }),
      });
    } catch {
      /* best-effort — see comment above */
    }
  }
  const all = await listSessions(options);
  const onDay = all.filter((m) => {
    const lastActive = m.ended_at ?? m.last_seen_active;
    return dateOf(lastActive) === date;
  });
  const sessions: SessionAggregate[] = new Array<SessionAggregate>(onDay.length);
  for (let i = 0; i < onDay.length; i += AGGREGATE_DAY_CONCURRENCY) {
    const slice = onDay.slice(i, i + AGGREGATE_DAY_CONCURRENCY);
    const batch = await Promise.all(
      slice.map((m) => aggregateFromManifest(m, pricing, options)),
    );
    for (let j = 0; j < batch.length; j += 1) {
      const aggregate = batch[j];
      if (aggregate !== undefined) sessions[i + j] = aggregate;
    }
  }
  return rollUpDay(date, sessions, nowMs);
}

/**
 * Roll an already-aggregated set of sessions into a DailyAggregate. Pure;
 * no I/O. Easier to test the math in isolation.
 *
 * If `date` matches today's local date and `nowMs` is supplied, the
 * latest interval is extended to `nowMs` — ongoing work counts toward
 * wall, matching the operator's session-summary skill.
 */
export function rollUpDay(
  date: string,
  sessions: readonly SessionAggregate[],
  nowMs: number = Date.now(),
): DailyAggregate {
  // `lastSeenActive` already carries the true end of activity: the latest
  // event timestamp when the transcript was readable, the manifest's own end
  // otherwise (see summarizeSession). Use it directly rather than preferring
  // the raw manifest `endedAt`, which is unreliable for backfilled sessions.
  const rawIntervals: Interval[] = sessions
    .map((s) => ({
      start: Date.parse(s.startedAt),
      end: Date.parse(s.lastSeenActive),
    }))
    .filter((i) => Number.isFinite(i.start) && Number.isFinite(i.end));

  // For today's date, extend the latest interval to "now" so ongoing
  // work counts. Use the operator's local-today check: a date matches
  // today if it equals dateOf(now).
  const isToday = date === dateOf(new Date(nowMs).toISOString());
  const intervals = isToday ? extendLatestToNow(rawIntervals, nowMs) : rawIntervals;

  const compression = computeCompression(intervals);

  let totalCost = 0;
  let totalInput = 0;
  let totalOutput = 0;
  let totalCacheRead = 0;
  let totalCacheWrite = 0;
  let unknownModelSessionCount = 0;
  const byProjectMap = new Map<ProjectId, { durationMs: number; costUsd: number; sessionCount: number }>();
  for (const s of sessions) {
    totalCost += s.costUsd;
    totalInput += s.inputTokens;
    totalOutput += s.outputTokens;
    totalCacheRead += s.cacheReadTokens;
    totalCacheWrite += s.cacheWriteTokens;
    if (s.unknownModel) unknownModelSessionCount += 1;
    const existing = byProjectMap.get(s.project) ?? { durationMs: 0, costUsd: 0, sessionCount: 0 };
    existing.durationMs += s.durationMs;
    existing.costUsd += s.costUsd;
    existing.sessionCount += 1;
    byProjectMap.set(s.project, existing);
  }
  const byProject: ProjectAggregate[] = Array.from(byProjectMap.entries())
    .map(([project, agg]) => ({ project, ...agg }))
    .sort((a, b) => b.costUsd - a.costUsd);
  const cacheDisciplineRatio = totalCacheWrite > 0 ? totalCacheRead / totalCacheWrite : 0;
  const promptInputDenominator = totalInput + totalCacheWrite + totalCacheRead;
  const cacheHitPercent =
    promptInputDenominator > 0 ? (totalCacheRead / promptInputDenominator) * 100 : 0;

  return {
    date,
    sessions,
    byProject,
    sessionContextMs: compression.sessionContextMs,
    wallClockWindowMs: compression.wallClockWindowMs,
    spanMs: compression.spanMs,
    compressionRatio: compression.ratio,
    totalCostUsd: totalCost,
    inputTokens: totalInput,
    outputTokens: totalOutput,
    cacheReadTokens: totalCacheRead,
    cacheWriteTokens: totalCacheWrite,
    cacheDisciplineRatio,
    cacheHitPercent,
    unknownModelSessionCount,
  };
}

function extendLatestToNow(intervals: readonly Interval[], nowMs: number): Interval[] {
  if (intervals.length === 0) return [];
  let latestEnd = Number.NEGATIVE_INFINITY;
  let latestIdx = 0;
  for (let i = 0; i < intervals.length; i++) {
    const end = intervals[i]?.end ?? Number.NEGATIVE_INFINITY;
    if (end > latestEnd) {
      latestEnd = end;
      latestIdx = i;
    }
  }
  if (!Number.isFinite(latestEnd) || latestEnd >= nowMs) {
    return [...intervals];
  }
  return intervals.map((iv, i) =>
    i === latestIdx ? { start: iv.start, end: nowMs } : iv,
  );
}
