// `statusline` — single-line summary for Claude Code's `statusLine` setting.
//
// Claude Code lets the user wire a `statusLine.command` in `~/.claude/
// settings.json`. The command is invoked frequently (a few times per
// second when active), receives the current session context as JSON on
// stdin, and is expected to print one line of text on stdout. That line
// is rendered below the input area.
//
// ParallelBurn's statusline is parallelism-first: the parallelism
// multiplier (× compression ratio), then its inputs as `context / wall`
// so the operator can see *why* the ratio is what it is, then cache hit
// percent, then today's burn. Field set matches the OSD overlay's
// primary metrics; streak and cache-discipline ratio live only in the
// overlay (`/parallel-burn` and `/streak` cover them on demand).
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
import { dateOf } from "../core/streak.js";
import { readTranscript } from "../core/transcript.js";
import { formatDuration, formatRatio, formatUsd } from "./format.js";

const SERVER_FETCH_TIMEOUT_MS = 250;

const ACCENT = "[38;5;208m"; // soft orange — LlamaBrain accent
const DIM = "[2m";
const RESET = "[0m";
const SEP = `${DIM} · ${RESET}`;

export type StatuslineInputs = {
  readonly today: string;
  readonly sessions: readonly SessionAggregate[];
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
  const { ratio, sessionContextMs, wallClockWindowMs } = computeCompression(intervals);

  let totalInput = 0;
  let totalCacheRead = 0;
  let totalCacheWrite = 0;
  let totalCost = 0;
  for (const s of todays) {
    totalInput += s.inputTokens;
    totalCacheRead += s.cacheReadTokens;
    totalCacheWrite += s.cacheWriteTokens;
    totalCost += s.costUsd;
  }
  const promptInputDenominator = totalInput + totalCacheWrite + totalCacheRead;
  const cacheHitPercent =
    promptInputDenominator > 0 ? (totalCacheRead / promptInputDenominator) * 100 : 0;

  return formatStatusline({
    ratio,
    sessionContextMs,
    wallClockWindowMs,
    cacheHitPercent,
    totalCostUsd: totalCost,
    pricingStale: inputs.pricingStale,
  });
}

type StatuslineFields = {
  readonly ratio: number;
  readonly sessionContextMs: number;
  readonly wallClockWindowMs: number;
  readonly cacheHitPercent: number;
  readonly totalCostUsd: number;
  readonly pricingStale: boolean;
};

function formatStatusline(f: StatuslineFields): string {
  const parts: string[] = [];
  parts.push(`${ACCENT}⊕${RESET} ${formatRatio(f.ratio)} parallel`);
  parts.push(
    `${formatDuration(f.sessionContextMs)} / ${formatDuration(f.wallClockWindowMs)} ${DIM}ctx/wall${RESET}`,
  );
  parts.push(`${formatCacheHitPercent(f.cacheHitPercent)} cache`);
  parts.push(`${formatUsd(f.totalCostUsd)} today`);
  if (f.pricingStale) {
    parts.push(`${DIM}pricing stale${RESET}`);
  }
  return parts.join(SEP);
}

/**
 * Cache hit % saturates near 100 on healthy days, so one decimal place
 * carries useful information without making the number look noisy.
 * Mirrors the overlay's `fmtCacheHit` helper.
 */
function formatCacheHitPercent(p: number): string {
  if (!Number.isFinite(p) || p < 0) return "—";
  return `${p.toFixed(1)}%`;
}

type ServerSnapshot = {
  readonly date: string;
  readonly aggregate: {
    readonly compressionRatio: number;
    readonly sessionContextMs: number;
    readonly wallClockWindowMs: number;
    readonly cacheHitPercent: number;
    readonly totalCostUsd: number;
  };
  readonly pricingStale: boolean;
};

function isServerSnapshot(x: unknown): x is ServerSnapshot {
  if (typeof x !== "object" || x === null || Array.isArray(x)) return false;
  const o = x as Record<string, unknown>;
  if (typeof o["date"] !== "string") return false;
  if (typeof o["pricingStale"] !== "boolean") return false;
  const a = o["aggregate"];
  if (typeof a !== "object" || a === null) return false;
  const ag = a as Record<string, unknown>;
  return (
    typeof ag["compressionRatio"] === "number" &&
    typeof ag["sessionContextMs"] === "number" &&
    typeof ag["wallClockWindowMs"] === "number" &&
    typeof ag["cacheHitPercent"] === "number" &&
    typeof ag["totalCostUsd"] === "number"
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
  return formatStatusline({
    ratio: snap.aggregate.compressionRatio,
    sessionContextMs: snap.aggregate.sessionContextMs,
    wallClockWindowMs: snap.aggregate.wallClockWindowMs,
    cacheHitPercent: snap.aggregate.cacheHitPercent,
    totalCostUsd: snap.aggregate.totalCostUsd,
    pricingStale: snap.pricingStale,
  });
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
  for (const m of recent) {
    let events: Awaited<ReturnType<typeof readTranscript>> = [];
    try {
      events = await readTranscript(m.transcript_path);
    } catch {
      events = [];
    }
    aggregates.push(summarizeSession(m, events, pricing));
  }

  const out = renderStatusline({
    today: dateOf(new Date().toISOString()),
    sessions: aggregates,
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
