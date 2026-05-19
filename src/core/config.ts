// Operator configuration at ~/.parallel-burn/config.json.
//
// All fields are optional; the defaults are the right answer for most
// users. The only network-touching field is `pricing_refresh_url`, which
// can be set to an empty string to disable the refresh entirely.

import { join } from "node:path";

import { parallelBurnRoot } from "./paths.js";
import { readJsonOptional } from "./store.js";

export const CONFIG_FILENAME = "config.json";

const DEFAULT_SUBSCRIPTION_DAILY_USD = 200 / 30; // Max plan, $200/mo prorated
const DEFAULT_DAILY_STREAK_THRESHOLD_USD = 50;
const DEFAULT_SERVER_PORT = 37337;

export type ResolvedConfig = {
  readonly subscriptionDailyUsd: number;
  readonly dailyStreakThresholdUsd: number;
  readonly serverPort: number;
  readonly pricingRefreshUrl: string;
};

export const DEFAULT_CONFIG: ResolvedConfig = {
  subscriptionDailyUsd: DEFAULT_SUBSCRIPTION_DAILY_USD,
  dailyStreakThresholdUsd: DEFAULT_DAILY_STREAK_THRESHOLD_USD,
  serverPort: DEFAULT_SERVER_PORT,
  pricingRefreshUrl: "",
};

export function configPath(): string {
  return join(parallelBurnRoot(), CONFIG_FILENAME);
}

export async function readConfig(path: string = configPath()): Promise<ResolvedConfig> {
  const raw = await readJsonOptional(path);
  return mergeConfig(raw);
}

export function mergeConfig(raw: unknown): ResolvedConfig {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return DEFAULT_CONFIG;
  }
  const obj = raw as Record<string, unknown>;
  return {
    subscriptionDailyUsd: nonNegativeNumber(
      obj["subscription_daily_usd"],
      DEFAULT_CONFIG.subscriptionDailyUsd,
    ),
    dailyStreakThresholdUsd: nonNegativeNumber(
      obj["daily_streak_threshold_usd"],
      DEFAULT_CONFIG.dailyStreakThresholdUsd,
    ),
    serverPort: portNumber(obj["server_port"], DEFAULT_CONFIG.serverPort),
    pricingRefreshUrl:
      typeof obj["pricing_refresh_url"] === "string"
        ? obj["pricing_refresh_url"]
        : DEFAULT_CONFIG.pricingRefreshUrl,
  };
}

const MAX_PORT = 65_535;
const MIN_PORT = 1;

function nonNegativeNumber(x: unknown, fallback: number): number {
  return typeof x === "number" && Number.isFinite(x) && x >= 0 ? x : fallback;
}

function portNumber(x: unknown, fallback: number): number {
  if (typeof x !== "number" || !Number.isFinite(x)) return fallback;
  const n = Math.floor(x);
  if (n < MIN_PORT || n > MAX_PORT) return fallback;
  return n;
}
