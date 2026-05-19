# ADR-0006: `~/.claude/stats-cache.json` for Day-Aggregated Metrics

- **Status:** Accepted
- **Date:** 2026-05-19
- **Spec impact:** [SPEC.md](../SPEC.md) §8 (streak), §10 Phase 4
- **Supersedes (partially):** [ADR-0003](./0003-no-usage-data-in-posttooluse.md)
  — transcripts remain the source for per-session detail, but day-level
  aggregates now read from Claude Code's stats cache.

## Context

ADR-0003 committed ParallelBurn to reading per-session transcript JSONLs
under `~/.claude/projects/` as the data plane. That works for per-message
detail and per-session aggregates, but real-world use surfaced two
failure modes:

1. **Transcript retention.** Claude Code prunes transcripts older than
   roughly 30 days. ParallelBurn's `parallel-burn-backfill` on the
   author's machine found exactly 31 days of history (`2026-04-19` →
   `2026-05-19`). Anything beyond that window — longest streaks, monthly
   totals, the months of activity Claude Code can still chart — is not
   recoverable from transcripts.

2. **User-visible mismatch with `/stats`.** Claude Code's built-in
   `/stats` view showed a **57-day** current streak. ParallelBurn's
   transcript-derived computation, with the default `$50/day` threshold,
   showed **18**. Two compounding causes: (a) ParallelBurn's threshold
   knocked out a $31.87 day; (b) even at threshold $0 the answer would
   be 31, since transcripts only cover that far back.

The operator's reaction was the right one: *"If we can't match what
shows in usage or stats we're not doing well."* The right number to show
the user is the number Claude Code shows the user.

## Decision

Use **`~/.claude/stats-cache.json`** as the source of truth for
day-aggregated metrics: streaks, daily activity, all-time totals,
longest-streak history. It is maintained by Claude Code itself, holds
~5 months of history on the author's machine, and is exactly the data
the `/stats` view renders — so matching it is matching the user-visible
authoritative number by construction.

Transcripts under `~/.claude/projects/` remain the source for
**per-session detail**: the per-session table in `/parallel-burn`,
session start/end times, per-session cost computation against
`pricing.json`. They are not replaced — they're scoped to where they're
canonical.

Concretely, `src/core/claude-stats.ts` ships:

- `readStatsCache(path?)` — async loader + validator (rejects unsupported
  schema versions explicitly).
- `parseStatsCache(raw)` — pure synchronous validator, table-tested.
- `computeActiveStreak(today, dailyActivity, todayHasActivityOverride)`
  — consecutive days with `sessionCount > 0`, walking backwards from
  `today`. The override lets the caller stamp the current day as
  "active" when transcripts confirm in-flight activity but the cache
  hasn't been recomputed yet (Claude Code computes the cache offline).
- `computeLongestActiveStreak(dailyActivity)` — longest historical run.

## Consequences

- **Streak matches `/stats` by construction.** Same data source, same
  definition (`sessionCount > 0`), same calendar bucketing.
- **All-time aggregates become available.** Longest streak, total
  sessions, first-session date — all sitting in the cache.
- **Per-day, per-model tokens are available, but without input / output
  / cache breakdown.** The cache's `dailyModelTokens` is a single number
  per `(date, model)` pair. Pricing.json wants separate input / output /
  cache rates. For per-day cost we apportion using ratios from
  `modelUsage` (cumulative breakdown) — close but not exact for days
  where the operator's input/output mix differs from the cumulative
  average. The exact per-day cost still comes from transcripts when
  available; the cache is the long-tail fallback.
- **Two-tier data plane.** Today (and any post-`lastComputedDate` day)
  uses transcripts; everything older uses the cache. The streak
  calculation combines both — `todayHasActivityOverride` is the seam.
- **Soft dependency on an undocumented internal cache.** Claude Code can
  change the `stats-cache.json` schema without warning.
  `parseStatsCache` returns `null` on any version mismatch, and callers
  fall back to transcript-only data with a soft-warn UX rather than
  crashing. The cache schema version is currently `3`; we accept only
  that.

## Alternatives considered

- **Keep using transcripts only, document the mismatch in the README.**
  Rejected: the user's reaction makes clear that "matches `/stats`" is a
  non-negotiable UX bar. Documenting the mismatch is admitting a bug.
- **Recompute the cache ourselves from transcripts.** We can't —
  transcripts beyond ~30 days are gone. We'd need to capture them as
  they're written, which is a much larger surface.
- **Ship a separate `parallel-burn-stats-mirror` daemon that watches
  transcripts and persists its own long-term cache.** Possibly worth it
  long-term, but redundant with what Claude Code already does well.

## Open questions

- The cache's `dailyModelTokens` lacks an input/output/cache breakdown.
  Is there a more granular dump anywhere on disk that we could consume
  instead? Worth a follow-up audit.
- `~/.claude/usage-data/` (with `session-meta/` and `facets/`) looks
  like another structured data store. Not yet inspected.
