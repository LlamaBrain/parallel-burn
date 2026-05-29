// computeCost — retail USD for a single MessageEvent against a PricingProvider.
//
// SPEC.md §10 Phase 2: "Handle all cache token rates correctly." The
// per-model rates in `pricing.json` are *already* the precomputed effective
// rates (1.25× input for 5m cache writes, 2× input for 1h cache writes,
// 0.1× input for cache reads) — this module reads them directly and never
// multiplies by 1.25 in code. Single source of truth: the rate card.
//
// Unknown-model policy: see CONSERVATIVE_FALLBACK_POLICY below.

import type { MessageEvent } from "./event.js";
import type { ModelPricing, PricingProvider } from "./pricing.js";

/**
 * Unknown-model fallback policy. Codifies CLAUDE.md's "If a pricing rate
 * is unclear, log a warning and use a conservative fallback. Do not
 * silently zero-cost an unknown model."
 *
 * **Two-stage selection.**
 *
 * 1. *Same-family proxy (preferred).* When the unknown model names a known
 *    tier — `claude-opus-*`, `claude-sonnet-*`, `claude-haiku-*` — use the
 *    rates of the highest-version model already carded in that family.
 *    Anthropic prices a new model like its most recent sibling: the Opus
 *    line held $5/$25 per Mtok across 4-5 / 4-6 / 4-7, so a not-yet-carded
 *    `claude-opus-4-8` should inherit *that*, not the retired
 *    `claude-opus-4-0` / `-4-1` rate of $15/$75. This is the case that bit
 *    us — the global-max rule below billed opus-4-8 at 3× its true rate
 *    until the card was updated (see ADR-0008).
 *
 * 2. *Global max-output (fallback's fallback).* For a model with no carded
 *    family sibling — a genuinely new tier — pick the highest
 *    `output_per_mtok` in the whole card. Output dominates a typical
 *    session, so the highest output rate is an upper bound on the unknown
 *    tier's true cost, and over-counting is the safer error: a user who
 *    under-counts thinks they have budget they don't.
 *
 * **Why not zero.** Zero-costing an unknown model would silently hide
 * spend; the operator might never notice that an entire model family is
 * uncosted. The flag `unknownModel: true` on the CostBreakdown lets higher
 * layers surface a count to the user (see
 * `DailyAggregate.unknownModelSessionCount`) whichever stage fired.
 */
export const CONSERVATIVE_FALLBACK_POLICY = {
  selector: "latest-known-in-family-else-max-output",
  direction: "matches-family-rate-else-overestimates",
} as const;

const TOKENS_PER_MTOK = 1_000_000;

export type CostBreakdown = {
  /** Total retail cost in USD. */
  readonly total: number;
  readonly input: number;
  readonly output: number;
  /** Includes any legacy `cache_creation_input_tokens` not accounted for in the granular breakdown. */
  readonly cacheWrite5m: number;
  readonly cacheWrite1h: number;
  readonly cacheRead: number;
  /** The event's claimed model, copied through for downstream rendering. */
  readonly model: string;
  /** True when the model is missing from the rate card and we used a fallback. */
  readonly unknownModel: boolean;
  /** Name of the fallback model whose rates were used, or null when `unknownModel` is false. */
  readonly conservativeFallbackModel: string | null;
};

export class EmptyPricingError extends Error {
  constructor() {
    super("computeCost: PricingProvider exposes no models");
    this.name = "EmptyPricingError";
  }
}

export function computeCost(
  event: MessageEvent,
  pricing: PricingProvider,
): CostBreakdown {
  const known = pricing.get(event.model);
  if (known) {
    return buildBreakdown(event, known, event.model, false, null);
  }
  const fallback = pickConservativeFallback(event.model, pricing);
  return buildBreakdown(event, fallback.rates, event.model, true, fallback.name);
}

