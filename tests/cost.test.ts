import { describe, expect, it } from "vitest";

import { CONSERVATIVE_FALLBACK_POLICY, computeCost, EmptyPricingError } from "../src/core/cost.js";
import type { MessageEvent, MessageEventUsage } from "../src/core/event.js";
import { MESSAGE_EVENT_SCHEMA_VERSION } from "../src/core/event.js";
import {
  makeMessageId,
  makeProjectId,
  makeSessionId,
} from "../src/core/ids.js";
import { PricingProvider, type PricingDocument } from "../src/core/pricing.js";

const PRICING_DOC: PricingDocument = {
  schema_version: "1.0",
  as_of: "2026-05-19",
  source: "test fixture",
  currency: "USD",
  models: {
    "claude-opus-4-7": {
      input_per_mtok: 15.0,
      output_per_mtok: 75.0,
      cache_write_5m_per_mtok: 18.75,
      cache_write_1h_per_mtok: 30.0,
      cache_read_per_mtok: 1.5,
    },
    "claude-sonnet-4-6": {
      input_per_mtok: 3.0,
      output_per_mtok: 15.0,
      cache_write_5m_per_mtok: 3.75,
      cache_write_1h_per_mtok: 6.0,
      cache_read_per_mtok: 0.3,
    },
    "claude-haiku-4-5": {
      input_per_mtok: 1.0,
      output_per_mtok: 5.0,
      cache_write_5m_per_mtok: 1.25,
      cache_write_1h_per_mtok: 2.0,
      cache_read_per_mtok: 0.1,
    },
  },
};

const PRICING = PricingProvider.fromDocument(PRICING_DOC);

function event(model: string, usage: Partial<MessageEventUsage>): MessageEvent {
  const filled: MessageEventUsage = {
    input_tokens: usage.input_tokens ?? 0,
    output_tokens: usage.output_tokens ?? 0,
    cache_creation_input_tokens: usage.cache_creation_input_tokens ?? 0,
    cache_read_input_tokens: usage.cache_read_input_tokens ?? 0,
    cache_creation: {
      ephemeral_5m_input_tokens: usage.cache_creation?.ephemeral_5m_input_tokens ?? 0,
      ephemeral_1h_input_tokens: usage.cache_creation?.ephemeral_1h_input_tokens ?? 0,
    },
  };
  return {
    schema_version: MESSAGE_EVENT_SCHEMA_VERSION,
    message_id: makeMessageId("m-test"),
    session_id: makeSessionId("s-test"),
    project: makeProjectId("parallel-burn"),
    timestamp: "2026-05-19T12:00:00Z",
    model,
    usage: filled,
  };
}

describe("computeCost — known models", () => {
  it("input + output for Opus 4.7 matches Anthropic's published rates to the cent", () => {
    // 10,000 input × $15/MTok = $0.15
    // 5,000 output × $75/MTok = $0.375
    // total = $0.525
    const c = computeCost(
      event("claude-opus-4-7", { input_tokens: 10_000, output_tokens: 5_000 }),
      PRICING,
    );
    expect(c.input).toBeCloseTo(0.15, 10);
    expect(c.output).toBeCloseTo(0.375, 10);
    expect(c.total).toBeCloseTo(0.525, 10);
    expect(c.unknownModel).toBe(false);
    expect(c.conservativeFallbackModel).toBeNull();
    expect(c.model).toBe("claude-opus-4-7");
  });

  it("a million input tokens on Sonnet 4.6 is exactly $3", () => {
    const c = computeCost(
      event("claude-sonnet-4-6", { input_tokens: 1_000_000 }),
      PRICING,
    );
    expect(c.input).toBeCloseTo(3.0, 10);
    expect(c.total).toBeCloseTo(3.0, 10);
  });

  it("a million output tokens on Haiku 4.5 is exactly $5", () => {
    const c = computeCost(
      event("claude-haiku-4-5", { output_tokens: 1_000_000 }),
      PRICING,
    );
    expect(c.output).toBeCloseTo(5.0, 10);
    expect(c.total).toBeCloseTo(5.0, 10);
  });

  it("zero tokens produce zero cost", () => {
    const c = computeCost(event("claude-opus-4-7", {}), PRICING);
    expect(c.total).toBe(0);
    expect(c.input).toBe(0);
    expect(c.output).toBe(0);
    expect(c.cacheWrite5m).toBe(0);
    expect(c.cacheWrite1h).toBe(0);
    expect(c.cacheRead).toBe(0);
  });
});

