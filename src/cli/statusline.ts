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
// **Performance.** Statuslines run on the fast loop; re-aggregating
// 1000+ session manifests on every tick is a disk hammer. The statusline
// prefers `GET http://127.0.0.1:<port>/api/today` (single TCP roundtrip,
// returns the cached server snapshot) and falls back to direct
// aggregation only if the server isn't running. Set
// `PARALLEL_BURN_NO_SERVER_FETCH=1` to skip the fetch path entirely.
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
import { readConfig } from "../core/config.js";
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

const SERVER_FETCH_TIMEOUT_MS = 250;

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

type ServerSnapshot = {
  readonly date: string;
  readonly aggregate: {
    readonly compressionRatio: number;
    readonly totalCostUsd: number;
    readonly cacheDisciplineRatio: number;
  };
  readonly streak: number;
  readonly pricingStale: boolean;
};

function isServerSnapshot(x: unknown): x is ServerSnapshot {
  if (typeof x !== "object" || x === null || Array.isArray(x)) return false;
  const o = x as Record<string, unknown>;
  if (typeof o["date"] !== "string") return false;
  if (typeof o["streak"] !== "number") return false;
  if (typeof o["pricingStale"] !== "boolean") return false;
  const a = o["aggregate"];
  if (typeof a !== "object" || a === null) return false;
  const ag = a as Record<string, unknown>;
  return (
    typeof ag["compressionRatio"] === "number" &&
    typeof ag["totalCostUsd"] === "number" &&
    typeof ag["cacheDisciplineRatio"] === "number"
  );
}

/**
 * Fast path: try the running localhost server. Returns null on any
 * failure (server not running, timeout, malformed payload) so the caller
 * can fall back to direct aggregation.
 */
export async function fetchServerSnapshot(port: number): Promise<ServerSnapshot | null> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), SERVER_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`http://127.0.0.1:${String(port)}/api/today`, {
      signal: ac.signal,
    });
    if (!res.ok) return null;
    const parsed: unknown = await res.json();
    return isServerSnapshot(parsed) ? parsed : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function renderFromServerSnapshot(snap: ServerSnapshot): string {
  return [
    `${ACCENT}⊕${RESET} ${formatRatio(snap.aggregate.compressionRatio)} parallel`,
    `${formatUsd(snap.aggregate.totalCostUsd)} today`,
    `${formatRatio(snap.aggregate.cacheDisciplineRatio)} cache`,
    `streak ${String(snap.streak)}d`,
    ...(snap.pricingStale ? [`${DIM}pricing stale${RESET}`] : []),
  ].join(SEP);
}

/* v8 ignore start -- exercised in real Claude Code invocation. */
async function main(): Promise<void> {
  // Drain stdin (Claude Code passes session context as JSON). We don't
  // currently use it, but reading it avoids EPIPE on Claude Code's side.
  if (!process.stdin.isTTY) {
    for await (const _chunk of process.stdin) void _chunk;
  }

  const config = await readConfig();

  // Fast path: hit the running server.
  if (process.env["PARALLEL_BURN_NO_SERVER_FETCH"] !== "1") {
    const snap = await fetchServerSnapshot(config.serverPort);
    if (snap !== null) {
      process.stdout.write(renderFromServerSnapshot(snap));
      return;
    }
  }

  // Slow path: re-aggregate from disk.
  // Mirror the server's lookback-window optimization (see src/server/
  // server.ts) — only consider sessions in the recent window so the
  // slow path doesn't read thousands of irrelevant historical transcripts.
  const STATUSLINE_LOOKBACK_DAYS = 31;
  const sinceMs = Date.now() - STATUSLINE_LOOKBACK_DAYS * 86_400_000;
  const pricing = await PricingProvider.fromFile(
    process.env["PARALLEL_BURN_PRICING_FILE"] ?? "./pricing.json",
  );
  const sessions = await listSessions();
  const recent = sessions.filter((m) => {
    const t = Date.parse(m.started_at);
    return Number.isFinite(t) && t >= sinceMs;
  });
  const aggregates: SessionAggregate[] = [];
  const dailyCostUsd = new Map<string, number>();
  for (const m of recent) {
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
