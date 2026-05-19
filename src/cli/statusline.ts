// `statusline` — single-line summary for Claude Code's `statusLine` setting.
//
// Claude Code lets the user wire a `statusLine.command` in `~/.claude/
// settings.json`. The command is invoked frequently (a few times per
// second when active), receives the current session context as JSON on
// stdin, and is expected to print one line of text on stdout. That line
// is rendered below the input area.
//
// ParallelBurn's statusline is parallelism-first: compression ratio, then
// today's burn, then streak. Same priority as the overlay (Phase 7).
//
// To enable, add to `~/.claude/settings.json`:
//
//   {
//     "statusLine": {
//       "type": "command",
//       "command": "node \"${CLAUDE_PLUGIN_ROOT}/dist/cli/statusline.js\"",
//       "padding": 0
//     }
//   }

import process from "node:process";

import {
  listSessions,
  summarizeSession,
  type SessionAggregate,
} from "../core/aggregator.js";
import { PricingProvider } from "../core/pricing.js";
import {
  computeCompression,
  type Interval,
} from "../core/compression.js";
import {
  computeStreak,
  dateOf,
  DEFAULT_DAILY_THRESHOLD_USD,
} from "../core/streak.js";
import { readTranscript } from "../core/transcript.js";
import { formatRatio, formatUsd } from "./format.js";

const ACCENT = "[38;5;208m"; // soft orange — LlamaBrain accent
const DIM = "[2m";
const RESET = "[0m";
const SEP = `${DIM} · ${RESET}`;

export type StatuslineInputs = {
  readonly today: string;
  readonly sessions: readonly SessionAggregate[];
  readonly dailyCostUsd: ReadonlyMap<string, number>;
  readonly thresholdUsd: number;
  readonly pricingStale: boolean;
};

export function renderStatusline(inputs: StatuslineInputs): string {
  const todays = inputs.sessions.filter((s) => dateOf(s.startedAt) === inputs.today);
  const intervals: Interval[] = todays
    .map((s) => ({
      start: Date.parse(s.startedAt),
      end: Date.parse(s.endedAt ?? s.lastSeenActive),
    }))
    .filter((i) => Number.isFinite(i.start) && Number.isFinite(i.end));
  const { ratio } = computeCompression(intervals);

  const totalToday = todays.reduce((acc, s) => acc + s.costUsd, 0);
  const streak = computeStreak(inputs.dailyCostUsd, inputs.today, inputs.thresholdUsd);

  const parts: string[] = [];
  parts.push(`${ACCENT}⊕${RESET} ${formatRatio(ratio)} parallel`);
  parts.push(`${formatUsd(totalToday)} today`);
  parts.push(`streak ${String(streak)}d`);
  if (inputs.pricingStale) {
    parts.push(`${DIM}pricing stale${RESET}`);
  }
  return parts.join(SEP);
}

/* v8 ignore start -- exercised in real Claude Code invocation. */
async function main(): Promise<void> {
  // Drain stdin (Claude Code passes session context as JSON). We don't
  // currently use it, but reading it avoids EPIPE on Claude Code's side.
  if (!process.stdin.isTTY) {
    for await (const _chunk of process.stdin) void _chunk;
  }

  const pricing = await PricingProvider.fromFile(
    process.env["PARALLEL_BURN_PRICING_FILE"] ?? "./pricing.json",
  );
  const sessions = await listSessions();
  const aggregates: SessionAggregate[] = [];
  const dailyCostUsd = new Map<string, number>();
  for (const m of sessions) {
    let events: Awaited<ReturnType<typeof readTranscript>> = [];
    try {
      events = await readTranscript(m.transcript_path);
    } catch {
      events = [];
    }
    const summary = summarizeSession(m, events, pricing);
    aggregates.push(summary);
    const d = dateOf(summary.startedAt);
    dailyCostUsd.set(d, (dailyCostUsd.get(d) ?? 0) + summary.costUsd);
  }

  const out = renderStatusline({
    today: dateOf(new Date().toISOString()),
    sessions: aggregates,
    dailyCostUsd,
    thresholdUsd: DEFAULT_DAILY_THRESHOLD_USD,
    pricingStale: pricing.isStale(),
  });
  process.stdout.write(out);
}

import { pathToFileURL } from "node:url";
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch(() => {
    // Statusline failures must never block Claude Code. Print an empty
    // line and exit 0 — the worst case is just a blank statusline.
    process.stdout.write("");
    process.exit(0);
  });
}
/* v8 ignore stop */
