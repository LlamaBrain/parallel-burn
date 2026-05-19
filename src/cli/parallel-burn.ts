// `/parallel-burn` — the live-status CLI.
//
// Renders today's aggregate as a narrative line + a per-project /
// per-session table. Invoked from `commands/parallel-burn.md` via a
// `!bash` invocation in Claude Code.

import process from "node:process";

import {
  aggregateDay,
  type DailyAggregate,
  type SessionAggregate,
} from "../core/aggregator.js";
import { PricingProvider } from "../core/pricing.js";
import { dateOf } from "../core/streak.js";
import {
  formatCount,
  formatDuration,
  formatRatio,
  formatUsd,
  renderTable,
  truncate,
  type ColumnSpec,
} from "./format.js";

const PROJECT_NAME_MAX = 24;
const SESSION_ID_TAIL = 8;

export type ParallelBurnSnapshot = {
  readonly date: string;
  readonly aggregate: DailyAggregate;
  readonly pricingAsOf: string;
  readonly pricingStale: boolean;
};

export function renderParallelBurnReport(s: ParallelBurnSnapshot): string {
  const a = s.aggregate;
  const lines: string[] = [];

  lines.push(`● ParallelBurn — ${s.date}`);
  lines.push("");

  if (a.sessions.length === 0) {
    lines.push("  No sessions recorded yet today.");
    lines.push("");
    lines.push(`  pricing.json as_of ${s.pricingAsOf}${s.pricingStale ? " — STALE" : ""}`);
    return lines.join("\n");
  }

  // Headline narrative line. Parallelism first, dollars second.
  lines.push(
    `  ${formatDuration(a.sessionContextMs)} of session-context squeezed ` +
      `into ${formatDuration(a.wallClockWindowMs)} of wall — ` +
      `a ${formatRatio(a.compressionRatio)} parallelism multiplier. ` +
      `${formatUsd(a.totalCostUsd)} list-price across ` +
      `${String(a.sessions.length)} session${a.sessions.length === 1 ? "" : "s"}. ` +
      `Cache reads cleared ${formatCount(a.cacheReadTokens)}, with ` +
      `${formatCount(a.cacheWriteTokens)} writes (discipline ${formatRatio(a.cacheDisciplineRatio)}).`,
  );
  lines.push("");

  // Per-session table.
  const sessionCols: ColumnSpec[] = [
    { header: "Duration", align: "right" },
    { header: "Cost", align: "right" },
    { header: "Size", align: "right" },
    { header: "Project", align: "left" },
    { header: "Session", align: "left" },
  ];
  const sessionRows = [...a.sessions]
    .sort((x, y) => Date.parse(x.startedAt) - Date.parse(y.startedAt))
    .map(sessionRow);
  lines.push(indent(renderTable(sessionCols, sessionRows)));
  lines.push("");

  // Per-project rollup.
  lines.push("  By Project");
  for (const p of a.byProject) {
    lines.push(
      `  - ${truncate(p.project, PROJECT_NAME_MAX)}: ${formatDuration(p.durationMs)} · ${formatUsd(p.costUsd)} (${String(p.sessionCount)} session${p.sessionCount === 1 ? "" : "s"})`,
    );
  }
  lines.push("");

  // Closing one-liner.
  lines.push(`  ${closingLine(a)}`);
  lines.push("");
  lines.push(`  pricing.json as_of ${s.pricingAsOf}${s.pricingStale ? " — STALE (>30 days old, refresh)" : ""}`);
  return lines.join("\n");
}

function sessionRow(s: SessionAggregate): string[] {
  return [
    formatDuration(s.durationMs),
    formatUsd(s.costUsd),
    formatCount(s.inputTokens + s.outputTokens + s.cacheReadTokens + s.cacheWriteTokens),
    truncate(s.project, PROJECT_NAME_MAX),
    s.sessionId.slice(-SESSION_ID_TAIL),
  ];
}

function closingLine(a: DailyAggregate): string {
  if (a.compressionRatio >= 4) {
    return `Compression ${formatRatio(a.compressionRatio)} — heavy parallel work.`;
  }
  if (a.compressionRatio >= 2) {
    return `Compression ${formatRatio(a.compressionRatio)} — comfortably parallel.`;
  }
  if (a.compressionRatio > 1) {
    return `Compression ${formatRatio(a.compressionRatio)} — some overlap.`;
  }
  return "Strictly serial day so far.";
}

function indent(block: string): string {
  return block
    .split("\n")
    .map((l) => `  ${l}`)
    .join("\n");
}

/* v8 ignore start -- exercised in real Claude Code invocation, not in unit tests. */
async function main(): Promise<void> {
  const argDate = process.argv[2];
  const date = typeof argDate === "string" && argDate.length > 0 ? argDate : dateOf(new Date().toISOString());
  const pricing = await PricingProvider.fromFile(
    process.env["PARALLEL_BURN_PRICING_FILE"] ?? "./pricing.json",
  );
  const aggregate = await aggregateDay(date, pricing);
  const out = renderParallelBurnReport({
    date,
    aggregate,
    pricingAsOf: pricing.asOf,
    pricingStale: pricing.isStale(),
  });
  process.stdout.write(`${out}\n`);
}

import { pathToFileURL } from "node:url";
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err: unknown) => {
    process.stderr.write(`[parallel-burn] ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
/* v8 ignore stop */