describe("computeCost — cache token rates", () => {
  it("billing matches the 1.25× / 2× / 0.1× multipliers via the per-model rates", () => {
    // Opus 4.7 input = $15/MTok.
    // 5m cache write should be 1.25× input  = $18.75/MTok.
    // 1h cache write should be 2×    input  = $30.00/MTok.
    // cache read   should be 0.1×    input  = $1.50/MTok.
    // Apply each to exactly 1M tokens so the dollars equal the rate.
    const c = computeCost(
      event("claude-opus-4-7", {
        cache_creation_input_tokens: 2_000_000,
        cache_read_input_tokens: 1_000_000,
        cache_creation: {
          ephemeral_5m_input_tokens: 1_000_000,
          ephemeral_1h_input_tokens: 1_000_000,
        },
      }),
      PRICING,
    );
    expect(c.cacheWrite5m).toBeCloseTo(18.75, 10);
    expect(c.cacheWrite1h).toBeCloseTo(30.0, 10);
    expect(c.cacheRead).toBeCloseTo(1.5, 10);
    expect(c.total).toBeCloseTo(18.75 + 30.0 + 1.5, 10);
  });

  it("legacy cache_creation_input_tokens with no granular breakdown bills at the 5m rate", () => {
    const c = computeCost(
      event("claude-opus-4-7", {
        cache_creation_input_tokens: 1_000_000,
        cache_creation: {
          ephemeral_5m_input_tokens: 0,
          ephemeral_1h_input_tokens: 0,
        },
      }),
      PRICING,
    );
    expect(c.cacheWrite5m).toBeCloseTo(18.75, 10);
    expect(c.cacheWrite1h).toBe(0);
    expect(c.total).toBeCloseTo(18.75, 10);
  });

  it("granular breakdown wins over the legacy total when they disagree", () => {
    // total claims 500k, breakdown claims 1.2M — bill the breakdown.
    const c = computeCost(
      event("claude-opus-4-7", {
        cache_creation_input_tokens: 500_000,
        cache_creation: {
          ephemeral_5m_input_tokens: 1_000_000,
          ephemeral_1h_input_tokens: 200_000,
        },
      }),
      PRICING,
    );
    expect(c.cacheWrite5m).toBeCloseTo(18.75, 10);
    expect(c.cacheWrite1h).toBeCloseTo(6.0, 10); // 200k × $30 / 1M
    expect(c.total).toBeCloseTo(18.75 + 6.0, 10);
  });

  it("partial granular + partial legacy: only the unaccounted remainder bills at 5m", () => {
    // total = 1M, granular = 600k (5m=400k, 1h=200k) → 400k unaccounted bills at 5m.
    const c = computeCost(
      event("claude-opus-4-7", {
        cache_creation_input_tokens: 1_000_000,
        cache_creation: {
          ephemeral_5m_input_tokens: 400_000,
          ephemeral_1h_input_tokens: 200_000,
        },
      }),
      PRICING,
    );
    // 5m total = (400k + 400k unaccounted) × $18.75 / 1M = $15.00
    expect(c.cacheWrite5m).toBeCloseTo(15.0, 10);
    // 1h = 200k × $30 / 1M = $6.00
    expect(c.cacheWrite1h).toBeCloseTo(6.0, 10);
    expect(c.total).toBeCloseTo(21.0, 10);
  });
});

