# Roadmap

Tracks work between the current release candidate (`v1.0.0-rc.12`)
and a stable `v1.0.0` cut.

## 1.0 stable release blockers

These must be resolved before the stable tag — see CHANGELOG.md
"Awaiting human verification" section for the broader checklist.

### Cost accuracy (the user-facing dollar number must be trustworthy)

- [ ] **Manual reconciliation against Anthropic console.** Procedure
  is documented at `verification/cost-reconciliation.md` (rc.11).
  Three rows of the results table must be filled in within 1 %
  tolerance before tagging stable. Operator action required —
  needs Anthropic-console access.

## Near-term (post-1.0 if necessary, but ideally before)

- [ ] **Cache-hit % rounding.** Now that the formula is fixed
  (`cacheRead / (input + cacheWrite + cacheRead)`), values at the
  high end can still display as `100.0%`. Show 3 significant
  figures (`99.94%`) so operators can see drift across the
  saturation threshold rather than a flatlined `100%`.

## Backlog

- [ ] Per-session cost breakdown in the overlay (currently only the
  daily aggregate is surfaced).
- [ ] Pricing.json refresh: silent staleness is risky. Either warn
  when `pricingAsOf` is older than N days, or block cost
  computation until a fresh fetch succeeds.
- [ ] CI: nightly run that pulls last-7-days backfill, computes
  cost, and writes the result somewhere durable so we have a
  historical record to compare against the Anthropic console.
