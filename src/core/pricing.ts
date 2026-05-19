// PricingProvider — loads the rate card, exposes per-model rates, and
// surfaces a staleness signal when `as_of` is older than the threshold.
//
// The rate card is plain JSON; see `pricing.json` at the repo root for the
// canonical shape and current values. The optional remote refresh is a
// single fetch with a local fallback — the only network egress in the
// entire plugin. See SPEC.md §11: "No telemetry, no phone-home."

import { readFile } from "node:fs/promises";

export type ModelPricing = {
  readonly input_per_mtok: number;
  readonly output_per_mtok: number;
  readonly cache_write_5m_per_mtok: number;
  readonly cache_write_1h_per_mtok: number;
  readonly cache_read_per_mtok: number;
};

export type PricingDocument = {
  readonly schema_version: string;
  readonly as_of: string;
  readonly source: string;
  readonly currency: "USD";
  readonly models: Readonly<Record<string, ModelPricing>>;
};

export const SUPPORTED_PRICING_SCHEMA_VERSION = "1.0";
export const STALENESS_THRESHOLD_DAYS = 30;

const MS_PER_DAY = 86_400_000;
const AS_OF_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const REQUIRED_MODEL_FIELDS: readonly (keyof ModelPricing)[] = [
  "input_per_mtok",
  "output_per_mtok",
  "cache_write_5m_per_mtok",
  "cache_write_1h_per_mtok",
  "cache_read_per_mtok",
];

export class PricingValidationError extends Error {
  constructor(message: string) {
    super(`Invalid pricing document: ${message}`);
    this.name = "PricingValidationError";
  }
}

export class PricingProvider {
  private constructor(private readonly doc: PricingDocument) {}

  static fromDocument(doc: PricingDocument): PricingProvider {
    return new PricingProvider(validatePricingDocument(doc));
  }

  static async fromFile(path: string): Promise<PricingProvider> {
    const text = await readFile(path, "utf8");
    const parsed: unknown = JSON.parse(text);
    return new PricingProvider(validatePricingDocument(parsed));
  }

  /**
   * Attempt a remote refresh; on any failure (network, HTTP error,
   * validation), silently fall back to the local file. This is the
   * "no telemetry, no phone-home" contract: the remote endpoint is
   * advisory, never load-bearing.
   */
  static async fromRemoteWithFallback(
    remoteUrl: string,
    fallbackFilePath: string,
  ): Promise<{ provider: PricingProvider; usedRemote: boolean }> {
    try {
      const res = await fetch(remoteUrl);
      if (!res.ok) {
        throw new Error(`remote pricing fetch failed: HTTP ${String(res.status)}`);
      }
      const parsed: unknown = await res.json();
      return {
        provider: new PricingProvider(validatePricingDocument(parsed)),
        usedRemote: true,
      };
    } catch {
      return {
        provider: await PricingProvider.fromFile(fallbackFilePath),
        usedRemote: false,
      };
    }
  }

  get(model: string): ModelPricing | undefined {
    return this.doc.models[model];
  }

  has(model: string): boolean {
    return Object.prototype.hasOwnProperty.call(this.doc.models, model);
  }

  get asOf(): string {
    return this.doc.as_of;
  }

  get schemaVersion(): string {
    return this.doc.schema_version;
  }

  get source(): string {
    return this.doc.source;
  }

  get currency(): "USD" {
    return this.doc.currency;
  }

  models(): readonly string[] {
    return Object.keys(this.doc.models);
  }

  entries(): ReadonlyArray<readonly [string, ModelPricing]> {
    return Object.entries(this.doc.models);
  }

  isStale(now: Date = new Date()): boolean {
    return this.ageDays(now) > STALENESS_THRESHOLD_DAYS;
  }

  ageDays(now: Date = new Date()): number {
    // `as_of` is guaranteed parseable by validatePricingDocument.
    const asOfMs = Date.parse(`${this.doc.as_of}T00:00:00Z`);
    const ageMs = now.getTime() - asOfMs;
    return Math.floor(ageMs / MS_PER_DAY);
  }
}

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function validateModelPricing(model: string, raw: unknown): ModelPricing {
  if (!isPlainObject(raw)) {
    throw new PricingValidationError(
      `model "${model}" must be an object, got ${typeof raw}`,
    );
  }
  for (const field of REQUIRED_MODEL_FIELDS) {
    const value = raw[field];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      throw new PricingValidationError(
        `model "${model}" field "${field}" must be a finite non-negative number (got ${String(value)})`,
      );
    }
  }
  return {
    input_per_mtok: raw["input_per_mtok"] as number,
    output_per_mtok: raw["output_per_mtok"] as number,
    cache_write_5m_per_mtok: raw["cache_write_5m_per_mtok"] as number,
    cache_write_1h_per_mtok: raw["cache_write_1h_per_mtok"] as number,
    cache_read_per_mtok: raw["cache_read_per_mtok"] as number,
  };
}

export function validatePricingDocument(raw: unknown): PricingDocument {
  if (!isPlainObject(raw)) {
    throw new PricingValidationError(`document must be an object, got ${typeof raw}`);
  }
  const { schema_version, as_of, source, currency, models } = raw;
  if (schema_version !== SUPPORTED_PRICING_SCHEMA_VERSION) {
    throw new PricingValidationError(
      `unsupported schema_version: expected "${SUPPORTED_PRICING_SCHEMA_VERSION}", got ${JSON.stringify(schema_version)}`,
    );
  }
  if (typeof as_of !== "string" || !AS_OF_DATE_PATTERN.test(as_of)) {
    throw new PricingValidationError(
      `as_of must be "YYYY-MM-DD", got ${JSON.stringify(as_of)}`,
    );
  }
  if (Number.isNaN(Date.parse(`${as_of}T00:00:00Z`))) {
    throw new PricingValidationError(`as_of is not a real date: ${as_of}`);
  }
  if (typeof source !== "string" || source.length === 0) {
    throw new PricingValidationError(
      `source must be a non-empty string, got ${JSON.stringify(source)}`,
    );
  }
  if (currency !== "USD") {
    throw new PricingValidationError(
      `currency must be "USD" (v1 supports USD only), got ${JSON.stringify(currency)}`,
    );
  }
  if (!isPlainObject(models)) {
    throw new PricingValidationError(
      `models must be an object, got ${typeof models}`,
    );
  }
  const validatedModels: Record<string, ModelPricing> = {};
  for (const [name, value] of Object.entries(models)) {
    validatedModels[name] = validateModelPricing(name, value);
  }
  return {
    schema_version,
    as_of,
    source,
    currency,
    models: validatedModels,
  };
}
