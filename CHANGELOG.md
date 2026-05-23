# Changelog

All notable changes to ParallelBurn will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.1] — 2026-05-23

### Fixed

- **Headline parallelism multiplier was silently undercounting on days
  with sessions that didn't load the plugin.** `aggregateDay` listed
  manifests under `~/.parallel-burn/data/sessions/` and folded only
  those into the daily aggregate. Background/headless Claude Code
  sessions where the `SessionStart` hook never fires (e.g. the
  `claude-mem-observer-sessions` project on the author's machine —
  80 sessions, ~7h 44m of session-context) had no manifest and so
  dropped silently out of the numerator. The wall-clock window was
  unaffected (those sessions overlapped existing intervals), so only
  the ratio shifted: a 2026-05-23 reconciliation against the operator's
  reference session-summary skill showed **2.1× → actual 3.1×**, a
  ~33% undercount with no UI signal that the number was wrong.

  Fix: `aggregateDay` now calls `backfillMissingManifests` as its
  first step, synthesizing manifests for any transcript on disk that
  doesn't yet have one. The headline metrics now reflect whatever
  transcripts exist, not whichever subset of sessions happened to load
  the plugin. Opt-out via `AggregatorOptions.autoBackfill: false` for
  tests. See [ADR-0007](./ADRs/0007-aggregate-day-auto-backfills-missing-manifests.md)
  for the full rationale, alternatives considered, and consequences.

### Added

- `AggregatorOptions.autoBackfill?: boolean` — opt-out for the new
  auto-backfill in `aggregateDay`. Defaults to `true`.
- `AggregatorOptions.projectsDir?: string` — override the Claude Code
  projects directory the auto-backfill scans. Defaults to
  `~/.claude/projects/`. Tests that mock `sessionsDir` should also set
  `autoBackfill: false` (or supply both `sessionsDir` and
  `projectsDir` as tmp paths) to stay isolated from the operator's
  real transcript directory.

### Tests

- 289 unit tests passing (was 288). One new test exercises the
  auto-backfill path: a transcript-without-manifest is synthesized
  and shows up in the daily aggregate. The existing `aggregateDay
  groups by start date` test now passes `autoBackfill: false` for
  the same isolation reason.

## [1.0.0] — 2026-05-22

**Stable release.** Promoted from `v1.0.0-rc.17` with no code
changes — only the version string. The cumulative work that
landed across rc.5 → rc.17 is captured under each rc's entry
below; this entry is the cut, not new work.

### What 1.0 delivers

ParallelBurn surfaces parallelism, cache discipline, and retail-
price cost from your live Claude Code sessions, with a localhost
overlay suitable for OBS browser-source rendering.

- **Hook layout** that fires reliably on Windows (rc.5 — split
  metadata + hooks into `.claude-plugin/` and `hooks/`).
- **Server autostart** from `SessionStart` with an idempotent
  detached spawn (rc.6).
- **Streak** that survives Claude Code's stale `stats-cache.json`
  via manifest-derived enrichment (rc.7).
- **Cost accuracy** end-to-end:
  - Date-suffixed model IDs normalize to family rates (rc.8).
  - Sonnet 4.5 + Opus 4.5 added (rc.9).
  - `CONSERVATIVE_FALLBACK_POLICY` named + `unknownModelSession
    Count` surfaced (rc.10).
  - Subagent double-count audit closed (rc.12).
  - **Opus tier rate correction — was 3× too high since v0.0.3**
    (rc.16). Caught by the very procedure designed to catch it
    (rc.11 / rc.17).
- **`/api/day?date=YYYY-MM-DD`** for browser-driven reconciliation
  (rc.14).
- **`npm run install:local`** centralizing the per-RC sync
  (rc.13).
- **288 unit tests** + a Path B reconciliation that matched a
  hand-computed Sonnet 4.5 session to the sixth decimal (rc.17).

### What's deliberately *not* in 1.0

See `ROADMAP.md`. 1.1.0 picks up the regression-resistance work
the rc.16 episode argued for (pricing-staleness visibility,
codified spot-check script, extended rate card). Per-session
overlay breakdown, nightly CI history, and wrapper-script
discipline are further-out backlog.

### Subscription operators: what the dollar number means

ParallelBurn shows *list-price retail cost* — what your work
would cost at API rates. On a monthly subscription plan, you do
not actually pay this number; it's a "value extracted from the
subscription" signal. The `subsidyMultiplier` field on the
DailyAggregate is the ratio of retail cost to your prorated
monthly fee.

## [1.0.0-rc.17] — 2026-05-22

**Reconciliation procedure gains a subscription-user path and
records its first pass.** Path A (console comparison) is now
documented as the API-billing operator's procedure. Path B
(published-rate-card verification + hand-computed spot check) is
the new subscription-user procedure — both subscription operators
and pay-as-you-go operators can verify cost accuracy with paths
appropriate to their billing model.

Path B passed on rc.16. The results log records:

- **Step 1 — Rate card verification.** All ten model entries in
  `pricing.json` match the published table at
  `https://platform.claude.com/docs/en/about-claude/pricing` for
  every field. (rc.15 didn't — that's how the Opus tier bug was
  found.)
- **Step 2 — Hand-computed spot check.** A small Sonnet 4.5
  session was costed by hand from its token counts and rates;
  parallel-burn's reported `costUsd` matched to the sixth
  decimal (`$0.028034` vs hand-compute `$0.028034`).

The 1.0 reconciliation blocker is **closed on rc.17** with the
rc.16 rate fix locked in.

## [1.0.0-rc.16] — 2026-05-22

**Opus tier pricing was 3× too high since v0.0.3. Corrected.**
This is exactly the class of bug the reconciliation procedure
exists to catch — and the moment it did, on the first read of
Anthropic's published rate card.

### The bug

`pricing.json` had `claude-opus-4-7`, `claude-opus-4-6`, and (added
in rc.9) `claude-opus-4-5` keyed at `$15 input / $75 output` per
MTok. Those are the **deprecated Opus 4.0/4.1 rates**. The current
Opus 4.5+ rates are `$5 input / $25 output`, and have been since
the 4.5 generation shipped. Every Opus session in every operator's
history has been displayed at 3× its real cost since v0.0.3.

Sonnet 4.x and Haiku 4.5 rates are correct and unchanged.

### What changed

`pricing.json` now matches Anthropic's published rate card at
`https://platform.claude.com/docs/en/about-claude/pricing`:

| Model | input | 5m write | 1h write | cache read | output |
|---|---|---|---|---|---|
| claude-opus-4-7  | $5 | $6.25 | $10 | $0.50 | $25 |
| claude-opus-4-6  | $5 | $6.25 | $10 | $0.50 | $25 |
| claude-opus-4-5  | $5 | $6.25 | $10 | $0.50 | $25 |
| claude-opus-4-1  | $15 | $18.75 | $30 | $1.50 | $75 (legacy) |
| claude-opus-4-0  | $15 | $18.75 | $30 | $1.50 | $75 (deprecated) |
| claude-sonnet-4-6 | $3 | $3.75 | $6 | $0.30 | $15 |
| claude-sonnet-4-5 | $3 | $3.75 | $6 | $0.30 | $15 |
| claude-sonnet-4-0 | $3 | $3.75 | $6 | $0.30 | $15 (deprecated) |
| claude-haiku-4-5  | $1 | $1.25 | $2 | $0.10 | $5 |
| claude-haiku-3-5  | $0.80 | $1 | $1.60 | $0.08 | $4 (retired) |