function buildBreakdown(
  event: MessageEvent,
  rates: ModelPricing,
  declaredModel: string,
  unknownModel: boolean,
  fallbackModel: string | null,
): CostBreakdown {
  const usage = event.usage;
  const cache = usage.cache_creation;

  const input = (usage.input_tokens * rates.input_per_mtok) / TOKENS_PER_MTOK;
  const output = (usage.output_tokens * rates.output_per_mtok) / TOKENS_PER_MTOK;
  const write5mGranular =
    (cache.ephemeral_5m_input_tokens * rates.cache_write_5m_per_mtok) /
    TOKENS_PER_MTOK;
  const write1h =
    (cache.ephemeral_1h_input_tokens * rates.cache_write_1h_per_mtok) /
    TOKENS_PER_MTOK;
  const read =
    (usage.cache_read_input_tokens * rates.cache_read_per_mtok) /
    TOKENS_PER_MTOK;

  // Reconcile legacy `cache_creation_input_tokens` (the pre-1h-cache total).
  // If the granular 5m+1h breakdown doesn't sum to the legacy total, bill
  // the remainder at the 5m rate — the original ephemeral cache flavor and
  // the lower of the two cache-write rates. Errs toward underestimation
  // here on purpose: the granular fields, if present, should be trusted as
  // the more authoritative source.
  const granularSum =
    cache.ephemeral_5m_input_tokens + cache.ephemeral_1h_input_tokens;
  const unaccountedCacheWrite = Math.max(
    0,
    usage.cache_creation_input_tokens - granularSum,
  );
  const write5mLegacy =
    (unaccountedCacheWrite * rates.cache_write_5m_per_mtok) / TOKENS_PER_MTOK;

  const cacheWrite5m = write5mGranular + write5mLegacy;
  const total = input + output + cacheWrite5m + write1h + read;

  return {
    total,
    input,
    output,
    cacheWrite5m,
    cacheWrite1h: write1h,
    cacheRead: read,
    model: declaredModel,
    unknownModel,
    conservativeFallbackModel: fallbackModel,
  };
}

/**
 * Anthropic model IDs look like `claude-<tier>-<major>-<minor>[-<date>]`
 * (e.g. `claude-opus-4-8`, `claude-sonnet-4-5-20250929`). We match the tier
 * and version prefix; any trailing date or other suffix is ignored.
 */
const MODEL_FAMILY_PATTERN = /^claude-(opus|sonnet|haiku)-(\d+)-(\d+)/;

type FamilyVersion = { readonly tier: string; readonly major: number; readonly minor: number };

function parseFamilyVersion(model: string): FamilyVersion | null {
  const m = MODEL_FAMILY_PATTERN.exec(model);
  if (m === null) return null;
  const tier = m[1];
  const major = Number(m[2]);
  const minor = Number(m[3]);
  if (tier === undefined || !Number.isFinite(major) || !Number.isFinite(minor)) {
    return null;
  }
  return { tier, major, minor };
}

/**
 * Stage 1 of CONSERVATIVE_FALLBACK_POLICY: the highest-version carded model
 * that shares the unknown model's tier. Returns null when the model names no
 * recognizable tier, or the card holds no sibling in that tier.
 */
function pickLatestInFamily(
  model: string,
  pricing: PricingProvider,
): { name: string; rates: ModelPricing } | null {
  const target = parseFamilyVersion(model);
  if (target === null) return null;
  let best: { name: string; rates: ModelPricing; v: FamilyVersion } | null = null;
  for (const [name, rates] of pricing.entries()) {
    const v = parseFamilyVersion(name);
    if (v === null || v.tier !== target.tier) continue;
    if (
      best === null ||
      v.major > best.v.major ||
      (v.major === best.v.major && v.minor > best.v.minor)
    ) {
      best = { name, rates, v };
    }
  }
  return best === null ? null : { name: best.name, rates: best.rates };
}

/**
 * Stage 2: the globally highest `output_per_mtok` — an upper bound for a
 * model whose tier we don't recognize at all.
 */
function pickMaxOutput(
  pricing: PricingProvider,
): { name: string; rates: ModelPricing } {
  let best: { name: string; rates: ModelPricing } | null = null;
  for (const [name, rates] of pricing.entries()) {
    if (best === null || rates.output_per_mtok > best.rates.output_per_mtok) {
      best = { name, rates };
    }
  }
  if (best === null) {
    throw new EmptyPricingError();
  }
  return best;
}

function pickConservativeFallback(
  model: string,
  pricing: PricingProvider,
): { name: string; rates: ModelPricing } {
  return pickLatestInFamily(model, pricing) ?? pickMaxOutput(pricing);
}
