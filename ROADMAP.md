# Roadmap

Tracks work between the current release candidate (`v1.0.0-rc.17`)
and a stable `v1.0.0` cut.

## 1.0 stable release blockers

**All blockers resolved as of rc.17.** Cost reconciliation passed
via Path B on rc.16; the rc.16 rate-card fix is locked in;
hand-compute matches to the sixth decimal. The stable `v1.0.0`
tag is the operator's call to cut (per CLAUDE.md memory: "green
tests ≠ ready for stable" — but a human has now verified the
live integration too).

## Backlog

- [ ] Per-session cost breakdown in the overlay (currently only the
  daily aggregate is surfaced).
- [ ] Pricing.json refresh: silent staleness is risky. Either warn
  when `pricingAsOf` is older than N days, or block cost
  computation until a fresh fetch succeeds.
- [ ] CI: nightly run that pulls last-7-days backfill, computes
  cost, and writes the result somewhere durable so we have a
  historical record to compare against the Anthropic console.
