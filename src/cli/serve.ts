// `parallel-burn-server` — long-running localhost server CLI.
//
// Reads operator config from `~/.parallel-burn/config.json` (port,
// subscription_daily_usd, daily_streak_threshold_usd), spins up the
// HTTP/SSE server, and prints the overlay URL on stdout. Runs until
// SIGINT/SIGTERM, then closes the server gracefully.

import process from "node:process";

import { readConfig } from "../core/config.js";
import { startServer } from "../server/server.js";

/* v8 ignore start -- runtime-only entry point. */
async function main(): Promise<void> {
  const config = await readConfig();
  const pricingFile = process.env["PARALLEL_BURN_PRICING_FILE"] ?? "./pricing.json";
  const handle = await startServer({
    port: config.serverPort,
    pricingFile,
    subscriptionDailyUsd: config.subscriptionDailyUsd,
    dailyStreakThresholdUsd: config.dailyStreakThresholdUsd,
  });
  process.stdout.write(`parallel-burn overlay: ${handle.url}/overlay\n`);

  const shutdown = (): void => {
    process.stdout.write("parallel-burn: shutting down…\n");
    handle.close().then(() => process.exit(0)).catch(() => process.exit(1));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

import { pathToFileURL } from "node:url";
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err: unknown) => {
    process.stderr.write(`[parallel-burn server] ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
/* v8 ignore stop */