Legacy entries added because survey of older transcripts shows
those model IDs in use. The rc.8 date-suffix normalization handles
the dated variants (`-20250514`, `-20250805`, etc.) on top.

### Operator impact

- Every historical day's `totalCostUsd` drops to roughly **1/3 of
  the previous display** for Opus-heavy work. Sonnet/Haiku days
  unchanged.
- The `subsidyMultiplier` (cost / subscription) gets correspondingly
  smaller — apparent subscription savings were overstated.
- `pricingAsOf` bumped to `2026-05-22` because the rates were
  re-sourced from Anthropic.

### How this got caught

The subscription-user reconciliation path (rc.17) starts with
"verify pricing.json against Anthropic's published rates." The
first read of that page surfaced this. The 285 unit tests passed
throughout — none of them check pricing.json values against an
external source. Pinning the rate card to source is now an
expectation on every operator running reconciliation.

288 tests still passing (test fixtures use their own pricing docs,
not live pricing.json).

## [1.0.0-rc.15] — 2026-05-22

**Cache-hit % gains a second decimal near saturation.** Plain
`.toFixed(1)` collapses 99.94 → 100.0, which hides drift across
the saturation line — the operator can't tell whether their cache
is at perfect saturation or merely close. rc.15 switches the
overlay's renderer to two decimals for values ≥ 99, one decimal
below.

### Changed

- `src/server/overlay.ts` — new `fmtCacheHit(p)` JS-side
  formatter. Sub-99 displays unchanged (e.g. `98.3%`); ≥ 99 now
  surfaces the second decimal (e.g. `99.94%`, `99.98%`, `100.00%`).

## [1.0.0-rc.14] — 2026-05-22

**`GET /api/day?date=YYYY-MM-DD` for browser-driven reconciliation.**
The reconciliation procedure (rc.11) assumed terminal access to
invoke the CLI for historical days. Operators with browser-only
access (no shell) were blocked — they could see today via
`/api/today` but couldn't sample the older days the procedure
requires. rc.14 closes that gap by computing the day's aggregate
on demand and returning the same shape as `/api/today`.

### Added

- **`GET /api/day?date=YYYY-MM-DD`** — re-aggregates the named day
  fresh (not cached). Returns
  `{ date, aggregate, pricingAsOf, pricingStale, computedAt }`.
  Reads each session's transcript so this is not a fast endpoint —
  expect 100–500 ms on a busy day, longer for days with many
  manifests. 400 on missing/malformed `?date=`, 500 on aggregator
  exceptions.
- Three server tests cover the happy path, missing-param, and
  malformed-date. The empty-day case (`2020-01-01`) confirms the
  pricing-fixture echoes through correctly.

### Changed

- `verification/cost-reconciliation.md` now leads with the
  browser-friendly URL form for both today and historical days.
  CLI invocation is retained as a fallback for terminal users.

## [1.0.0-rc.13] — 2026-05-22

**`npm run install:local` + cost-reconciliation runbook fix.** Two
small operator-DX items that bunch together because they ship at
the same time and the reconciliation doc only becomes useful once
the install path is repeatable.

### Added

- **`scripts/install-local.mjs`** + `npm run install:local` —
  builds and copies the same payload that prior commits had been
  syncing manually (`dist/`, `commands/`, `ADRs/`,
  `.claude-plugin/`, `hooks/`, `verification/`, `pricing.json`,
  `package.json`, `README.md`, `LICENSE`, `CHANGELOG.md`,
  `SPEC.md`) into
  `~/.claude/plugins/cache/llamabrain/parallel-burn/<version>/`.
  Destination version is derived from `package.json` so the cache
  directory always matches the current rc. Cross-platform via
  `fs.cpSync`.

### Fixed

- `verification/cost-reconciliation.md` had `node ... day
  2026-05-19` for the historical-day CLI invocation — there is no
  `day` subcommand. The CLI takes the date as a bare positional
  arg. Corrected, and the doc now explicitly points at the
  headline line of the report (`"$X list-price across N sessions"`)
  as the number to record.

## [1.0.0-rc.12] — 2026-05-22

**Subagent double-count audit complete — no code change required.**
Adds `verification/subagent-audit.md` analyzing whether the 12
`agent-*` sessions reported `$0.00` on 2026-05-19 represented (a)
correct attribution or (b) silently lost cost. The answer is (a):
Claude Code no longer emits separate `agent-*.jsonl` transcripts;
parent-transcript usage fields bill the subagent loop directly;
historical agent manifests with missing transcripts contribute $0,
which is arithmetically incapable of double-counting. The audit
also documents the future-proofing signals (the reconciliation
procedure + `unknownModelSessionCount`) that would detect a
regression if Anthropic changes the attribution model.

## [1.0.0-rc.11] — 2026-05-22

**Cost-reconciliation procedure documented.** Adds
`verification/cost-reconciliation.md`, a step-by-step runbook for
comparing parallel-burn's `totalCostUsd` against the Anthropic
console for the same operator on the same day. Includes timezone
caveats, what divergence directions indicate (high + nonzero
`unknownModelSessionCount` → fallback inflation), and an
append-only results-log table for tracking reconciliation across
release candidates. Three rows within 1 % tolerance gates the
stable v1.0.0 tag.

## [1.0.0-rc.10] — 2026-05-22

**Unknown-model fallback policy is now named, asserted, and
surfaced.** CLAUDE.md said "log a warning and use a conservative
fallback" but the implementation's actual policy (overestimate via
max-output-per-mtok) was buried in a comment and not under test —
and downstream consumers had no way to see how many of today's
sessions were fallback-priced.

### Added

- **`CONSERVATIVE_FALLBACK_POLICY`** exported from `cost.ts` —
  documents the selector (`max-output-per-mtok`) and direction
  (`overestimates`) with multi-paragraph rationale. Locking the
  policy into a named, testable surface makes future drift visible.
- **`DailyAggregate.unknownModelSessionCount`** — running count of
  sessions on the day whose model was costed via fallback. Their
  cost is still rolled into `totalCostUsd` (the fallback is an
  upper bound on truth), but a high count signals slack in the
  total — actionable signal that the rate card needs extending.
- Two tests pin the constant to the implementation, plus a third
  verifies the selector picks the max-output model regardless of
  iteration order.

## [1.0.0-rc.9] — 2026-05-22

**Sonnet 4.5 and Opus 4.5 added to pricing.json.** Survey of today's
in-flight transcripts surfaced both families in active use
(`claude-sonnet-4-5-20250929`, `claude-opus-4-5-20251101`), but
neither family root was in the rate card — every session ran on
those models was billing at the conservative fallback rather than
the real tier rate, regardless of the rc.8 normalization. With
rc.9 the date-suffixed IDs strip to a key that now exists.

### Pricing

- `claude-opus-4-5`: rates extrapolated from `claude-opus-4-7` /
  `claude-opus-4-6` — Anthropic's Opus-tier pricing has been
  consistent across model generations.
- `claude-sonnet-4-5`: rates extrapolated from `claude-sonnet-4-6`
  on the same logic.

