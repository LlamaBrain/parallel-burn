// computeCost — retail USD for a single MessageEvent against a PricingProvider.
//
// SPEC.md §10 Phase 2: "Handle all cache token rates correctly." The
// per-model rates in `pricing.json` are *already* the precomputed effective
// rates (1.25× input for 5m cache writes, 2× input for 1h cache writes,
// 0.1× input for cache reads) — this module reads them directly and never
// multiplies by 1.25 in code. Single source of truth: the rate card.
//
// Unknown-model policy (per CLAUDE.md "If a pricing rate is unclear, log a
// warning and use a conservative fallback. Do not silently zero-cost an
// unknown model."): we bill against the most-expensive known model's rates
// and flag `unknownModel: true` so callers can render a warning. The
// fallback is conservative in the upper-bound sense: it overestimates
// rather than underestimates the unknown.

import type { MessageEvent } from "./event.js";
import type { ModelPricing, PricingProvider } from "./pricing.js";

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
  const fallback = pickConservativeFallback(pricing);
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

function pickConservativeFallback(
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
