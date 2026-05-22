# Roadmap

Tracks work between the current release candidate (`v1.0.0-rc.4`)
and a stable `v1.0.0` cut.

## 1.0 stable release blockers

These must be resolved before the stable tag — see CHANGELOG.md
"Awaiting human verification" section for the broader checklist.

### Cost accuracy (the user-facing dollar number must be trustworthy)

- [ ] **Pricing model-ID lookup is broken for date-suffixed IDs.**
  pricing.json keys models as `claude-haiku-4-5` but Anthropic's API
  emits `claude-haiku-4-5-20251001` in transcripts. Lookup misses,
  and the session is silently billed at the unknown-model fallback.
  Today's `observer-sessions` total of `$579.62` is computed against
  the fallback for **47 of 70 sessions**, not the actual rate. Fix:
  either normalize the lookup (strip trailing `-YYYYMMDD` before
  checking) or include all date variants explicitly in pricing.json.
  Pick the option that fails closed when a brand-new model ID is
  emitted that we don't yet know about.
- [ ] **Missing model coverage in pricing.json.** `claude-sonnet-4-5`
  family is entirely absent — only `claude-sonnet-4-6` is keyed.
  41 of today's sessions ran on Sonnet 4.5. Add the missing entries.
- [ ] **Audit the unknown-model fallback.** CLAUDE.md says "log a
  warning and use a conservative fallback" but the actual fallback
  rate and direction (errs high vs. low) is not documented or
  asserted. Either codify the fallback as a named constant with
  rationale, or surface unknown-model sessions as
  `uncosted N sessions` and exclude them from `totalCostUsd`.
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

### Server lifecycle

- [ ] **Server must autostart.** Today the server has to be launched
  separately (`parallel-burn serve` or `node dist/cli/serve.js`) and
  survives across sessions as a manually-managed long-running
  process. The overlay, statusline, and any SSE consumer all
  silently degrade when it isn't running, and there's no signal to
  the operator that they forgot. SessionStart hook should
  ensure-running with an idempotent spawn: bail if the configured
  port is already listening, otherwise fork a detached server
  process and let it survive past this session. SessionEnd does
  *not* stop it — the server is a per-machine resource, not a
  per-session one. Without this, every "live" surface the SPEC
  promises is operator-discipline-gated, which defeats the point.

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