describe("computeCost — unknown model", () => {
  it("flags unknown and bills against the most-expensive (conservative) model", () => {
    // 100k input on an unknown model. Opus is the most expensive ($15/MTok input).
    const c = computeCost(
      event("claude-future-model", { input_tokens: 100_000 }),
      PRICING,
    );
    expect(c.unknownModel).toBe(true);
    expect(c.conservativeFallbackModel).toBe("claude-opus-4-7");
    expect(c.input).toBeCloseTo(1.5, 10); // 100k × $15 / 1M
    expect(c.model).toBe("claude-future-model");
  });

  it("CONSERVATIVE_FALLBACK_POLICY documents the family-first selector + direction", () => {
    // This test exists to keep the constant and its rationale in lockstep:
    // if the implementation drifts (e.g. someone changes pickConservativeFallback
    // to use a different selector), the constant must move with it.
    expect(CONSERVATIVE_FALLBACK_POLICY.selector).toBe("latest-known-in-family-else-max-output");
    expect(CONSERVATIVE_FALLBACK_POLICY.direction).toBe("matches-family-rate-else-overestimates");
  });

  it("prices an unknown model at its own family's latest rate, not the globally most expensive model", () => {
    // Regression for the opus-4-8 incident (ADR-0008): the card still lists
    // the retired, pricey opus-4-1 ($75 output) alongside the current opus-4-7
    // ($25). A not-yet-carded opus-4-8 must inherit the *current* Opus rate via
    // its family, not get billed 3× at the global-max opus-4-1 rate.
    const doc: PricingDocument = {
      schema_version: "1.0",
      as_of: "2026-05-01",
      source: "test",
      currency: "USD",
      models: {
        "claude-opus-4-1": {
          input_per_mtok: 15, output_per_mtok: 75,
          cache_write_5m_per_mtok: 18.75, cache_write_1h_per_mtok: 30, cache_read_per_mtok: 1.5,
        },
        "claude-opus-4-7": {
          input_per_mtok: 5, output_per_mtok: 25,
          cache_write_5m_per_mtok: 6.25, cache_write_1h_per_mtok: 10, cache_read_per_mtok: 0.5,
        },
        "claude-sonnet-4-6": {
          input_per_mtok: 3, output_per_mtok: 15,
          cache_write_5m_per_mtok: 3.75, cache_write_1h_per_mtok: 6, cache_read_per_mtok: 0.3,
        },
      },
    };
    const c = computeCost(
      event("claude-opus-4-8", { output_tokens: 1_000_000 }),
      PricingProvider.fromDocument(doc),
    );
    expect(c.unknownModel).toBe(true);
    expect(c.conservativeFallbackModel).toBe("claude-opus-4-7");
    expect(c.output).toBeCloseTo(25, 10); // $25 at the family rate, not $75
  });

  it("conservative fallback is always the model with the highest output_per_mtok", () => {
    // Build a rate card where the max-output model is NOT the alphabetically
    // first key. Implementation must scan and pick by output rate, not
    // iteration order.
    const doc: PricingDocument = {
      schema_version: "1.0",
      as_of: "2026-05-01",
      source: "test",
      currency: "USD",
      models: {
        "zzz-cheap": {
          input_per_mtok: 0.1, output_per_mtok: 0.5,
          cache_write_5m_per_mtok: 0.1, cache_write_1h_per_mtok: 0.2, cache_read_per_mtok: 0.01,
        },
        "aaa-expensive": {
          input_per_mtok: 99, output_per_mtok: 999,
          cache_write_5m_per_mtok: 123, cache_write_1h_per_mtok: 200, cache_read_per_mtok: 10,
        },
        "mmm-mid": {
          input_per_mtok: 5, output_per_mtok: 25,
          cache_write_5m_per_mtok: 6, cache_write_1h_per_mtok: 10, cache_read_per_mtok: 0.5,
        },
      },
    };
    const c = computeCost(event("brand-new-model", { input_tokens: 1_000 }), PricingProvider.fromDocument(doc));
    expect(c.unknownModel).toBe(true);
    expect(c.conservativeFallbackModel).toBe("aaa-expensive");
  });

  it("throws EmptyPricingError when the PricingProvider exposes no models", () => {
    const emptyPricing = PricingProvider.fromDocument({
      ...PRICING_DOC,
      models: {},
    });
    expect(() =>
      computeCost(event("claude-anything", { input_tokens: 1 }), emptyPricing),
    ).toThrow(EmptyPricingError);
  });
});

describe("computeCost — numeric safety", () => {
  it("handles 1B-token messages without overflow or precision blowup", () => {
    const c = computeCost(
      event("claude-opus-4-7", {
        input_tokens: 1_000_000_000,
        output_tokens: 1_000_000_000,
      }),
      PRICING,
    );
    // 1B × $15 / 1M = $15,000
    expect(c.input).toBeCloseTo(15_000, 6);
    // 1B × $75 / 1M = $75,000
    expect(c.output).toBeCloseTo(75_000, 6);
    expect(c.total).toBeCloseTo(90_000, 6);
    expect(Number.isFinite(c.total)).toBe(true);
  });

  it("the total equals the sum of the component fields exactly (no rounding drift)", () => {
    const c = computeCost(
      event("claude-opus-4-7", {
        input_tokens: 12_345,
        output_tokens: 6_789,
        cache_read_input_tokens: 4_321,
        cache_creation_input_tokens: 9_876,
        cache_creation: {
          ephemeral_5m_input_tokens: 5_432,
          ephemeral_1h_input_tokens: 1_111,
        },
      }),
      PRICING,
    );
    const sum =
      c.input + c.output + c.cacheWrite5m + c.cacheWrite1h + c.cacheRead;
    expect(c.total).toBe(sum);
  });
});
