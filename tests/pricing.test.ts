import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  PricingProvider,
  PricingValidationError,
  STALENESS_THRESHOLD_DAYS,
  SUPPORTED_PRICING_SCHEMA_VERSION,
  validatePricingDocument,
  type PricingDocument,
} from "../src/core/pricing.js";

const VALID_DOC: PricingDocument = {
  schema_version: "1.0",
  as_of: "2026-05-01",
  source: "https://www.anthropic.com/pricing",
  currency: "USD",
  models: {
    "claude-opus-4-7": {
      input_per_mtok: 15.0,
      output_per_mtok: 75.0,
      cache_write_5m_per_mtok: 18.75,
      cache_write_1h_per_mtok: 30.0,
      cache_read_per_mtok: 1.5,
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

let tmp: string;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "parallel-burn-pricing-"));
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

async function writePricing(doc: unknown, name = "pricing.json"): Promise<string> {
  const path = join(tmp, name);
  await writeFile(path, JSON.stringify(doc), "utf8");
  return path;
}

describe("PricingProvider.fromDocument", () => {
  it("accepts a well-formed document", () => {
    const p = PricingProvider.fromDocument(VALID_DOC);
    expect(p.asOf).toBe("2026-05-01");
    expect(p.schemaVersion).toBe(SUPPORTED_PRICING_SCHEMA_VERSION);
    expect(p.currency).toBe("USD");
    expect(p.source).toBe("https://www.anthropic.com/pricing");
    expect(p.models()).toEqual(expect.arrayContaining(["claude-opus-4-7", "claude-haiku-4-5"]));
  });

  it("entries() yields each [name, rates] pair", () => {
    const p = PricingProvider.fromDocument(VALID_DOC);
    const entries = p.entries();
    expect(entries).toHaveLength(2);
    const map = new Map(entries);
    expect(map.get("claude-opus-4-7")?.input_per_mtok).toBe(15);
    expect(map.get("claude-haiku-4-5")?.input_per_mtok).toBe(1);
  });

  it("exposes per-model rates", () => {
    const p = PricingProvider.fromDocument(VALID_DOC);
    const opus = p.get("claude-opus-4-7");
    expect(opus).toBeDefined();
    expect(opus?.input_per_mtok).toBe(15.0);
    expect(opus?.cache_read_per_mtok).toBe(1.5);
  });

  it("returns undefined for unknown models", () => {
    const p = PricingProvider.fromDocument(VALID_DOC);
    expect(p.get("claude-not-a-real-model")).toBeUndefined();
    expect(p.has("claude-not-a-real-model")).toBe(false);
  });

  it("has() distinguishes own properties from prototype pollution attempts", () => {
    const p = PricingProvider.fromDocument(VALID_DOC);
    expect(p.has("toString")).toBe(false);
    expect(p.has("__proto__")).toBe(false);
  });
});

describe("PricingProvider.fromFile", () => {
  it("loads the repo's pricing.json from disk", async () => {
    const path = await writePricing(VALID_DOC);
    const p = await PricingProvider.fromFile(path);
    expect(p.has("claude-opus-4-7")).toBe(true);
  });

  it("rejects malformed JSON with a parse error", async () => {
    const path = join(tmp, "bad.json");
    await writeFile(path, "{ not valid json", "utf8");
    await expect(PricingProvider.fromFile(path)).rejects.toThrow();
  });

  it("rejects an unsupported schema_version", async () => {
    const path = await writePricing({ ...VALID_DOC, schema_version: "2.0" });
    await expect(PricingProvider.fromFile(path)).rejects.toThrow(PricingValidationError);
    await expect(PricingProvider.fromFile(path)).rejects.toThrow(/unsupported schema_version/);
  });

  it("loads the canonical pricing.json shipped with the repo", async () => {
    // Sanity check against the actual repo artifact.
    const repoPricing = join(process.cwd(), "pricing.json");
    const p = await PricingProvider.fromFile(repoPricing);
    expect(p.has("claude-opus-4-7")).toBe(true);
    expect(p.has("claude-sonnet-4-6")).toBe(true);
    expect(p.has("claude-haiku-4-5")).toBe(true);
  });
});

describe("PricingProvider.fromRemoteWithFallback", () => {
  it("uses the remote payload when fetch succeeds", async () => {
    const path = await writePricing(VALID_DOC);
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ...VALID_DOC, as_of: "2026-05-19" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    const { provider, usedRemote } = await PricingProvider.fromRemoteWithFallback(
      "https://example.invalid/pricing.json",
      path,
    );
    expect(usedRemote).toBe(true);
    expect(provider.asOf).toBe("2026-05-19");
    fetchMock.mockRestore();
  });

  it("falls back to the local file when fetch rejects", async () => {
    const path = await writePricing(VALID_DOC);
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("network down"));
    const { provider, usedRemote } = await PricingProvider.fromRemoteWithFallback(
      "https://example.invalid/pricing.json",
      path,
    );
    expect(usedRemote).toBe(false);
    expect(provider.asOf).toBe("2026-05-01");
    fetchMock.mockRestore();
  });

  it("falls back when remote returns non-2xx", async () => {
    const path = await writePricing(VALID_DOC);
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("not found", { status: 404 }));
    const { provider, usedRemote } = await PricingProvider.fromRemoteWithFallback(
      "https://example.invalid/pricing.json",
      path,
    );
    expect(usedRemote).toBe(false);
    expect(provider.asOf).toBe("2026-05-01");
    fetchMock.mockRestore();
  });

  it("falls back when remote payload is invalid", async () => {
    const path = await writePricing(VALID_DOC);
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ schema_version: "999", models: {} }), {
          status: 200,
        }),
      );
    const { provider, usedRemote } = await PricingProvider.fromRemoteWithFallback(
      "https://example.invalid/pricing.json",
      path,
    );
    expect(usedRemote).toBe(false);
    expect(provider.asOf).toBe("2026-05-01");
    fetchMock.mockRestore();
  });
});