Both are tier-extrapolations, not directly verified from an
Anthropic invoice; the manual-reconciliation blocker on the
roadmap is the canonical check. `pricingAsOf` left at `2026-05-19`
because the underlying tier rates have not been re-sourced; only
new keys were added.

## [1.0.0-rc.8] — 2026-05-22

**Date-suffixed model IDs now resolve to family rates.** Anthropic's
transcripts emit fully-qualified IDs like `claude-haiku-4-5-20251001`,
while `pricing.json` keys the family root `claude-haiku-4-5`. Before
rc.8 every dated ID missed the lookup and silently fell through to
the conservative-fallback rate (the most-expensive model in the rate
card). On 2026-05-19, 47 of 70 observer sessions were billed at the
fallback instead of the real Haiku rate, materially inflating the
displayed daily total.

### Added

- **`normalizeModelId(model)`** — strips a trailing `-YYYYMMDD`
  9-character suffix (dash + 8 digits). Exported so other modules
  (transcript readers, logging) can reuse the same canonical form.
- Six tests covering the normalization: dated lookup succeeds,
  exact match wins over normalized form, brand-new model IDs still
  fail closed, non-8-digit trailing tokens and trailing words like
  `-preview` are *not* stripped, and the empty string is safe.

### Changed

- **`PricingProvider.get` / `has`** retry with the normalized form
  after an exact-key miss. Brand-new model IDs whose family root
  isn't in the rate card still return `undefined` and fall through
  to the conservative fallback in `computeCost`, which is the
  fail-closed contract called out in CLAUDE.md.

## [1.0.0-rc.7] — 2026-05-22

**Streak no longer truncates when `~/.claude/stats-cache.json` is
stale.** Claude Code recomputes that cache on its own schedule —
often a day or more behind real time. Before rc.7, the streak
walk read the cache, stamped today as active via the override,
and then broke on the first missing day between today and the
cache's `lastComputedDate`. Result: a real 61-day active streak
displayed as `1d` on any morning before the cache caught up. The
data needed to fix it was already on disk in
`~/.parallel-burn/data/sessions/` — we just weren't using it.

### Added

- **`enrichDailyActivityWithRecent`** in `claude-stats.ts`. Given
  the cache's `dailyActivity`, parallel-burn's own session
  manifests, and the cache's `lastComputedDate`, synthesizes
  `DailyActivity` entries for each post-cache date by counting
  manifests on that date. Cache entries are preserved verbatim —
  the cache's session counts include subagent sessions that
  parallel-burn's per-session manifests don't, so we only fill
  in the gap, never overwrite.
- Four tests covering synthesis, no-double-count on the cache
  edge, a full integration with `computeActiveStreak`, and
  rejection of manifests with unparseable timestamps.

### Changed

- **`computeStreakFromClaudeStats` in `server.ts`** now calls
  `listSessions` and merges through `enrichDailyActivityWithRecent`
  before walking. Both callers (`buildSnapshot` for HTTP and
  `refreshStreakCache` for the slow tick) pass their
  `aggregatorOptions` through so test seams keep working.

## [1.0.0-rc.6] — 2026-05-22

**Server autostart from SessionStart.** Until rc.6, the localhost
server had to be launched by the operator (`parallel-burn serve`
or `node dist/cli/serve.js`) and lived across sessions as a
manually-managed long-running process. The overlay, statusline,
and any SSE consumer silently degraded when it wasn't running,
and there was no signal to the operator that they had forgotten.
Hook discovery (rc.5) was a prerequisite — without a working
SessionStart there was nowhere to put the spawn logic.

### Added

- **`src/core/ensure-server.ts`** — `isPortListening(port)` does a
  ~250ms TCP probe against 127.0.0.1; `ensureServerRunning(opts)`
  spawns `dist/cli/serve.js` as a detached, unref'd child when
  the probe fails. The child inherits no stdio from the parent
  (logs append to `~/.parallel-burn/logs/server.log`), so the
  hook process exits immediately and the server survives.
  Spawn-time `cwd` is the plugin root so the server's default
  `./pricing.json` resolution works.
- SessionStart hook now calls `ensureServerRunning` after writing
  the manifest. Re-running the hook is a no-op when the port is
  already listening — including when *another* parallel-burn
  session started the server, which is the common case on a
  multi-session day.
- Vitest coverage for `isPortListening` (real ephemeral listener
  for the positive case, no-listener and listener-closed for the
  negative cases) and `ensureServerRunning` (injected probe and
  spawner so tests never actually fork node).

### Notes

- SessionEnd does *not* stop the server — it is a per-machine
  resource, not a per-session one. An operator who wants the
  server gone can Ctrl-C it or kill the PID.
- The probe assumes whatever is listening on the configured port
  is parallel-burn (or some service the operator wants to leave
  alone). If a third party stole port 37337, we skip the spawn
  and the overlay quietly fails. Pick a different port in
  `~/.parallel-burn/config.json` if that bites.

## [1.0.0-rc.5] — 2026-05-22

**Hook discovery fix for Windows.** rc.4 declared hooks in the root
`plugin.json`, but the Claude Code harness on Windows did not pick
them up — a fresh session on 2026-05-19 produced a transcript but
no manifest, and neither SessionStart nor SessionEnd fired. The
real-time data plane (manifest writes, end-of-session summary,
overlay liveness) was effectively dead, leaving `parallel-burn
backfill` as the only path that populated state. The reference
working plugin (`claude-mem`) splits metadata into
`.claude-plugin/plugin.json` and hooks into `hooks/hooks.json` at
the plugin root; ParallelBurn now mirrors that layout.

### Changed

- **Plugin manifest layout.** Root `plugin.json` removed.
  Metadata moved to `.claude-plugin/plugin.json` (no `hooks` block
  there). Hooks moved to `hooks/hooks.json` under the
  `{"description", "hooks"}` envelope claude-mem uses. The
  `${CLAUDE_PLUGIN_ROOT}` command strings are unchanged — only
  the file they live in moved.
- **`package.json` `files`** updated: `plugin.json` removed,
  `.claude-plugin/` and `hooks/` added so the new layout actually
  ships in any future npm artifact.

### Added

- `DailyAggregate.cacheHitPercent` — fraction of prompt-input bytes served
  from cache, computed as
  `cacheReadTokens / (inputTokens + cacheWriteTokens + cacheReadTokens) * 100`.
  `cacheWriteTokens` (cache-creation) is in the denominator because creating
  a new cache entry is a *miss*: those tokens had to be re-prompted to
  populate the cache, not served from it. Excluding `cacheWriteTokens`
  would make the metric asymptote to ~100% after the first few cache-priming
  turns of any long session. Surfaced on the overlay in place of the
  subsidy multiplier.

### Changed

- **Overlay**: replaced the `subsidy` row with a `cache hit` row
  showing the cache hit percent. Subsidy is still computed and
  available on the snapshot JSON for any API consumer that wants it.
