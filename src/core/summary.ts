// End-of-session markdown summary.
//
// SPEC.md §7.3 specifies an exact narrative shape; the opening line is
// load-bearing ("It is the artifact users screenshot and share. Take it
// seriously."). We mimic that shape here. The output is markdown — a
// human-readable artifact suitable for committing to a repo, posting to
// chat, or attaching to an LLM as evidence of work done.

import type { DailyAggregate, SessionAggregate } from "./aggregator.js";

const TOTAL_TOKENS_SHARE_RATIO_FALLBACK = "—";

const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;
const MS_PER_SECOND = 1000;
const NUM_LOCALE = "en-US";

export type SummaryInputs = {
  readonly date: string;
  readonly aggregate: DailyAggregate;
  /** Daily-prorated subscription cost in USD; used for the subsidy multiplier. */
  readonly subscriptionDailyUsd: number;
  /** Plan label printed in the narrative; defaults to "Max" if omitted. */
  readonly planLabel?: string;
};

export function renderSessionSummary(inputs: SummaryInputs): string {
  const a = inputs.aggregate;
  const plan = inputs.planLabel ?? "Max";
  const lines: string[] = [];
  lines.push(`● Session Summary for ${inputs.date}`);
  lines.push("");

  if (a.sessions.length === 0) {
    lines.push("  No sessions recorded for this date.");
    lines.push("");
    return lines.join("\n");
  }

  lines.push(`  ${narrativeOpening(inputs, plan)}`);
  lines.push("");

  // Markdown table — readable raw, renders cleanly in any markdown viewer.
  lines.push("  | Duration | Cost | Size | Project | Session |");
  lines.push("  | -------- | ----:| ----:| ------- | ------- |");
  const sortedSessions = [...a.sessions].sort(
    (x, y) => Date.parse(x.startedAt) - Date.parse(y.startedAt),
  );
  for (const s of sortedSessions) {
    lines.push(
      `  | ${humanDuration(s.durationMs)} | ${usd(s.costUsd)} | ${count(sessionSize(s))} | ${s.project} | ${shortSession(s)} |`,
    );
  }
  lines.push("");

  lines.push("  By Project");
  for (const p of a.byProject) {
    lines.push(
      `  - ${p.project}: ${humanDuration(p.durationMs)} · ${usd(p.costUsd)} (${String(p.sessionCount)} session${p.sessionCount === 1 ? "" : "s"})`,
    );
  }
  lines.push("");

  lines.push(`  ${closingLine(a)}`);
  lines.push("");

  return lines.join("\n");
}

function narrativeOpening(inputs: SummaryInputs, plan: string): string {
  const a = inputs.aggregate;
  const sessionContext = humanHM(a.sessionContextMs);
  const wallClock = humanHM(a.wallClockWindowMs);
  const ratio = a.compressionRatio > 0 ? `${a.compressionRatio.toFixed(1)}×` : "—";
  const cost = usd(a.totalCostUsd);
  const n = a.sessions.length;
  const subsidy = inputs.subscriptionDailyUsd > 0
    ? `${(a.totalCostUsd / inputs.subscriptionDailyUsd).toFixed(1)}×`
    : TOTAL_TOKENS_SHARE_RATIO_FALLBACK;
  const cacheReads = count(a.cacheReadTokens);
  const cacheWrites = count(a.cacheWriteTokens);
  const tokenMix = describeTokenMix(a);

  return (
    `${sessionContext} of session-context squeezed into ${wallClock} of wall — a ${ratio} parallelism multiplier. ` +
    `${cost} list-price across ${String(n)} session${n === 1 ? "" : "s"}, roughly ${subsidy} the ${plan}-prorated daily. ` +
    `Cache reads cleared ${cacheReads}, with ${cacheWrites} writes carrying ${tokenMix}.`
  );
}

function describeTokenMix(a: DailyAggregate): string {
  const total = a.inputTokens + a.outputTokens + a.cacheReadTokens + a.cacheWriteTokens;
  if (total === 0) return "no measured tokens";
  const pctOutput = Math.round((a.outputTokens / total) * 100);
  const pctCache = Math.round(((a.cacheReadTokens + a.cacheWriteTokens) / total) * 100);
  return `~${String(pctOutput)}% output, ~${String(pctCache)}% cache`;
}

function closingLine(a: DailyAggregate): string {
  if (a.compressionRatio >= 4) {
    return `Parallelism ${a.compressionRatio.toFixed(1)}× — a heavy parallel workday.`;
  }
  if (a.compressionRatio >= 2) {
    return `Parallelism ${a.compressionRatio.toFixed(1)}× — comfortably parallel.`;
  }
  if (a.compressionRatio > 1) {
    return `Parallelism ${a.compressionRatio.toFixed(1)}× — some overlap, mostly serial.`;
  }
  return "Strictly serial day.";
}

function sessionSize(s: SessionAggregate): number {
  return s.inputTokens + s.outputTokens + s.cacheReadTokens + s.cacheWriteTokens;
}

function shortSession(s: SessionAggregate): string {
  const SESSION_ID_TAIL = 8;
  return s.sessionId.slice(-SESSION_ID_TAIL);
}

function humanDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0m";
  const totalSeconds = Math.floor(ms / MS_PER_SECOND);
  const hours = Math.floor(totalSeconds / SECONDS_PER_HOUR);
  const minutes = Math.floor((totalSeconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
  if (hours === 0) return `${String(minutes)}m`;
  return `${String(hours)}h ${String(minutes)}m`;
}

function humanHM(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0h 0m";
  const totalSeconds = Math.floor(ms / MS_PER_SECOND);
  const hours = Math.floor(totalSeconds / SECONDS_PER_HOUR);
  const minutes = Math.floor((totalSeconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
  return `${String(hours)}h ${String(minutes)}m`;
}

function usd(n: number): string {
  if (!Number.isFinite(n)) return "$—";
  return `$${n.toFixed(2)}`;
}

function count(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return Math.round(n).toLocaleString(NUM_LOCALE);
}

/**
 * Build the filename for a session-summary file, suitable for writing
 * under `~/.parallel-burn/summaries/`. Format: `YYYY-MM-DD-HHMM.md` in
 * UTC.
 */
export function summaryFilename(now: Date = new Date()): string {
  const iso = now.toISOString();
  const date = iso.slice(0, 10);
  const time = `${iso.slice(11, 13)}${iso.slice(14, 16)}`;
  return `${date}-${time}.md`;
}
