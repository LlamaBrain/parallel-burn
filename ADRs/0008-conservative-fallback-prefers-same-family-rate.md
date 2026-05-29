# ADR-0008: Unknown-Model Fallback Prefers the Same-Family Rate

- **Status:** Accepted
- **Date:** 2026-05-29
- **Spec impact:** [SPEC.md](../SPEC.md) §10 Phase 2 (cost calculator),
  §11 (discipline mechanics)
- **Relates to:** [ADR-0007](./0007-aggregate-day-auto-backfills-missing-manifests.md)
  (regression-resistance theme)

## Context

When `computeCost` meets a model that isn't in `pricing.json`, it must
still produce a non-zero cost (CLAUDE.md: "do not silently zero-cost an
unknown model"). The original policy — `CONSERVATIVE_FALLBACK_POLICY`
with selector `max-output-per-mtok` — picked the model with the highest
`output_per_mtok` in the whole card, on the logic that over-counting is
the safer error than under-counting.

That logic has a sharp edge. The Opus line was repriced *down* over its
lifetime: `claude-opus-4-0` / `-4-1` cost $15/$75 per Mtok (in/out),
while `-4-5` / `-4-6` / `-4-7` cost $5/$25. Both generations stay in the
rate card (old sessions still need costing). So "highest output rate in
the card" is the *retired* opus-4-1 at $75 — **3× the current Opus
rate.**

On 2026-05-28 the operator ran a heavy day predominantly on
`claude-opus-4-8`, which `pricing.json` (as_of 2026-05-22) didn't yet
list. Every opus-4-8 token fell to the fallback and was billed at the
opus-4-1 rate. ParallelBurn reported **$2,102.80**; the true figure at
the current Opus rate was **$1,318.94**. The $783.86 (37%) gap was pure
fallback error — a silently wrong headline, the same failure class
ADR-0007 set out to make unshippable.

Adding `claude-opus-4-8` to the card fixed that day. But the *next*
un-carded flagship (opus-4-9, a new Sonnet, …) would hit the identical
3× trap until someone noticed and patched the card. The fallback needs
to fail gracefully for the common case — a new model in an *existing*
family — not just the rare case of a brand-new tier.

## Decision

`pickConservativeFallback` becomes two-stage:

1. **Same-family proxy (preferred).** Parse the unknown model's tier from
   its ID (`claude-<opus|sonnet|haiku>-<major>-<minor>`). If the card holds
   any model in that tier, use the **highest-version** sibling's rates.
   Anthropic prices a new model like its most recent sibling, so a missing
   `claude-opus-4-8` inherits opus-4-7's $5/$25 — not opus-4-1's $15/$75.

2. **Global max-output (fallback's fallback).** If the model names no
   recognized tier — a genuinely new family — keep the original behavior:
   the highest `output_per_mtok` in the card, an upper bound on an unknown
   tier's cost.

Either way `unknownModel: true` is still set, so
`DailyAggregate.unknownModelSessionCount` keeps surfacing that the card
is behind reality. The fallback is a stopgap; updating `pricing.json`
remains the real fix.

## Consequences

- **A missing model in a known family no longer 3×-es the cost.** The
  most likely staleness case — a new Opus/Sonnet/Haiku version — now lands
  within rounding of the truth instead of triple it.
- **The fallback can now under-estimate.** If Anthropic *raises* prices on
  a new flagship, the same-family proxy reads low until the card is
  updated. This is an accepted trade: a 3× over-count erodes trust harder
  than a small under-count, and the `unknownModel` flag still fires. Prior
  pricing moves on the Opus line have been flat or downward.
- **Tier parsing is a heuristic, not a contract.** A model ID that doesn't
  match `claude-<tier>-<major>-<minor>` falls through to global max-output.
  If Anthropic changes its ID scheme, the matcher degrades to the old
  behavior rather than breaking.
- **The rate-card update is still mandatory.** This only buys time; it does
  not make `pricing.json` self-maintaining.
