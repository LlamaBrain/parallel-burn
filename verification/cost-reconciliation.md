# Cost reconciliation procedure

Before tagging a stable `v1.0.0`, parallel-burn's reported daily
totals must be reconciled against Anthropic's own console for the
same operator. Tolerance: within 1 % per day across at least three
distinct days.

This document describes the procedure so it can be re-run on every
release candidate without re-deriving the steps.

## Why this exists

Every cost-accuracy fix that lands in the codebase (model-ID
normalization, missing-family additions, fallback-policy codification)
makes the *displayed* dollar number more truthful, but truth has to
be measured against an external reference. Anthropic's console is
the only ground-truth source for what the operator actually paid.

A divergence wider than 1 % on any sampled day means one of:

- A pricing rate in `pricing.json` is wrong (off-by-version, off-by-tier).
- Tokens are being counted twice (subagent double-count — see the
  separate audit task).
- Tokens are being silently dropped (unparseable events, transcript
  truncation, unsupported usage shape).
- An unknown-model fallback is inflating a total that the operator
  should see as "we don't know".

In every case the root cause has to be found and fixed before
tagging — the dollar number is the headline metric the SPEC promises.

## Inputs

- **Anthropic console** access for the operator's account.
- **parallel-burn server** running on the operator's machine (rc.6+
  autostarts it, see `ROADMAP.md`).
- **`jq`** for slicing JSON. Optional but recommended.

## Procedure

1. **Pick three distinct days** in the recent past (last 30 days),
   ideally including:
   - One high-spend day (≥ $20).
   - One low-spend day (≤ $5).
   - One day where the operator ran multiple model families
     (Opus + Sonnet + Haiku, or 4.5 + 4.6 + 4.7).

   Avoid today: the day isn't closed yet, so the totals are still
   moving. Avoid days older than 30 days: Anthropic's console may
   not show per-day granularity that far back.

2. **For each day, pull parallel-burn's total** by hitting the
   server's `/api/today` endpoint. The endpoint always returns
   *today*'s aggregate; for historical days, use the offline
   aggregator:

   ```bash
   # Today (live):
   curl -s http://127.0.0.1:37337/api/today \
     | jq '.aggregate | {date, totalCostUsd, unknownModelSessionCount, sessions: (.sessions | length)}'

   # Historical day (run via node CLI):
   node ~/.claude/plugins/cache/llamabrain/parallel-burn/<latest>/dist/cli/parallel-burn.js \
     day 2026-05-19 \
     | jq '{date, totalCostUsd, unknownModelSessionCount, sessions: (.sessions | length)}'
   ```

   Record:
   - `totalCostUsd`
   - `unknownModelSessionCount` (if > 0, the total is an upper bound,
     not a precise number).
   - `sessions` count.

3. **Pull the Anthropic console total for the same day.** The
   console shows per-day breakdowns by model. Sum across all models
   for the operator's account.

   - The console's calendar is in the account's billing timezone,
     which may not match the operator's local timezone. If
     parallel-burn shows 2026-05-19 ending at 23:59 PDT and the
     console shows 2026-05-19 ending at 23:59 UTC, the two are
     not directly comparable for sessions that straddle midnight.
     Pick days where activity is concentrated in mid-day to avoid
     the timezone-boundary case.

4. **Compute divergence:**

   ```
   divergence = (parallel_burn_total - console_total) / console_total
   ```

   - `|divergence| ≤ 1 %`: within tolerance.
   - `|divergence| > 1 %`: investigate. Common root causes are
     listed under "Why this exists" above.
   - Strongly positive divergence + `unknownModelSessionCount > 0`:
     the fallback is inflating; the rate card needs the missing
     model added (see `rc.9` for an example fix).

5. **Record results** in the table below. Append, never overwrite —
   the history of reconciliations across RCs is itself useful for
   spotting regressions.

## Results log

| RC     | Day        | parallel-burn $ | Console $ | Divergence | Notes |
|--------|------------|-----------------|-----------|------------|-------|
| _example_ | 2026-05-19 | $12.34 | $12.40 | -0.5 % | ✓ within tolerance |
| rc.10  |            |                 |           |            |       |
| rc.10  |            |                 |           |            |       |
| rc.10  |            |                 |           |            |       |

After three rows on a single RC sit within tolerance, this blocker
is closed for that RC. If a later RC changes anything in
`src/core/cost.ts`, `src/core/pricing.ts`, or `pricing.json`, the
table must get three more rows on the new RC before tagging stable.

## What "within tolerance" doesn't prove

- It doesn't prove subagent costs aren't being double-counted on the
  parallel-burn side (subagent transcripts' tokens might be counted
  inside the parent transcript already). See the separate subagent
  audit task.
- It doesn't prove unknown-model fallback is hitting only the cases
  the operator wants it to. A day with 50 fallback-priced sessions
  could still total within 1 % by coincidence; the
  `unknownModelSessionCount` column is the signal to watch.
- It doesn't prove non-monetary metrics (cache-hit %, parallelism
  ratio) are right. Those have their own correctness tests in
  `tests/`.
