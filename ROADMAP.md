# Roadmap

Tracks work between the current release candidate (`v1.0.0-rc.4`)
and a stable `v1.0.0` cut.

## 1.0 stable release blockers

These must be resolved before the stable tag — see CHANGELOG.md
"Awaiting human verification" section for the broader checklist.

### Cost accuracy (the user-facing dollar number must be trustworthy)

- [ ] **Manual reconciliation against Anthropic console.** Pull at
  least three distinct days' real console totals, compare to
  ParallelBurn's `totalCostUsd` for the same operator. Tolerance:
  within 1 %. Diverge wider → root-cause before tagging stable.
  Document the procedure under `verification/cost-reconciliation.md`
  so it can be re-run on future release candidates.
- [ ] **Subagent double-count audit.** Today 12 `agent-*` sessions
  contribute `$0.00`. This could be correct (parent transcript
  already counts subagent tokens, so the subagent manifest is a
  no-op) or it could mean the calculator silently can't read
  subagent transcripts and we're losing real cost. Confirm which
  via a known-good session pair.

### Plugin hook discovery

- [ ] **Hooks declared in root `plugin.json` aren't picked up by the
  Claude Code harness on Windows.** Fresh-session test on
  2026-05-19 produced a transcript but no manifest — SessionStart
  fired neither write nor summary. The reference working plugin
  (`claude-mem`) splits metadata into `.claude-plugin/plugin.json`
  and hooks into a separate `hooks/hooks.json` file at the plugin
  root. Mirror that layout for ParallelBurn. Without this, the
  real-time manifest pipeline never runs — only `parallel-burn
  backfill` populates the data plane, which defeats the live
  overlay and statusline guarantees the SPEC promises.

## Near-term (post-1.0 if necessary, but ideally before)

- [ ] **Local-install dev workflow.** `npm run build` refreshes the
  in-repo `dist/` but not `~/.claude/plugins/cache/llamabrain/
  parallel-burn/<version>/dist/`. Iterating on the installed plugin
  requires either a marketplace round-trip or a manual copy. Add a
  `npm run install:local` (or similar) that builds and syncs the
  cache copy in one step. Document the discipline.
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
