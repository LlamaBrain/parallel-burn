# Roadmap

Tracks work between the current release candidate (`v1.0.0-rc.15`)
and a stable `v1.0.0` cut.

## 1.0 stable release blockers

These must be resolved before the stable tag — see CHANGELOG.md
"Awaiting human verification" section for the broader checklist.

### Cost accuracy (the user-facing dollar number must be trustworthy)

- [x] **Cost reconciliation against Anthropic.** Two-path procedure
  documented at `verification/cost-reconciliation.md`. Path A
  (console comparison) for API-billing operators; Path B
  (rate-card verification + hand-computed spot check) for
  subscription operators. **Path B passed on rc.16** — rc.15 had
  Opus 4.5/4.6/4.7 at 3× the real rate; rc.16 corrected it;
  hand-compute on a Sonnet 4.5 session matched to the sixth
  decimal.

## Backlog

- [ ] Per-session cost breakdown in the overlay (currently only the
  daily aggregate is surfaced).
- [ ] Pricing.json refresh: silent staleness is risky. Either warn
  when `pricingAsOf` is older than N days, or block cost
  computation until a fresh fetch succeeds.
- [ ] CI: nightly run that pulls last-7-days backfill, computes
  cost, and writes the result somewhere durable so we have a
  historical record to compare against the Anthropic console.
