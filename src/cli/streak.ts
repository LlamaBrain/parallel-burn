// `/streak` — the streak + recent-history CLI.
//
// Renders the current streak count and the last 30 calendar days as a
// sparse calendar of daily retail-cost numbers. Invoked from
// `commands/streak.md` via `!bash` in Claude Code.

import process from "node:process";

import {
  listSessions,
  summarizeSession,
  type SessionAggregate,
} from "../core/aggregator.js";
import { PricingProvider } from "../core/pricing.js";
import {
  computeStreak,
  dateOf,
  DEFAULT_DAILY_THRESHOLD_USD,
  previousDay,
} from "../core/streak.js";
import { readTranscript } from "../core/transcript.js";
import {
  formatUsd,
  renderTable,
  type ColumnSpec,
} from "./format.js";

const HISTORY_DAYS_DEFAULT = 30;

export type StreakSnapshot = {
  readonly today: string;
  readonly dailyCostUsd: ReadonlyMap<string, number>;
  readonly thresholdUsd: number;
  readonly windowDays: number;
};

export function renderStreakReport(s: StreakSnapshot): string {
  const streak = computeStreak(s.dailyCostUsd, s.today, s.thresholdUsd);
  const days = recentDays(s.today, s.windowDays);

  let total = 0;
  let qualifying = 0;
  for (const d of days) {
    const cost = s.dailyCostUsd.get(d) ?? 0;
    total += cost;
    if (cost >= s.thresholdUsd) qualifying++;
  }
  const avg = days.length > 0 ? total / days.length : 0;

  const lines: string[] = [];
  lines.push(`● Streak — ${s.today}`);
  lines.push("");
  lines.push(
    `  ${String(streak)} day${streak === 1 ? "" : "s"} at or above ${formatUsd(s.thresholdUsd)}/day.` +
      (streak > 0 ? "" : `  (Today is ${formatUsd(s.dailyCostUsd.get(s.today) ?? 0)} so far.)`),
  );
  lines.push(
    `  Last ${String(s.windowDays)} days: ${formatUsd(total)} total, ${formatUsd(avg)} average, ` +
      `${String(qualifying)}/${String(days.length)} qualifying.`,
  );
  lines.push("");

  const cols: ColumnSpec[] = [
    { header: "Date", align: "left" },
    { header: "Cost", align: "right" },
    { header: "Streak?", align: "left" },
  ];
  const rows = days.map((d) => {
    const cost = s.dailyCostUsd.get(d) ?? 0;
    return [d, formatUsd(cost), cost >= s.thresholdUsd ? "yes" : "—"];
  });
  lines.push(`  ${indent(renderTable(cols, rows)).slice(2)}`);
  return lines.join("\n");
}

function recentDays(today: string, n: number): string[] {
  const out: string[] = [];
  let d = today;
  for (let i = 0; i < n; i++) {
    out.push(d);
    d = previousDay(d);
  }
  return out;
}

function indent(block: string): string {
  return block
    .split("\n")
    .map((l) => `  ${l}`)
    .join("\n");
}

/* v8 ignore start -- exercised in real Claude Code invocation, not in unit tests. */
async function main(): Promise<void> {
  const pricing = await PricingProvider.fromFile(
    process.env["PARALLEL_BURN_PRICING_FILE"] ?? "./pricing.json",
  );
  const sessions = await listSessions();
  const dailyCostUsd = new Map<string, number>();

  for (const m of sessions) {
    let events: Awaited<ReturnType<typeof readTranscript>> = [];
    try {
      events = await readTranscript(m.transcript_path);
    } catch {
      events = [];
    }
    const summary: SessionAggregate = summarizeSession(m, events, pricing);
    const d = dateOf(summary.startedAt);
    dailyCostUsd.set(d, (dailyCostUsd.get(d) ?? 0) + summary.costUsd);
  }

  const today = dateOf(new Date().toISOString());
  const out = renderStreakReport({
    today,
    dailyCostUsd,
    thresholdUsd: DEFAULT_DAILY_THRESHOLD_USD,
    windowDays: HISTORY_DAYS_DEFAULT,
  });
  process.stdout.write(`${out}\n`);
}

import { pathToFileURL } from "node:url";
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err: unknown) => {
    process.stderr.write(`[streak] ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
/* v8 ignore stop */
