# Roadmap

Tracks work between the current release (`v1.0.0`) and the next.

## 1.1.0 — focus: regression resistance on cost accuracy

rc.16 caught a 3× Opus rate-card bug that had been live since
v0.0.3. The fix landed; the lesson is to make the same class of
bug visibly impossible to ship again. 1.1.0's theme is closing
the loop the reconciliation procedure exposed.

- [ ] **Pricing-staleness warning surfaces in the live UI.**
  `pricingAsOf` more than N days old should light up the overlay
  and statusline — not just return `pricingStale: true` in JSON
  that nobody reads. The rc.16 bug was a *correctness* bug, not
  a staleness bug, but both share the same dynamic: silent
  pricing drift gets baked into every reported number. A loud
  staleness signal would have surfaced the underlying class of
  problem regardless of which specific field went wrong. Pick
  one default: warn at 30 days, refuse to compute cost at 90.
- [ ] **`scripts/spot-check.mjs <session-id>` — codify Path B
  step 2.** The hand-compute that closed rc.16's Path B took
  ~10 minutes of arithmetic. A script that pulls the session
  from the API, computes per-component cost from the rate card,
  and compares against parallel-burn's reported value would
  reduce re-verification on every future RC to one command.
  Makes the reconciliation procedure a 30-second exercise
  instead of a 10-minute one.
- [ ] **Extended rate card — close out the bare/legacy model
  IDs surfacing as `unknownModelSessionCount`.** Survey shows
  4–17 fallback-priced sessions per day on older days. Likely
  culprits: bare `haiku` (could've meant 3.5 or 4.5 historically),
  `<synthetic>` (system marker, should be zero-cost), bare
  `claude-opus-4` (legacy 4.0 rates). Add explicit entries or
  alias-normalize where ambiguity is resolvable; document the
  decision for each ambiguous case.

## Backlog (post-1.1.0)

- [ ] **Per-session cost breakdown in the overlay.** Today's
  overlay surfaces only the daily aggregate. Per-session data
  is already on `/api/today.aggregate.sessions[*]`; the overlay
  just needs a collapsible/expandable list row.
- [ ] **Nightly CI cost-history record.** Scheduled GH Actions
  workflow that runs the last-7-days backfill, computes
  totals, and writes JSON to a tracked file. Becomes the
  regression detector rc.16 didn't have — a future rate-card
  drift would show as a visible discontinuity in the recorded
  history.
- [ ] **Wrapper-script discipline.** `~/.claude/scripts/
  statusline-combined.js` lives in operator dotfiles and was
  patched twice during 1.0 work (version-discovery, then
  `process.execPath + shell:false` for the pb spawn). Either
  ship a sample under `examples/` operators can copy, or
  document in README that the wrapper is the operator's
  responsibility and call out the two pitfalls.
- [ ] **`pricing.json` lookup is cwd-relative, not
  script-relative.** Running `node dist/cli/parallel-burn.js`
  from any directory other than the repo root throws
  `ENOENT: no such file or directory, open
  '<cwd>/pricing.json'`. Hit while invoking the
  `parallel-burn:parallel-burn` skill from inside a project
  dir — Claude Code's working directory is the project, not
  the parallel-burn install, so the skill is currently
  unusable without a manual `cd`. Resolve `pricing.json`
  relative to the script (`import.meta.url` / `__dirname`),
  not `process.cwd()`. Same fix likely needed anywhere else
  the CLI reads packaged data files.

## Tracking

Resolved items are kept in `CHANGELOG.md`. ADRs for any non-obvious
choice go under `ADRs/`. Reconciliation results across RCs are
appended to `verification/cost-reconciliation.md`.
