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
const MS_PER_MINUTE = SECONDS_PER_MINUTE * MS_PER_SECOND;
const NUM_LOCALE = "en-US";
const SESSION_TABLE_ROWS = 15;

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

  // Box-drawing table — biggest-cost sessions on top, capped at
  // SESSION_TABLE_ROWS. Tables render cleanly in any monospace viewer.
  const sortedSessions = [...a.sessions].sort((x, y) => y.costUsd - x.costUsd);
  const tableRows = sortedSessions.slice(0, SESSION_TABLE_ROWS);
  for (const line of renderBoxTable(tableRows)) lines.push(`  ${line}`);
  if (sortedSessions.length > SESSION_TABLE_ROWS) {
    lines.push(
      `  ...and ${String(sortedSessions.length - SESSION_TABLE_ROWS)} more session${sortedSessions.length - SESSION_TABLE_ROWS === 1 ? "" : "s"}.`,
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

  // Token summary line — the artifact's closing punchline.
  lines.push(`  ${tokenSummaryLine(a, plan)}`);

  return lines.join("\n");
}

function renderBoxTable(sessions: readonly SessionAggregate[]): string[] {
  const headers = ["Duration", "Cost", "Size", "Project", "Session"] as const;
  const rows = sessions.map((s) => [
    humanDuration(s.durationMs),
    usd(s.costUsd),
    countAbbrev(sessionSize(s)),
    s.project,
    shortSession(s),
  ]);
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)),
  );
  const pad = (cell: string, width: number, align: "left" | "right"): string => {
    const padding = " ".repeat(Math.max(0, width - cell.length));
    return align === "right" ? padding + cell : cell + padding;
  };
  const aligns: ("left" | "right")[] = ["right", "right", "right", "left", "left"];
  const renderRow = (row: readonly string[]): string =>
    `│ ${row.map((cell, i) => pad(cell, widths[i] ?? 0, aligns[i] ?? "left")).join(" │ ")} │`;
  const sep = (left: string, mid: string, right: string): string =>
    `${left}${widths.map((w) => "─".repeat(w + 2)).join(mid)}${right}`;

  const out: string[] = [];
  out.push(sep("┌", "┬", "┐"));
  out.push(renderRow([...headers]));
  out.push(sep("├", "┼", "┤"));
  for (let i = 0; i < rows.length; i++) {
    out.push(renderRow(rows[i] ?? []));
    if (i < rows.length - 1) out.push(sep("├", "┼", "┤"));
  }
  out.push(sep("└", "┴", "┘"));
  return out;
}

function narrativeOpening(inputs: SummaryInputs, plan: string): string {
  const a = inputs.aggregate;
  const sessionContext = humanHM(a.sessionContextMs);
  const wallClock = humanHM(a.wallClockWindowMs);
  const ratio = a.compressionRatio > 0 ? `${a.compressionRatio.toFixed(1)}×` : "—";
  const cost = usd(a.totalCostUsd);
  const n = a.sessions.length;
  const subsidy = inputs.subscriptionDailyUsd > 0
    ? `${Math.round(a.totalCostUsd / inputs.subscriptionDailyUsd).toString()}×`
    : TOTAL_TOKENS_SHARE_RATIO_FALLBACK;
  const cacheReadsAbbrev = countAbbrev(a.cacheReadTokens);

  // Span vs wall: span is the naive calendar window (first start → last
  // end), wall is the merged-interval duration that collapses gaps. The
  // ratio between them tells you whether the day was a single stretch
  // (span ≈ wall) or punctuated by breaks (span > wall).
  const span = computeSessionSpan(a.sessions);
  const spanMin = Math.round(span.spanMs / MS_PER_MINUTE);
  const wallMin = Math.round(a.wallClockWindowMs / MS_PER_MINUTE);
  const stretchNote = describeStretch(spanMin, wallMin);

  return (
    `${sessionContext} of session-context compressed into ${wallClock} of real wall — a ${ratio} parallelism multiplier ` +
    `across ${String(n)} session${n === 1 ? "" : "s"}, all for the low price of ${cost} list. ` +
    `That's about ${subsidy} the daily prorated ${plan} subscription, with ${cacheReadsAbbrev} cache reads doing most of the actual labor. ` +
    `${stretchNote}`
  );
}

function describeStretch(spanMin: number, wallMin: number): string {
  if (spanMin <= 0 || wallMin <= 0) return "";
  const diff = Math.abs(spanMin - wallMin);
  const pct = wallMin > 0 ? diff / wallMin : 0;
  if (pct < 0.02) {
    return `Span and wall lined up almost perfectly (${String(spanMin)} vs ${String(wallMin)} min), so today was honest single-stretch work, no lunch gap to subtract.`;
  }
  if (pct < 0.15) {
    return `Span (${String(spanMin)} min) vs merged wall (${String(wallMin)} min) — a few small gaps, but mostly continuous.`;
  }
  return `Span (${String(spanMin)} min) ran ${String(diff)} minutes longer than the ${String(wallMin)}-min merged wall — meaningful idle stretches between active blocks.`;
}

function computeSessionSpan(sessions: readonly SessionAggregate[]): { spanMs: number } {
  if (sessions.length === 0) return { spanMs: 0 };
  let earliest = Number.POSITIVE_INFINITY;
  let latest = Number.NEGATIVE_INFINITY;
  for (const s of sessions) {
    const start = Date.parse(s.startedAt);
    const end = Date.parse(s.endedAt ?? s.lastSeenActive);
    if (Number.isFinite(start) && start < earliest) earliest = start;
    if (Number.isFinite(end) && end > latest) latest = end;
  }
  if (!Number.isFinite(earliest) || !Number.isFinite(latest)) return { spanMs: 0 };
  return { spanMs: Math.max(0, latest - earliest) };
}

function tokenSummaryLine(a: DailyAggregate, plan: string): string {
  const inT = countAbbrev(a.inputTokens);
  const outT = countAbbrev(a.outputTokens);
  const writeT = countAbbrev(a.cacheWriteTokens);
  const readT = countAbbrev(a.cacheReadTokens);
  const rate =
    a.cacheDisciplineRatio > 0 ? `${a.cacheDisciplineRatio.toFixed(1)}× cache rate` : "no cache yet";
  return `Tokens: ${inT} in / ${outT} out / ${writeT} cache writes / ${readT} cache reads (${rate}) — the ${plan} subscription is the only reason this isn't a car payment.`;
}

function countAbbrev(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return Math.round(n).toString();
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

// (count() helper inlined into the few callers that still need it; the
// majority of output now goes through countAbbrev for readability.)
function _unusedCount(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return Math.round(n).toLocaleString(NUM_LOCALE);
}
void _unusedCount; // keep the helper available for future renderers

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
