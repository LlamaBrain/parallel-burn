# ADR-0007: `aggregateDay` Auto-Backfills Missing Manifests

- **Status:** Accepted
- **Date:** 2026-05-23
- **Spec impact:** [SPEC.md](../SPEC.md) §10 Phase 4 (aggregator)
- **Relates to:** [ADR-0003](./0003-no-usage-data-in-posttooluse.md)
  (transcript-derived data plane), [ADR-0006](./0006-claude-stats-cache-for-day-aggregates.md)
  (two-tier data plane)

## Context

ParallelBurn's `aggregateDay` lists session manifests under
`~/.parallel-burn/data/sessions/` and folds them into a `DailyAggregate`.
A manifest is written when the `SessionStart` hook fires (live path) or
when `parallel-burn-backfill` is run explicitly (catch-up path).

The headline parallelism number — `sessionContextMs ÷ wallClockWindowMs`
— is the sum of per-session intervals divided by their merged-interval
wall-clock window. The numerator is bounded by **which sessions have
manifests**.

A 2026-05-23 reconciliation against the operator's reference
`session-summary` skill exposed a hole. `session-summary` reads
`~/.claude/projects/*.jsonl` directly and saw **113 sessions** for the
day; ParallelBurn saw **34**. The 80 missing sessions all belonged to
`claude-mem-observer-sessions` — a background, headless project where
Claude Code runs without the ParallelBurn plugin loaded, so the
`SessionStart` hook never fires and no manifest is ever written.

The wall-clock window matched (≈7h 55m) because the missing sessions
overlapped existing intervals in time. Only the numerator (session
context) was undercounted: 16h 56m vs the correct 24h 30m. The reported
multiplier was **2.1×** instead of **3.1×** — a silently wrong headline,
the worst kind of failure for a tool whose product is a single number.

Manual `parallel-burn-backfill` closed the gap immediately. But making
the user remember to run it before every `/parallel-burn` is a
non-starter — and ROADMAP.md §1.1.0 is explicitly themed around
regression-resistance: *make the same class of silent-undercount bug
visibly impossible to ship again.*

## Decision

`aggregateDay` runs `backfillMissingManifests` as its first step,
synthesizing a manifest for any transcript on disk that doesn't yet
have one. The headline metrics now match whatever transcripts exist —
not whichever subset of sessions happened to load the plugin.

The behavior is opt-out via `AggregatorOptions.autoBackfill: false`.
Tests that mock `sessionsDir` to a tmp path also opt out, so they don't
walk into the operator's real `~/.claude/projects/` directory.
Production paths (`/parallel-burn` CLI, `session-end` summary hook,
server) leave it unset and get the self-healing default.

Backfill failures are swallowed: the report uses whatever manifests
exist, even if the synthesis pass partially or completely failed.
"Best-effort with logged failure" is better than "crash the only
visibility the operator has." The `backfillMissingManifests`
implementation already swallows per-file errors internally; the outer
`try/catch` in `aggregateDay` is belt-and-suspenders for an unexpected
top-level throw.

## Consequences

- **Headline parallelism is now structurally correct.** Every transcript
  on disk participates, with no dependency on whether the plugin was
  loaded when the session ran. The numerator is bounded by what
  actually happened, not by which hooks happened to fire.
- **`aggregateDay` is no longer pure.** It writes to disk before
  reading. The `autoBackfill: false` escape hatch keeps tests pure.
- **First call after install (or after a long gap) is slower.** The
  initial backfill reads up to `MAX_SCAN_LINES = 5000` lines per
  untracked JSONL to extract `cwd` + first/last timestamps. Steady-state
  cost is one `readdir` + one `stat` per file (the existence check
  short-circuits before any line scan).
- **The two write paths to the sessions directory converge.** The
  `SessionStart` hook stays the fast path for live sessions; backfill
  is the catch-up path. Previously these were two separate
  responsibilities operators had to coordinate; now `aggregateDay`
  treats backfill as a write-through cache fill.
- **The bug class itself is gone.** Any future session source that
  doesn't produce a manifest (background tasks, automation scripts,
  alternative front-ends) is automatically picked up the next time
  `/parallel-burn` runs.

## Alternatives considered

- **Bypass manifests entirely; aggregate straight from
  `~/.claude/projects/` transcripts.** This is the
  `session-summary`-skill model. Rejected: per-session pricing
  computation needs the structured manifest path (transcript_path
  resolution, ended-state tracking, schema versioning). Keeping
  manifests as the data plane preserves the existing typed-ID contracts
  and the schema-versioned `SessionManifest`. Backfill makes
  manifests a write-through cache rather than a participation gate.

- **Document the limitation; require operators to run backfill before
  each `/parallel-burn` invocation.** Rejected on UX grounds. The
  tool's job is to show the right number; deferring that to user
  hygiene is the same trap rc.16 was about.

- **Backfill only on `SessionEnd` (write-during-write).** Would close
  the gap for plugin-loaded sessions on next run, but not for the case
  in the precipitating bug — sessions where the plugin never loads at
  all.

- **Date-scoped backfill: scan only transcripts whose last activity is
  on the target date.** Considered. Rejected because the existence
  check (`readManifestOptional`) is cheap and short-circuits before any
  per-file scan. There's no meaningful efficiency win for the gating
  logic, and full-scan is simpler.

- **Backfill on server startup only, not per-request.** Considered for
  the localhost server's poll loop. Per-request is consistent with the
  CLI and summary-hook behavior, and the existence-check short-circuit
  makes steady-state cost negligible. If profiling later shows the poll
  loop is hot enough to matter, the server can flip its
  `autoBackfill` to `false` and call backfill on its own cadence — the
  knob is already in place.

## Open questions

- Should backfill emit a structured log (e.g. JSONL append to
  `~/.parallel-burn/data/backfill.log`) when it creates a non-zero
  number of manifests? Useful for confirming the self-healing is
  actually doing work, and for future regression-resistance dashboards.
  Not implemented in this ADR.
