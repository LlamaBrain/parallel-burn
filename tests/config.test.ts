import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_CONFIG,
  mergeConfig,
  readConfig,
} from "../src/core/config.js";

let tmp: string;
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "parallel-burn-config-"));
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("mergeConfig", () => {
  it("returns the defaults for null / non-object input", () => {
    expect(mergeConfig(null)).toEqual(DEFAULT_CONFIG);
    expect(mergeConfig("a string")).toEqual(DEFAULT_CONFIG);
    expect(mergeConfig([])).toEqual(DEFAULT_CONFIG);
  });

  it("returns the defaults for an empty object", () => {
    expect(mergeConfig({})).toEqual(DEFAULT_CONFIG);
  });

  it("merges in valid fields", () => {
    const merged = mergeConfig({
      subscription_daily_usd: 10,
      daily_streak_threshold_usd: 75,
      server_port: 8080,
      pricing_refresh_url: "https://example.com/pricing.json",
    });
    expect(merged.subscriptionDailyUsd).toBe(10);
    expect(merged.dailyStreakThresholdUsd).toBe(75);
    expect(merged.serverPort).toBe(8080);
    expect(merged.pricingRefreshUrl).toBe("https://example.com/pricing.json");
  });

  it("falls back when subscription_daily_usd is negative", () => {
    expect(
      mergeConfig({ subscription_daily_usd: -1 }).subscriptionDailyUsd,
    ).toBe(DEFAULT_CONFIG.subscriptionDailyUsd);
  });

  it("falls back when server_port is out of range or non-integer-like", () => {
    expect(mergeConfig({ server_port: 0 }).serverPort).toBe(
      DEFAULT_CONFIG.serverPort,
    );
    expect(mergeConfig({ server_port: 70_000 }).serverPort).toBe(
      DEFAULT_CONFIG.serverPort,
    );
    expect(mergeConfig({ server_port: Number.NaN }).serverPort).toBe(
      DEFAULT_CONFIG.serverPort,
    );
    expect(mergeConfig({ server_port: "8080" }).serverPort).toBe(
      DEFAULT_CONFIG.serverPort,
    );
  });

  it("accepts an empty pricing_refresh_url (the documented opt-out)", () => {
    expect(mergeConfig({ pricing_refresh_url: "" }).pricingRefreshUrl).toBe("");
  });

  it("falls back on non-string pricing_refresh_url", () => {
    expect(mergeConfig({ pricing_refresh_url: 42 }).pricingRefreshUrl).toBe(
      DEFAULT_CONFIG.pricingRefreshUrl,
    );
  });
});

describe("readConfig", () => {
  it("returns defaults when the config file is absent", async () => {
    const path = join(tmp, "config.json");
    expect(await readConfig(path)).toEqual(DEFAULT_CONFIG);
  });

  it("reads and merges a real config file", async () => {
    const path = join(tmp, "config.json");
    await writeFile(
      path,
      JSON.stringify({ subscription_daily_usd: 4.99 }),
      "utf8",
    );
    const config = await readConfig(path);
    expect(config.subscriptionDailyUsd).toBe(4.99);
    expect(config.dailyStreakThresholdUsd).toBe(
      DEFAULT_CONFIG.dailyStreakThresholdUsd,
    );
  });
});