describe("PricingProvider.isStale / ageDays", () => {
  it("is not stale when as_of is today", () => {
    const p = PricingProvider.fromDocument({ ...VALID_DOC, as_of: "2026-05-19" });
    const now = new Date("2026-05-19T12:00:00Z");
    expect(p.isStale(now)).toBe(false);
    expect(p.ageDays(now)).toBe(0);
  });

  it("is not stale at exactly the threshold boundary", () => {
    const p = PricingProvider.fromDocument({ ...VALID_DOC, as_of: "2026-04-01" });
    const exactlyThreshold = new Date(
      Date.UTC(2026, 3, 1) + STALENESS_THRESHOLD_DAYS * 86_400_000,
    );
    expect(p.ageDays(exactlyThreshold)).toBe(STALENESS_THRESHOLD_DAYS);
    expect(p.isStale(exactlyThreshold)).toBe(false);
  });

  it("is stale one day past the threshold", () => {
    const p = PricingProvider.fromDocument({ ...VALID_DOC, as_of: "2026-04-01" });
    const past = new Date(
      Date.UTC(2026, 3, 1) + (STALENESS_THRESHOLD_DAYS + 1) * 86_400_000,
    );
    expect(p.ageDays(past)).toBe(STALENESS_THRESHOLD_DAYS + 1);
    expect(p.isStale(past)).toBe(true);
  });
});