- Overlay now collapses the `wall` and `span` rows into one
  `wall · span (continuous)` row when the two values agree within a
  1-minute tolerance. On a continuous-overlap day (no idle gaps > 15
  min between sessions, like today on the operator's machine) the two
  numbers are identical by definition; collapsing them reclaims a row
  and surfaces the day's continuity as a label.

## [1.0.0-rc.4] — 2026-05-19

**Dashboard expansion + numerical alignment with the operator's
reference `/session-summary` skill.** rc.3 shipped a streak that matched
Claude Code's `/stats` view; rc.4 closes the gap on the *day-level
math*: wall-clock, span, session-context, and parallelism multiplier now
align with the skill's algorithm, and the overlay grows into a real
in-terminal/in-OBS dashboard surfacing the metrics the operator asked
to see.

### Changed (math alignment with `/session-summary` skill)

- **`mergeIntervals`** now takes a `gapToleranceMs` option (default
  **15 minutes**). Two sessions separated by ≤ 15 min collapse into a
  single block — same threshold the operator's skill uses. Pass
  `gapToleranceMs: 0` for strict-overlap merging (the pre-rc.4
  behavior).
- **`computeCompression`** also returns `spanMs` (naive
  `max(end) − min(start)`) alongside `wallClockWindowMs`. Useful as a
  diagnostic: if span ≫ wall, the day had idle stretches between
  active blocks.
- **`aggregateDay`** now buckets sessions by `localDateOf(last_seen_active)`
  rather than `started_at` — a session that started yesterday late but
  ran into today counts as today's. For today's date, the latest
  interval is extended to "now" so ongoing work counts toward wall.
- **`dateOf` is now local-timezone**. ISO timestamps render to the
  operator's local YYYY-MM-DD instead of the UTC slice. An 11 PM PDT
  session lands in the PDT day, not the next UTC day. (Also exported
  `localToday(now)` for the "what is today's date?" question.)
- **`summarizeSession`** derives session start / last-seen from the
  *transcript events themselves* when available, instead of trusting
  the manifest's potentially-stale `last_seen_active`. Active sessions
  that have appended events since the last backfill now report current
  state.
- **`backfill` recurses into `<session-id>/subagents/agent-*.jsonl`**.
  The skill's `find ... -name "*.jsonl" -type f` traversal includes
  these subdirectories; ours did not. Discovered 395 additional
  transcripts on the operator's machine when re-run.

### Added (dashboard)

- **Expanded `LiveSnapshot`**: `spanMs`, `longestStreak`, `computedAt`
  fields. The empty/warming snapshot includes a `warming: true` flag so
  the overlay can dim its display until the cache warms.
- **Rewritten overlay HTML** (`src/server/overlay.ts`): no longer a
  4-row card. New layout:
  - Hero row: `2.5×` parallelism multiplier (large, accent color).
  - 12-cell metric grid: today's list-price, subsidy multiplier,
    session-context, wall (merged), temporal span, sessions count,
    tokens in / out, cache writes / reads, cache rate, streak (with
    longest as a secondary).
  - Footer: live-status dot, pricing as-of.
  - Warming-mode opacity dim during initial cache hydration.

### Verified (on the operator's machine, live)

Side-by-side against the reference skill (run within the same minute):

| Metric            | Skill   | ParallelBurn rc.4 | Delta |
| ----------------- | ------- | ----------------- | ----- |
| Sessions          | 68      | 68                | 0     |
| Session-context   | 1017 min | 954 min          | -6 %  |
| Wall (merged)     | 369 min | 382 min          | +3.5 % |
| Span              | 369 min | 382 min          | +3.5 % |
| Parallelism       | 2.75×   | 2.50×            | -0.25 |
| Streak            | 57d     | 57d              | 0     |

Remaining drift on context/parallelism: the skill greps `"timestamp":` from
**all** event types in a transcript (attachments, user messages, hook
records). ParallelBurn currently derives first/last timestamps only
from `type: "assistant"` events. Documented; safe to leave for rc.5.

- `tsc --strict` clean, `eslint --quiet` clean, `npm run build` clean.
- **262 Vitest tests pass.**
- **Plugin uninstalled at rc.3, re-installed at rc.4** via
  `claude plugin install parallel-burn@llamabrain`. `claude plugin list`
  confirms.
- **Server running on PID 7300** at `http://127.0.0.1:37337`. `curl
  /api/today` returns the warmed snapshot in ~1 ms. The combined
  statusline shim runs in ~950 ms (dominated by the
  `ccstatusline-usage` npx resolve).

### Still awaiting human verification

The remaining items from rc.1's checklist that need a fresh Claude Code
session to confirm: hooks firing from Claude Code, the statusline
rendering in-app under the input area, the OBS browser source actually
displaying in OBS, and the `/parallel-burn` / `/streak` /
`/parallel-burn-backfill` commands showing up in `/help`.

[1.0.0-rc.4]: https://github.com/LlamaBrain/parallel-burn/releases/tag/v1.0.0-rc.4

## [1.0.0-rc.3] — 2026-05-19

A working release candidate, surfaced and shaped by real-world use. Five
things land in this RC: a performance fix for the server under realistic
data volumes, a streak data-source pivot to match Claude Code's `/stats`
view, a substantially polished session-summary, a cache-rate metric in
the statusline, and an out-of-tree shim that lets ParallelBurn coexist
with the operator's existing `ccstatusline-usage` statusline.

### Changed

- `src/server/server.ts`:
  - `buildSnapshot` factored into `buildDailyCostMap` (slow, walks
    last-31-day manifests) and `buildTodaySnapshot` (fast, uses a
    cached daily-cost map and re-aggregates only today's sessions).
  - `startServer` runs two timers: `TODAY_POLL_INTERVAL_MS` (15 s)
    pushes today's aggregate; `STREAK_REFRESH_INTERVAL_MS` (5 min)
    refreshes the cached daily-cost map.
  - Initial population is deferred via `setImmediate` so the HTTP
    server is responsive from the moment `listen()` returns.
  - `GET /api/today` and `GET /api/current` now serve the cached
    snapshot JSON synchronously. If the cache is cold (server just
    booted), an empty-but-shape-valid snapshot is returned with
    `warming: true`. Consumers (overlay, statusline) handle the warm-up
    transparently.
  - `ServerConfig` gains an optional `sessionsDir` field so tests
    isolate from the operator's real `~/.parallel-burn/data/sessions/`.
    Without this the post-backfill 3 116-manifest dir was making
    tests time out.
- `src/cli/statusline.ts`:
  - Tries `GET http://127.0.0.1:<port>/api/today` first (250 ms
    timeout). On success uses that snapshot; ~100 ms total tick.
  - Slow-path fallback now also applies the 31-day lookback filter so
    standalone use isn't ruinously slow either. Opt out with
    `PARALLEL_BURN_NO_SERVER_FETCH=1` (forces the slow path).

### Added

- **`ADRs/0006-claude-stats-cache-for-day-aggregates.md`** — partially
  supersedes ADR-0003 for day-level metrics. ParallelBurn now reads
  `~/.claude/stats-cache.json` as the source for streak / daily activity
  numbers, matching what Claude Code's `/stats` view shows. Transcripts
  remain the source for per-session detail.
- `src/core/claude-stats.ts` — async loader + table-tested parser for
  Claude Code's stats cache, plus `computeActiveStreak(today, activity,
  todayHasActivityOverride)` and `computeLongestActiveStreak(activity,
  today?, todayHasActivityOverride?)`. Rejects unsupported schema
  versions; falls back to zero streaks if the cache is missing.
- `LiveSnapshot.longestStreak` field, surfaced through `/api/today`,
  the overlay, and the statusline.
- Polished session-summary (`src/core/summary.ts`):
  - Narrative opener mimics the operator's reference tooling style —
    "session-context compressed into N of real wall — a Y× parallelism
    multiplier", followed by an explicit **span vs. merged-wall**
    sentence ("Span and wall lined up almost perfectly" /
    "Span (N min) ran M minutes longer than the W-min merged wall —
    meaningful idle stretches between active blocks").
  - Sessions render in a **box-drawing table** (`┌─┐│└─┘`), sorted by
    cost desc, capped at 15 rows with a `...and N more` overflow line.
  - Closing **Tokens line** with `K-in / M-out / cache-writes /
    cache-reads (X× cache rate) — the {Plan} subscription is the only
    reason this isn't a car payment.` punchline.
- `cacheDisciplineRatio` is now surfaced in the statusline output
  (`⊕ 4.0× parallel · $123 today · 18.0× cache · streak 57d`) and
  the server's API JSON.

### Out of tree (for the operator's local setup)

- Shim at `~/.claude/scripts/statusline-combined.js` (not in this repo)
  that runs `ccstatusline-usage` and ParallelBurn's statusline in
  parallel and concatenates their outputs with a separator. Wired into
  `~/.claude/settings.json`'s `statusLine.command`. Lets the operator
  keep their existing usage line and add ParallelBurn's line beside it.

### Verified

- `tsc --strict` clean, `eslint --quiet` clean, `npm run build` clean.
- **259 Vitest tests pass** (up from 237 in rc.2). New tests cover
  `claude-stats` schema validation, `computeActiveStreak` with override,
  `computeLongestActiveStreak`, and the rewritten summary's narrative
  shape / box-drawing table / cache-rate line / span-vs-wall description.
- **Streak now matches Claude Code's `/stats` view exactly.** On the
  operator's machine the new computation returned `57d current / 57d
  longest`, matching the in-app stats screen to the day.
- **End-to-end timing on the operator's machine** (with 3 116 manifests
  + 4 544 sessions in Claude Code's stats cache):
  - `GET /api/today` (cached): **~1 ms**
  - `node dist/cli/statusline.js` (fast path via server): **~108 ms**
  - Combined shim (ccstatusline-usage in parallel): **~950 ms**,
    dominated by `npx -y ccstatusline-usage@latest`; ParallelBurn's
    contribution is in-the-noise.
- Plugin reinstalled at `1.0.0-rc.3` via `claude plugin install
  parallel-burn@llamabrain`; `claude plugin list` confirms the new
  version is registered and enabled at user scope.
- The `statusLine.command` in `~/.claude/settings.json` now points at
  the combined shim. **Live verification of the statusline rendering
  inside Claude Code is still TBD** — needs a fresh Claude Code session.

### Still awaiting human verification

The remaining `rc.1` checklist items (hooks firing from Claude Code,
SessionStart → manifest, SessionEnd → summary, slash commands appearing
in `/help`, overlay live in OBS) all need a fresh Claude Code session
to confirm. Stable `1.0.0` is gated on that confirmation.

[1.0.0-rc.3]: https://github.com/LlamaBrain/parallel-burn/releases/tag/v1.0.0-rc.3

## [1.0.0-rc.2] — 2026-05-19

Adds the **backfill** command — the missing piece for users (like the
author) who install ParallelBurn after running Claude Code for a while.
Backfill scans `~/.claude/projects/` and synthesizes a `SessionManifest`
for every Claude Code transcript that doesn't already have one. Same RC
gating as `rc.1` — stable `1.0.0` still requires human verification of
the live-hook firing path.

### Added

- `src/core/backfill.ts` — async `discoverTranscripts` generator that
  walks every `<encoded-cwd>/<session-id>.jsonl` and extracts the
  `cwd`, first/last timestamp, and assistant-message count from each
  file (capped at 5 000 lines of scan per transcript so it stays fast
  on multi-MB files). `backfillMissingManifests` is the integration
  layer: for every discovered session not already tracked, synthesize a
  manifest. Existing manifests are skipped — backfill is idempotent.
- `src/cli/backfill.ts` — `parallel-burn-backfill` CLI. Flags:
  `--leave-open` (treat every backfilled session as still-active by
  leaving `ended_at: null`; default sets `ended_at` from the last
  transcript timestamp); `--quiet` / `-q` (skip per-session log lines).
  `renderBackfillReport` is the pure terminal formatter, table-tested.
- `commands/parallel-burn-backfill.md` — the matching Claude Code slash
  command shim. `/parallel-burn-backfill` from within a session.
- `bin` entry: `parallel-burn-backfill` → `dist/cli/backfill.js`.
- 19 new Vitest tests across `tests/backfill.test.ts`: discovery edge
  cases, idempotency (skip-when-already-tracked), the `--leave-open`
  flag, malformed-line tolerance, the `projectNameFromCwd` extractor,
  and the CLI renderer's singular/plural correctness.
- **Real-world smoke** on the author's machine: backfill discovered
  **3,115 historical sessions**, and the overlay immediately lit up
  with concrete numbers — 64 sessions today, 1.95× compression,
  $2,445.77 retail, 18-day streak, 366× subsidy multiplier, with a
  ranked per-project breakdown. The data plane worked all along; it
  just needed manifests pointing at the transcripts.

### Changed

- `package.json` and `plugin.json` version → `1.0.0-rc.2`.

### Verified (automated)

- `tsc --strict` clean, `eslint --quiet` clean, `npm run build` clean.
- 237 Vitest tests pass. `src/core/backfill.ts` at 100 % function /
  line, 95.93 % statement, 78 % branch (the missing branches are
  cross-platform `stat` paths that don't trigger on the author's
  machine).

### Still awaiting human verification

- All seven live-integration surfaces from `rc.1` (hooks firing from
  Claude Code, plugin install path, etc.) remain TBD.

[1.0.0-rc.2]: https://github.com/LlamaBrain/parallel-burn/releases/tag/v1.0.0-rc.2

## [1.0.0-rc.1] — 2026-05-19

**Release candidate.** All eight SPEC.md §10 phases are shipped to disk
and every automated check is green. Stable 1.0.0 is held back pending
end-to-end human verification of the live integration surfaces (see
"Awaiting human verification" below).

### Added

- **README rewrite** for the actual audiences (Claude Code power users,
  hiring committees, the author). Real session output in the opening
  block; metrics priority order made explicit; install paths for both
  the plugin marketplace and from-source; statusline and OBS overlay
  wiring instructions; privacy guarantees; an architecture pointer to
  SPEC.md and the five ADRs; a "Reading this codebase" section for
  engineers vetting the artifact.
- **`bin` entries in `package.json`** — `parallel-burn`,
  `parallel-burn-streak`, `parallel-burn-server`, `parallel-burn-statusline`.
  Once installed via npm, the CLIs are on PATH.
- **`prepare` script** — runs `npm run build` on install so consumers
  of the package automatically get a working `dist/` folder.
- **Distribution `files` whitelist** — `dist/`, `commands/`, `ADRs/`,
  `SPEC.md`, `plugin.json`, `pricing.json`, `README.md`, `LICENSE`,
  `CHANGELOG.md`. No tests, no source TS, no node_modules in the
  published package.

### Changed

- `package.json` and `plugin.json` version → `1.0.0-rc.1`.

### Verified (automated)

- `tsc --strict` clean, `eslint --quiet` clean, `npm run build` clean,
  218 Vitest tests pass.
- All eight phases of SPEC.md §10 are shipped and tagged
  (`v0.0.1` → `v0.5.0`, with this release candidate as the lead-up to
  `v1.0.0`).
- 100 % statement / function / line coverage across the entire
  `src/core/` (11 modules) and `src/cli/` (4 modules) layer.

### Awaiting human verification

Stable `1.0.0` will be cut after a human has confirmed each of these
surfaces actually works in a real Claude Code environment, not just
under unit tests:

- [ ] `/parallel-burn` invocation in a live Claude Code session prints
  the today-aggregate card.
- [ ] `/streak` invocation prints the streak + 30-day calendar.
- [ ] The `statusLine` integration renders below the input area when
  wired into `~/.claude/settings.json`.
- [ ] `node dist/cli/serve.js` boots the localhost server; the OBS
  browser source at `http://127.0.0.1:37337/overlay` displays the
  dark, monospace card; it updates live when an event is broadcast.
- [ ] `SessionStart` hook actually fires from Claude Code and writes
  a manifest under `~/.parallel-burn/data/sessions/`.
- [ ] `SessionEnd` hook actually fires and produces a summary markdown
  file under `~/.parallel-burn/summaries/`.
- [ ] Plugin install path (manual symlink or marketplace) actually
  registers the hooks with Claude Code.

[1.0.0-rc.1]: https://github.com/LlamaBrain/parallel-burn/releases/tag/v1.0.0-rc.1

## [0.5.0] — 2026-05-19

The localhost server + OBS browser-source overlay. Point an OBS browser
source at `http://127.0.0.1:37337/overlay` and you get a dark,
monospace, parallelism-first card that updates live.

### Added

- `ADRs/0005-sse-not-websocket.md` — documents the decision to ship
  Server-Sent Events instead of WebSocket (SPEC §9.3 said WS; ADR makes
  the call). Zero runtime dependency; one-way push is what the use case
  actually needs.
- `src/server/server.ts` — `startServer({ port, pricingFile,
  subscriptionDailyUsd, dailyStreakThresholdUsd })`. Four endpoints:
  `GET /` (302 → /overlay), `GET /overlay`, `GET /api/today` (alias
  `GET /api/current`), `GET /events` (SSE). Binds to 127.0.0.1 only.
  Heartbeats every 15 s, polls the aggregator every 5 s, broadcasts on
  every change. Built on `node:http` alone — no runtime deps.
- `src/server/overlay.ts` — embedded single-file HTML/CSS/JS overlay.
  Dark `#0d0d10` background, monospace, soft-orange accent (`#e8a04f`).
  Three headline rows in priority order — **parallelism · today ·
  streak** — plus cache discipline as a fourth secondary row, and a
  live-status footer. Auto-reconnects via `EventSource`.
- `src/cli/serve.ts` — long-running CLI (`node dist/cli/serve.js`)
  that reads `~/.parallel-burn/config.json`, spins up the server, and
  prints the overlay URL. Handles SIGINT/SIGTERM gracefully.
- 7 new Vitest tests in `tests/server.test.ts`. Spins up the server on
  an ephemeral port, hits each endpoint with `fetch`, confirms response
  shapes, the 127.0.0.1-only binding, and that `/events` delivers an
  initial SSE message. **`src/server/overlay.ts` at 100 % coverage;
  `src/server/server.ts` at 86.9 % — the uncovered lines are timer-tick
  callbacks and defensive error paths that aren't worth wiring elaborate
  timing tests for.**
- 218 tests total. The full `src/core/` and `src/cli/` modules
  remain at 100 % statement / function / line coverage.

### Changed

- `package.json` and `plugin.json` version → `0.5.0`.

### Verified

- `tsc --strict` clean, `eslint --quiet` clean, `npm run build` clean.
- 218 Vitest tests pass.
- **Live smoke test:** `node dist/cli/serve.js` boots in <100 ms,
  binds 127.0.0.1:37337, prints `parallel-burn overlay:
  http://127.0.0.1:37337/overlay`. `curl http://127.0.0.1:37337/api/today`
  returns the full live snapshot JSON with the expected shape.

[0.5.0]: https://github.com/LlamaBrain/parallel-burn/releases/tag/v0.5.0

## [0.4.0] — 2026-05-19

The end-of-session summary — the "artifact users screenshot and share"
in SPEC §7.3 wording. Now generated automatically on `SessionEnd` and
written to `~/.parallel-burn/summaries/YYYY-MM-DD-HHMM.md`.

### Added

- `src/core/summary.ts` — `renderSessionSummary` produces the SPEC §7.3
  narrative-style markdown: opening line that leads with "session-context
  squeezed into wall" + parallelism multiplier, then list-price + subsidy
  multiplier (X× the Max-prorated daily), then cache reads/writes with a
  token-mix percentage. Followed by a markdown table of sessions sorted
  by start time, a by-project rollup, and a closing interpretation line
  keyed to the compression ratio. `summaryFilename` builds
  `YYYY-MM-DD-HHMM.md` in UTC.
- `src/core/config.ts` — `~/.parallel-burn/config.json` reader with
  `subscription_daily_usd` (default $6.67 = Max plan prorated),
  `daily_streak_threshold_usd`, `server_port`, and
  `pricing_refresh_url`. All fields optional; the defaults are the
  right answer for most users. Sets per-field fallbacks for invalid
  inputs (negative numbers, out-of-range ports, non-string URLs).
- `src/hooks/session-end.ts` now calls `writeEndOfSessionSummary` after
  finalizing the manifest. Summary failures are caught and logged to
  stderr but never block manifest finalization — the data plane
  remains the source of truth.
- 21 new Vitest tests across `summary.test.ts` and `config.test.ts`.
  **211 tests total. 100 % statement / function / line coverage on every
  `src/core/` and `src/cli/` module (15 modules).**

### Changed

- `package.json` and `plugin.json` version → `0.4.0`.

### Verified

- `tsc --strict` clean, `eslint --quiet` clean, `npm run build` clean.
- **End-to-end smoke against the live in-progress session:**

      ● Session Summary for 2026-05-19

        0h 54m of session-context squeezed into 0h 54m of wall — a
        1.0× parallelism multiplier. $215.43 list-price across 1
        session, roughly 32.3× the Max-prorated daily. Cache reads
        cleared 61,892,693, with 1,412,459 writes carrying ~2%
        output, ~98% cache.

  Reads exactly like SPEC §7.3's prescribed shape. The 32.3× subsidy
  multiplier and 98% cache-token share are the kind of headline this
  product is built to produce.

[0.4.0]: https://github.com/LlamaBrain/parallel-burn/releases/tag/v0.4.0

## [0.3.0] — 2026-05-19

The presentation layer. With the aggregator from 0.2.0 producing typed
`DailyAggregate`s, this release ships the three user-facing surfaces:
`/parallel-burn`, `/streak`, and a Claude Code `statusLine` integration.

### Added

- `src/cli/format.ts` — table renderer (auto-sized columns, left/right
  align) plus `formatDuration` / `formatUsd` / `formatCount` /
  `formatRatio` / `truncate`. Zero dependencies; no `cli-table3`. Pure
  string-in-string-out; 100 % covered.
- `src/cli/parallel-burn.ts` — the `/parallel-burn` CLI. Headline
  narrative leads with **parallelism**, then dollars (per SPEC §3:
  "The README, summary output, and overlay must all lead with
  parallelism, not with dollars."). Per-session table (Duration / Cost
  / Size / Project / Session) and a By-Project rollup. Closing
  interpretation line shifts between "heavy parallel work", "comfortably
  parallel", "some overlap", and "Strictly serial day so far" based on
  the compression ratio. Footer surfaces a pricing-staleness warning if
  `pricing.json` is older than 30 days.
- `src/cli/streak.ts` — the `/streak` CLI. Current streak count, last-30-
  day daily-cost calendar, qualifying-days summary, and a `yes` /
  `—` marker per day.
- `src/cli/statusline.ts` — single-line summary for Claude Code's
  `statusLine` setting. Same parallelism-first priority as the slash
  commands. ANSI-colored accent dot. To enable, add
  `"statusLine": { "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/dist/cli/statusline.js\"" }`
  to `~/.claude/settings.json`. Hook failures never break Claude
  Code — the worst case is a blank statusline.
- `commands/parallel-burn.md` and `commands/streak.md` — auto-discovered
  by Claude Code's plugin manifest as `/parallel-burn` and `/streak`.
  Each is a thin markdown shim that runs the matching CLI via a
  `!bash` invocation against `${CLAUDE_PLUGIN_ROOT}/dist/cli/*.js` and
  instructs Claude to display the output verbatim.
- 32 new Vitest tests across `format.test.ts` and `cli.test.ts`.
  **190 tests total. 100 % statement / function / line coverage on
  every `src/core/` and `src/cli/` module.** The presentation tests
  exercise the pure renderers; the side-effectful entry points are
  marked `/* v8 ignore */` per the documented convention.

### Changed

- `package.json` and `plugin.json` version → `0.3.0`.

### Verified

- `tsc --strict` clean, `eslint --quiet` clean, `npm run build` clean.
- 190 Vitest tests pass.
- End-to-end smoke against compiled `dist/cli/*.js`:
  - `node dist/cli/parallel-burn.js` renders an empty-day card (no
    sessions on disk yet — the SessionStart hook hasn't fired in
    this install).
  - `node dist/cli/streak.js` renders the 30-day calendar and a
    streak of 0d.
  - `echo '{}' | node dist/cli/statusline.js` prints the
    parallelism-first one-liner with proper ANSI colors.

[0.3.0]: https://github.com/LlamaBrain/parallel-burn/releases/tag/v0.3.0

## [0.2.0] — 2026-05-19

The metrics layer. With the data plane in place from 0.1.0, this release
adds the math that turns raw `MessageEvent`s into the spec's headline
numbers: compression ratio, cache discipline, streak, and per-project
breakdowns.

### Added

- `src/core/compression.ts` — `mergeIntervals` (sort-then-fold,
  zero/negative-duration intervals discarded), `totalIntervalDurationMs`,
  `compressionRatio`, and `computeCompression` (one-shot helper). The
  wall-clock window is the *merged* duration, not naive
  `max(end) - min(start)` — the SPEC §10 Phase 4 requirement.
- `src/core/streak.ts` — `computeStreak` walks calendar dates backward from
  `today`, counting consecutive days at or above a configurable
  threshold. Default $50 retail per SPEC §8. Missing days count as $0,
  which breaks the streak (unless the threshold is also 0). UTC-only
  date arithmetic; `previousDay` handles month / year / leap-day
  boundaries correctly.
- `src/core/aggregator.ts` — the bridge between the data plane and the
  presentation layer. `summarizeSession` (pure, given manifest + events
  + pricing), `aggregateFromManifest` (loads the transcript),
  `aggregateSession` (loads manifest + transcript), `listSessions`
  (directory walk over `~/.parallel-burn/data/sessions/`), and
  `aggregateDay` (filter by `started_at` date, fan out, roll up).
  `rollUpDay` is pure: takes `SessionAggregate[]` and produces a
  `DailyAggregate` with the merged-interval compression math, by-project
  groups (sorted by cost desc), and the cache discipline ratio.
  Injection points (`sessionsDir`, `metaPathFor`, `readTranscriptFor`)
  exist for tests; the production code uses defaults that resolve via
  `src/core/paths.ts`.
- 48 new Vitest tests across `compression`, `streak`, and `aggregator`.
  **158 tests total. 100 % statement / function / line coverage on every
  file in `src/core/` (eleven modules).** Branch coverage is 100 % on
  every module except `aggregator.ts` at 91.66 %, where the remaining
  uncovered branches are option-defaulting `??` paths whose default
  arms *are* exercised — the noise is a known v8-coverage limitation.

### Changed

- `package.json` and `plugin.json` version → `0.2.0`.

### Verified

- `tsc --strict` clean, `eslint --quiet` clean, `npm run build` clean.
- **End-to-end smoke test against the live in-progress session on the
  author's machine:** 282 assistant turns parsed from the transcript,
  $153.46 retail cost computed against `pricing.json`, cache discipline
  ratio of 34.86 — the cache is doing real work, exactly the kind of
  number the product is built to surface.

[0.2.0]: https://github.com/LlamaBrain/parallel-burn/releases/tag/v0.2.0

## [0.1.0] — 2026-05-19

First feature release. ParallelBurn can now observe a Claude Code session
end-to-end: hooks record the session boundary on disk, the transcript
reader projects assistant turns into typed `MessageEvent`s, and the cost
calculator (from 0.0.3) prices them against the rate card. Smoke-tested
against a real `~/.claude/projects/.../<session>.jsonl` on the author's
machine.

### Added

- `ADRs/0004-transcript-path-encoding.md` — pins the load-bearing
  assumption that Claude Code's `~/.claude/projects/<encoded-cwd>/`
  directory name is the absolute working-directory path with every
  occurrence of `[:\\/.]` replaced by `-`. Verified against multiple
  real entries on the operator's machine.
- `src/core/paths.ts` — single source of truth for both `~/.parallel-burn/`
  (our data root) and `~/.claude/projects/<encoded>/<session>.jsonl`
  (Claude Code's transcripts). Cross-platform symmetric encoding per
  ADR-0004.
- `src/core/store.ts` — atomic write primitives. `writeJsonAtomic` uses
  tmp-file-and-rename and cleans up the temp on serialization failure
  (the prior file stays intact). `appendJsonLine` uses `O_APPEND` + a
  single `write(2)` for cross-process-safe JSONL appends under the
  PIPE_BUF limit. `readJsonOptional` returns `null` for `ENOENT` and
  propagates everything else.
- `src/core/manifest.ts` — `SessionManifest` (schema_version 1.0,
  session_id / project / cwd / transcript_path / started_at /
  last_seen_active / ended_at) plus a strict parser/validator with
  branded-ID checks.
- `src/core/transcript.ts` — async transcript reader that ingests
  Claude Code's JSONL line-by-line, silently skips malformed or
  uninteresting records (per SPEC §10 Phase 3 crash-resistance), and
  projects each well-formed `type: "assistant"` entry into a typed
  `MessageEvent` matching SPEC §7.1. Survives missing trailing
  newlines, partial usage blocks, and negative/NaN token counts.
- `src/hooks/_lib.ts` — shared hook helpers: `readStdinJson` (text-mode,
  TTY-safe, never throws), `runHook` (catches every error so Claude
  Code never sees a non-zero exit; always prints
  `{"continue":true,"suppressOutput":true}` on stdout), `isEntryPoint`
  (so test imports don't trigger the auto-run), `readString`.
- `src/hooks/session-start.ts`, `src/hooks/post-tool-use.ts`,
  `src/hooks/session-end.ts` — the three Claude Code hook entrypoints.
  Each splits a pure `buildXxxManifest(payload, prior?, now)` decision
  function (table-tested in `tests/hooks.test.ts`) from the side-effectful
  read/write glue. PostToolUse synthesizes a manifest if SessionStart was
  missed (so a session that started before parallel-burn was installed
  is still partially captured). SessionEnd is a no-op if there's no prior
  manifest or it's already finalized.
- `plugin.json` — hooks declared in the correct keyed-by-event shape
  (see ADR-0003 / the verified Claude Code reference). Each entry
  invokes the compiled `dist/hooks/*.js` via `node` with
  `${CLAUDE_PLUGIN_ROOT}` as the plugin install root.
- 70 new Vitest tests across `paths`, `store`, `manifest`, `transcript`,
  and `hooks`. **110 tests total. 100 % statement / branch / function /
  line coverage on every file in `src/core/`** (eight modules: cost,
  event, ids, manifest, paths, pricing, store, transcript).

### Changed

- `package.json` and `plugin.json` version → `0.1.0`.

### Verified

- `tsc --strict` clean (with `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `verbatimModuleSyntax`).
- `eslint --quiet` clean under typescript-eslint v8 typed rules.
- All 110 Vitest tests pass.
- **Smoke-tested against a real Claude Code transcript**: `node` invoking
  the compiled SessionStart hook writes a valid manifest to
  `~/.parallel-burn/data/sessions/<id>.meta.json`; the transcript reader
  consumes the live session's JSONL and the cost calculator produces a
  plausible retail-USD total against the shipped `pricing.json`.

[0.1.0]: https://github.com/LlamaBrain/parallel-burn/releases/tag/v0.1.0

## [0.0.3] — 2026-05-19

### Added

- `src/core/event.ts` — `MessageEvent` and `MessageEventUsage` types matching
  SPEC.md §7.1, with branded IDs from `src/core/ids.ts`. Type only; parsing
  lands in Phase 3.
- `src/core/cost.ts` — `computeCost(event, pricing) → CostBreakdown`, the
  retail-USD calculator. Reads precomputed per-model rates straight from the
  rate card (no `× 1.25` in code). Splits the breakdown into input / output /
  5m-cache-write / 1h-cache-write / cache-read. Reconciles legacy
  `cache_creation_input_tokens` against the granular 5m/1h breakdown:
  granular fields win when present, any remaining legacy total bills at the
  5m rate (the original ephemeral cache flavor).
- Unknown-model handling per CLAUDE.md "do not silently zero-cost":
  `CostBreakdown.unknownModel` flags the case and the cost is billed against
  the most-expensive known model's rates (`conservativeFallbackModel` carries
  the name). Errs toward overestimating, never underestimating.
- `EmptyPricingError` thrown when the `PricingProvider` exposes no models —
  callers can never end up with a zero-cost false negative for an unknown
  model.
- `PricingProvider.entries()` — new iteration helper yielding `[name, rates]`
  pairs. Used by the unknown-model fallback to avoid a TypeScript-mandated
  but dynamically-unreachable defensive branch.
- 13 new Vitest tests in `tests/cost.test.ts` plus an `entries()` test in
  `tests/pricing.test.ts`. 53 tests total. 100 % statement / branch /
  function / line coverage on all four `src/core/` modules.

### Changed

- `package.json` and `plugin.json` version → `0.0.3`.

### Verification status

- `tsc --strict` clean.
- `eslint --quiet` clean.
- All tests pass; `src/core/` at 100 % coverage on every metric.
- **Manual verification against an Anthropic console line item is still
  required before this rate card can be considered production-trusted.**
  The math matches the published rates by construction (rates × tokens /
  1 000 000) and round-trips against unit-rate cases (1 M tokens × $15/MTok
  = $15.00). A real-session cross-check is queued and will be noted in the
  CHANGELOG when complete.

[0.0.3]: https://github.com/LlamaBrain/parallel-burn/releases/tag/v0.0.3

## [0.0.2] — 2026-05-19

### Added

- `src/core/ids.ts` — branded typed IDs (`SessionId`, `ProjectId`, `MessageId`)
  with a private `unique symbol` brand, a `makeXxxId` constructor that
  validates non-empty/whitespace-trimmed/no-newline/≤256-char strings, runtime
  type guards, and a structured `InvalidIdError`.
- `src/core/pricing.ts` — `PricingProvider` class with
  `fromDocument` / `fromFile` / `fromRemoteWithFallback` factories,
  per-model rate lookup, schema-version gate (`"1.0"` only), and a
  30-day staleness signal (`isStale`, `ageDays`). Remote fetch silently
  falls back to the local file on any failure — the "no telemetry,
  no phone-home" contract from SPEC.md §11.
- Vitest test suite for both modules. 40 tests, 100 % statement / branch /
  function / line coverage on `src/core/`.
- `tsconfig.eslint.json` — separate include set so the typed ESLint rules
  can lint `tests/` and `eslint.config.js` (typescript-eslint v8 typed-rules
  scope is governed by the project's `include`).

### Changed

- `package.json` and `plugin.json` version → `0.0.2`.

[0.0.2]: https://github.com/LlamaBrain/parallel-burn/releases/tag/v0.0.2

## [0.0.1] — 2026-05-19

### Added

- Initial project skeleton.
- TypeScript (`--strict`) configuration with Node 22+ target.
- Vitest test runner with v8 coverage reporter.
- ESLint flat-config setup with `@typescript-eslint/recommended-type-checked`.
- Apache 2.0 `LICENSE`.
- `SPEC.md` — full design specification (14 sections, ~600 lines).
- `CLAUDE.md` — in-session agent context for contributors.
- `README.md` — public-facing project description, audience-aware.
- `pricing.json` — current Claude rate card (Opus 4.7, Sonnet 4.6, Haiku 4.5) with `as_of: 2026-05-19`.
- `plugin.json` — Claude Code plugin manifest scaffold (to be verified against current plugin schema before publishing).
- `ADRs/0001-architecture-overview.md` — captures the high-level architectural decisions.
- `ADRs/0002-per-session-jsonl-not-sqlite.md` — documents the storage choice and alternatives considered.
- `ADRs/0003-no-usage-data-in-posttooluse.md` — corrects the spec's data-plane
  assumption after verifying the live Claude Code hooks reference: PostToolUse
  payloads do not include token usage, so the data plane reads from Claude
  Code's transcript JSONLs.

### Not yet implemented

- All `src/` modules. Phase 1 (typed IDs and pricing infrastructure) begins next; see SPEC.md section 10.

[Unreleased]: https://github.com/LlamaBrain/parallel-burn/compare/v1.0.0-rc.4...HEAD
[0.0.1]: https://github.com/LlamaBrain/parallel-burn/releases/tag/v0.0.1
