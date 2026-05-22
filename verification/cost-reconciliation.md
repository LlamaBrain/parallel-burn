# Cost reconciliation procedure

Before tagging a stable `v1.0.0`, parallel-burn's reported daily
totals must be verified against a trusted external source. The
verification path depends on which Anthropic billing model the
operator is on; each path produces an objective, append-only
record below.

## Why this exists

Every cost-accuracy fix that lands in the codebase (model-ID
normalization, missing-family additions, fallback-policy
codification) makes the *displayed* dollar number more truthful,
but truth has to be measured against an external reference. Unit
tests verify the math; they cannot verify the rate card.

rc.16 is the canonical example. 285 unit tests passed for 15 RCs
while the Opus tier was priced at 3× its real rate. The first
read of Anthropic's published pricing page surfaced it
immediately — exactly the class of bug this procedure exists to
catch.

A divergence on this procedure means one of:

- A pricing rate in `pricing.json` doesn't match Anthropic's
  published rate card (rc.16 cause).
- Tokens are being counted twice (subagent double-count — see
  `verification/subagent-audit.md`).
- Tokens are being silently dropped (unparseable events,
  transcript truncation, unsupported usage shape).
- An unknown-model fallback is inflating a total that the
  operator should see as "we don't know".

In every case the root cause has to be found and fixed before
tagging — the dollar number is the headline metric the SPEC
promises.

---

## Path A — API-billing operators

Use this path when you have a pay-as-you-go Anthropic console with
per-day usage totals you can read.

### Inputs

- **Anthropic console** access for the operator's account.
- **parallel-burn server** running (rc.6+ autostarts it).

### Procedure

1. **Pick three distinct days** in the recent past (last 30 days),
   ideally including:
   - One high-spend day (≥ $20).
   - One low-spend day (≤ $5).
   - One day spanning multiple model families.
   Avoid today (still moving) and days older than 30 days
   (console granularity).

2. **For each day, pull parallel-burn's total** via URL (no
   terminal needed):

   ```
   # Today:
   http://127.0.0.1:37337/api/today

   # Historical day (rc.14+):
   http://127.0.0.1:37337/api/day?date=2026-05-19
   ```

   Read `aggregate.totalCostUsd`, `aggregate.sessions.length`, and
   `aggregate.unknownModelSessionCount`. The terminal alternative
   is `node <plugin-cache>/dist/cli/parallel-burn.js 2026-05-19`.

3. **Pull the matching Anthropic console total** — sum across all
   models for the operator's account, same day.

   Timezone caveat: your console is likely UTC; parallel-burn is
   local. Pick days where activity is concentrated mid-day to
   avoid the midnight-straddle case.

4. **Compute divergence:** `(parallel_burn - console) / console`.
   `|divergence| ≤ 1 %` passes. Strongly positive + nonzero
   `unknownModelSessionCount` → fallback inflation; extend the
   rate card. Strongly positive without that → suspect a rate-card
   mismatch (rc.16 style).

5. **Record three passing rows** in the table below.

---

## Path B — Subscription operators (no console)

Use this path when you're on Claude's monthly subscription plan
and don't have a usage-based billing console. The dollar number
parallel-burn shows is *list-price retail cost* — what your work
would cost at API rates — which is meaningful but not invoice-
backed.

### Procedure

1. **Verify `pricing.json` matches Anthropic's published rate
   card.** Open
   `https://platform.claude.com/docs/en/about-claude/pricing`.
   For every model in `pricing.json`, the five fields
   (`input_per_mtok`, `output_per_mtok`, `cache_write_5m_per_mtok`,
   `cache_write_1h_per_mtok`, `cache_read_per_mtok`) must match
   the published table exactly. Any divergence is a rate-card bug
   to fix before tagging.

2. **Hand-compute one session** and compare against the
   per-session cost parallel-burn reports for it. Pick a small
   recent session from the API response so the arithmetic is
   tractable:

   ```
   http://127.0.0.1:37337/api/today
   ```

   For a session with model `claude-sonnet-4-5-20250929` and
   tokens `(input, output, cacheRead, cacheWrite)`:

   ```
   cost  =  input_tokens   × $3      / 1_000_000
         +  output_tokens  × $15     / 1_000_000
         +  cacheRead      × $0.30   / 1_000_000
         +  cacheWrite     × $3.75   / 1_000_000   (if 5-min ephemeral)
         +  cacheWrite     × $6      / 1_000_000   (if 1-hour ephemeral)
   ```

   Cache-write rate depends on which ephemeral flavor the session
   used; if you don't know, try both and the one that produces
   parallel-burn's exact number is the one in use.

   `parallel-burn cost` (from the JSON) should match your
   hand-computed value to the cent for sub-dollar sessions, and
   within rounding for larger ones.

3. **Record the spot-check result** in the table below. Both
   sub-steps must pass on the same RC for the path to clear.

---

## Results log

### rc.16 — Path B verification (subscription operator)

**Step 1 — Rate card verification.** Read on 2026-05-22 against
`https://platform.claude.com/docs/en/about-claude/pricing`. All
ten model entries in `pricing.json` (Opus 4.5/4.6/4.7 at $5/$25,
Opus 4.0/4.1 at $15/$75, Sonnet 4.5/4.6 and the deprecated 4.0 at
$3/$15, Haiku 4.5 at $1/$5, Haiku 3.5 at $0.80/$4) match the
published table for all five fields. **Pass.**

> Footnote: rc.15 had Opus 4.5/4.6/4.7 keyed at the deprecated
> Opus 4.0/4.1 rate ($15/$75). rc.16 corrected this. That
> correction is exactly what this procedure is designed to find
> on a release candidate before stable.

**Step 2 — Hand-computed spot check.** Session `06b2d79d` on
`claude-sonnet-4-5-20250929`, today (2026-05-22):

```
input:        10  × $3.00  /MTok  = $0.000030
output:      443  × $15.00 /MTok  = $0.006645
cache-1h:   3444  × $6.00  /MTok  = $0.020664
cache-read: 2317  × $0.30  /MTok  = $0.000695
                                    ─────────
                                    $0.028034
```

parallel-burn reported `costUsd: 0.0280341` — match to the
sixth decimal. **Pass.**

### Path A results (filled in by API-billing operators)

| RC     | Day        | parallel-burn $ | Console $ | Divergence | Notes |
|--------|------------|-----------------|-----------|------------|-------|
| _example_ | 2026-05-19 | $12.34 | $12.40 | -0.5 % | ✓ within tolerance |

After three rows on a single RC sit within tolerance (Path A) or
both Path B sub-steps pass on a single RC, this blocker is
closed for that RC. If a later RC changes anything in
`src/core/cost.ts`, `src/core/pricing.ts`, or `pricing.json`, the
verification must be re-run on the new RC before tagging stable.

## What "within tolerance" doesn't prove

- It doesn't prove subagent costs aren't being double-counted on
  the parallel-burn side. See `verification/subagent-audit.md`.
- It doesn't prove unknown-model fallback is hitting only the
  cases the operator wants it to. A day with 50 fallback-priced
  sessions could still total within 1 % by coincidence; the
  `unknownModelSessionCount` column is the signal to watch.
- It doesn't prove non-monetary metrics (cache-hit %, parallelism
  ratio) are right. Those have their own correctness tests in
  `tests/`.