describe("validatePricingDocument (direct)", () => {
  it("rejects non-object input", () => {
    expect(() => validatePricingDocument(null)).toThrow(PricingValidationError);
    expect(() => validatePricingDocument("a string")).toThrow(PricingValidationError);
    expect(() => validatePricingDocument([])).toThrow(PricingValidationError);
  });

  it("rejects malformed as_of", () => {
    expect(() => validatePricingDocument({ ...VALID_DOC, as_of: "May 19, 2026" })).toThrow(
      /as_of must be "YYYY-MM-DD"/,
    );
  });

  it("rejects an as_of that parses to NaN (e.g. 2026-13-40)", () => {
    expect(() => validatePricingDocument({ ...VALID_DOC, as_of: "2026-13-40" })).toThrow(
      /not a real date/,
    );
  });

  it("rejects non-USD currency", () => {
    expect(() =>
      validatePricingDocument({ ...VALID_DOC, currency: "EUR" as "USD" }),
    ).toThrow(/currency must be "USD"/);
  });

  it("rejects empty source", () => {
    expect(() => validatePricingDocument({ ...VALID_DOC, source: "" })).toThrow(
      /source must be a non-empty string/,
    );
  });

  it("rejects models with negative rates", () => {
    expect(() =>
      validatePricingDocument({
        ...VALID_DOC,
        models: {
          ...VALID_DOC.models,
          "broken-model": {
            ...VALID_DOC.models["claude-opus-4-7"]!,
            input_per_mtok: -1,
          },
        },
      }),
    ).toThrow(/finite non-negative number/);
  });

  it("rejects models with NaN rates", () => {
    expect(() =>
      validatePricingDocument({
        ...VALID_DOC,
        models: {
          ...VALID_DOC.models,
          "broken-model": {
            ...VALID_DOC.models["claude-opus-4-7"]!,
            output_per_mtok: Number.NaN,
          },
        },
      }),
    ).toThrow(/finite non-negative number/);
  });

  it("rejects models with a non-object entry", () => {
    expect(() =>
      validatePricingDocument({
        ...VALID_DOC,
        models: { "broken-model": "not-an-object" as never },
      }),
    ).toThrow(/model "broken-model" must be an object/);
  });

  it("rejects a non-object models field", () => {
    expect(() =>
      validatePricingDocument({ ...VALID_DOC, models: "not-an-object" as never }),
    ).toThrow(/models must be an object/);
  });

  it("rejects models missing a required rate field", () => {
    const incomplete: Record<string, number> = {
      input_per_mtok: 15,
      output_per_mtok: 75,
      cache_write_5m_per_mtok: 18.75,
      cache_write_1h_per_mtok: 30,
      // cache_read_per_mtok intentionally omitted
    };
    expect(() =>
      validatePricingDocument({
        ...VALID_DOC,
        models: { broken: incomplete as never },
      }),
    ).toThrow(/cache_read_per_mtok/);
  });
});

describe("PricingProvider date-suffix normalization", () => {
  it("returns family rates for date-suffixed model IDs (claude-haiku-4-5-20251001)", () => {
    const p = PricingProvider.fromDocument(VALID_DOC);
    const rates = p.get("claude-haiku-4-5-20251001");
    expect(rates).toBeDefined();
    expect(rates?.input_per_mtok).toBe(1.0);
    expect(rates?.output_per_mtok).toBe(5.0);
    expect(p.has("claude-haiku-4-5-20251001")).toBe(true);
  });

  it("returns family rates for opus-4-7 date-suffixed IDs", () => {
    const p = PricingProvider.fromDocument(VALID_DOC);
    const rates = p.get("claude-opus-4-7-20251022");
    expect(rates).toBeDefined();
    expect(rates?.input_per_mtok).toBe(15.0);
  });

  it("prefers an exact match over the normalized form", () => {
    const docWithSuffixedKey: PricingDocument = {
      ...VALID_DOC,
      models: {
        ...VALID_DOC.models,
        "claude-haiku-4-5-20251001": {
          input_per_mtok: 99.0,
          output_per_mtok: 99.0,
          cache_write_5m_per_mtok: 99.0,
          cache_write_1h_per_mtok: 99.0,
          cache_read_per_mtok: 99.0,
        },
      },
    };
    const p = PricingProvider.fromDocument(docWithSuffixedKey);
    expect(p.get("claude-haiku-4-5-20251001")?.input_per_mtok).toBe(99.0);
    expect(p.get("claude-haiku-4-5")?.input_per_mtok).toBe(1.0);
  });

  it("fails closed for brand-new model IDs whose base family is also unknown", () => {
    const p = PricingProvider.fromDocument(VALID_DOC);
    expect(p.get("claude-foo-9-9-20270101")).toBeUndefined();
    expect(p.has("claude-foo-9-9-20270101")).toBe(false);
    expect(p.get("claude-foo-9-9")).toBeUndefined();
  });

  it("does not strip non-8-digit trailing tokens", () => {
    const p = PricingProvider.fromDocument(VALID_DOC);
    // 7 digits — not a date suffix, must not be stripped.
    expect(p.get("claude-haiku-4-5-1234567")).toBeUndefined();
    // 9 digits — also not.
    expect(p.get("claude-haiku-4-5-123456789")).toBeUndefined();
    // A trailing non-numeric word — preview, beta, etc.
    expect(p.get("claude-haiku-4-5-preview")).toBeUndefined();
  });

  it("returns undefined for the empty string without throwing", () => {
    const p = PricingProvider.fromDocument(VALID_DOC);
    expect(p.get("")).toBeUndefined();
    expect(p.has("")).toBe(false);
  });
});
