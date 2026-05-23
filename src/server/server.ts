// Localhost HTTP server.
//
// Four endpoints (per SPEC §9.3, modulo ADR-0005 substituting SSE for
// WebSocket):
//
//   GET /          → 302 → /overlay
//   GET /overlay   → text/html, the OBS browser-source page
//   GET /api/today → application/json, today's DailyAggregate
//   GET /api/day?date=YYYY-MM-DD → application/json, the named day's
//     DailyAggregate. Used by the cost-reconciliation procedure when the
//     operator has URL access but no terminal access.
//   GET /events    → text/event-stream, push-on-change feed
//
// Binds to 127.0.0.1 only. No auth — the threat model is single-user
// local machine.

import http, { type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { aggregateDay, type DailyAggregate, listSessions } from "../core/aggregator.js";
import {
  computeActiveStreak,
  computeLongestActiveStreak,
  enrichDailyActivityWithRecent,
  readStatsCache,
} from "../core/claude-stats.js";
import { dateOf } from "../core/streak.js";
import { PricingProvider } from "../core/pricing.js";
import { OVERLAY_HTML } from "./overlay.js";

const LOCALHOST = "127.0.0.1";
const SSE_HEARTBEAT_MS = 15_000;
/** Fast-path poll: today's aggregate (small, cheap). */
const TODAY_POLL_INTERVAL_MS = 15_000;
/** Slow-path refresh: re-read Claude Code's stats cache for the streak. */
const STREAK_REFRESH_INTERVAL_MS = 5 * 60_000;
const HTTP_OK = 200;
const HTTP_REDIRECT = 302;
const HTTP_NOT_FOUND = 404;

export type ServerConfig = {
  readonly port: number;
  readonly pricingFile: string;
  readonly subscriptionDailyUsd: number;
  readonly dailyStreakThresholdUsd: number;
  /** Override the on-disk sessions directory. Production code uses the
      default (`~/.parallel-burn/data/sessions/`); tests pass a tmp path. */
  readonly sessionsDir?: string;
};

export type ServerHandle = {
  readonly server: Server;
  readonly url: string;
  close(): Promise<void>;
};

export type LiveSnapshot = {
  readonly date: string;
  readonly aggregate: DailyAggregate;
  /** Active-day streak ending today, matching Claude Code's /stats view. */
  readonly streak: number;
  /** Longest active-day streak ever observed in Claude Code's stats cache. */
  readonly longestStreak: number;
  /** retail USD / subscription_daily_usd. */
  readonly subsidyMultiplier: number;
  /** Pricing rate-card metadata. */
  readonly pricingAsOf: string;
  readonly pricingStale: boolean;
  /** Iso8601 of when this snapshot was last computed. */
  readonly computedAt: string;
};

/**
 * Build the full snapshot in one shot. Useful for the initial population
 * and for one-off HTTP `/api/today` requests when no cached state is
 * available. Reads 1–N transcripts (today) plus consults Claude Code's
 * stats cache for the active-day streak.
 */
export async function buildSnapshot(config: ServerConfig): Promise<LiveSnapshot> {
  const pricing = await PricingProvider.fromFile(config.pricingFile);
  const today = dateOf(new Date().toISOString());
  // When `sessionsDir` is overridden we're in test territory — also
  // disable the aggregator's auto-backfill so the test doesn't scan
  // the operator's real `~/.claude/projects/`. Production paths leave
  // both unset and get the self-healing default (see ADR-0007).
  const aggregatorOptions = config.sessionsDir !== undefined
    ? { sessionsDir: config.sessionsDir, autoBackfill: false }
    : {};
  const aggregate = await aggregateDay(today, pricing, aggregatorOptions);
  const streakSnapshot = await computeStreakFromClaudeStats(today, aggregate, aggregatorOptions);
  const subsidyMultiplier =
    config.subscriptionDailyUsd > 0
      ? aggregate.totalCostUsd / config.subscriptionDailyUsd
      : 0;
  return {
    date: today,
    aggregate,
    streak: streakSnapshot.current,
    longestStreak: streakSnapshot.longest,
    subsidyMultiplier,
    pricingAsOf: pricing.asOf,
    pricingStale: pricing.isStale(),
    computedAt: new Date().toISOString(),
  };
}

/**
 * Compute current + longest active-day streak from Claude Code's stats
 * cache, with today stamped active if our own aggregator confirms
 * sessions today (the cache lags one day — `lastComputedDate` is always
 * yesterday or older).
 *
 * Returns zero streaks (and falls through transparently) if the cache
 * is missing or unparseable — the server keeps running, the overlay
 * just shows `0d`.
 */
async function computeStreakFromClaudeStats(
  today: string,
  aggregate: DailyAggregate,
  options: { sessionsDir?: string } = {},
): Promise<{ current: number; longest: number }> {
  const cache = await readStatsCache();
  if (cache === null) return { current: 0, longest: 0 };
  const todayHasActivity = aggregate.sessions.length > 0;
  // Claude Code's stats-cache.json is recomputed offline and is typically
  // 1+ days stale. Synthesize post-cache days from our own manifests so
  // computeActiveStreak doesn't walk into a hole that truncates a real
  // long streak to 1.
  const recent = await listSessions(options).catch(() => []);
  const enriched = enrichDailyActivityWithRecent(
    cache.dailyActivity,
    recent,
    cache.lastComputedDate,
  );
  return {
    current: computeActiveStreak(today, enriched, todayHasActivity),
    longest: computeLongestActiveStreak(enriched, today, todayHasActivity),
  };
}

/**
 * Fast-path: compute today's snapshot using cached streak numbers. The
 * streak cache is refreshed by the slow tick on its own schedule; here
 * we only re-aggregate today's sessions, which is cheap.
 */
async function buildTodaySnapshot(
  config: ServerConfig,
  cachedStreak: { current: number; longest: number },
): Promise<LiveSnapshot> {
  const pricing = await PricingProvider.fromFile(config.pricingFile);
  const today = dateOf(new Date().toISOString());
  // When `sessionsDir` is overridden we're in test territory — also
  // disable the aggregator's auto-backfill so the test doesn't scan
  // the operator's real `~/.claude/projects/`. Production paths leave
  // both unset and get the self-healing default (see ADR-0007).
  const aggregatorOptions = config.sessionsDir !== undefined
    ? { sessionsDir: config.sessionsDir, autoBackfill: false }
    : {};
  const aggregate = await aggregateDay(today, pricing, aggregatorOptions);
  // Re-stamp the streak's "today active" flag from this poll's data —
  // if a session just started, today becomes active immediately even
  // before the slow tick refreshes.
  const liveStreak = aggregate.sessions.length > 0
    ? { current: Math.max(cachedStreak.current, cachedStreak.current === 0 ? 1 : 0), longest: cachedStreak.longest }
    : cachedStreak;
  const subsidyMultiplier =
    config.subscriptionDailyUsd > 0
      ? aggregate.totalCostUsd / config.subscriptionDailyUsd
      : 0;
  return {
    date: today,
    aggregate,
    streak: liveStreak.current,
    longestStreak: liveStreak.longest,
    subsidyMultiplier,
    pricingAsOf: pricing.asOf,
    pricingStale: pricing.isStale(),
    computedAt: new Date().toISOString(),
  };
}

export async function startServer(config: ServerConfig): Promise<ServerHandle> {
  const overlayHtml = OVERLAY_HTML;

  const sseClients = new Set<ServerResponse>();
  let fastTimer: NodeJS.Timeout | null = null;
  let slowTimer: NodeJS.Timeout | null = null;
  let lastSnapshotJson: string | null = null;
  let cachedStreak: { current: number; longest: number } = { current: 0, longest: 0 };

  async function refreshStreakCache(): Promise<void> {
    try {
      const today = dateOf(new Date().toISOString());
      const aggregatorOptions = config.sessionsDir !== undefined
        ? { sessionsDir: config.sessionsDir, autoBackfill: false }
        : {};
      const pricing = await PricingProvider.fromFile(config.pricingFile);
      const aggregate = await aggregateDay(today, pricing, aggregatorOptions);
      cachedStreak = await computeStreakFromClaudeStats(today, aggregate, aggregatorOptions);
    } catch {
      // Keep the previous cache — better stale data than nothing.
    }
  }

  async function pushTodayIfChanged(): Promise<void> {
    try {
      const snap = await buildTodaySnapshot(config, cachedStreak);
      const json = JSON.stringify(snap);
      if (json !== lastSnapshotJson) {
        lastSnapshotJson = json;
        broadcastSse(sseClients, json);
      }
    } catch {
      // Keep the server alive even if a single tick fails.
    }
  }

  const server = http.createServer((req, res) => {
    handleRequest(req, res, {
      config,
      overlayHtml,
      sseClients,
      getLatestSnapshotJson: () => lastSnapshotJson,
      onClientSubscribed: () => {
        if (lastSnapshotJson !== null) {
          sendSseEvent(res, lastSnapshotJson);
        }
      },
    }).catch(() => {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end("internal error");
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, LOCALHOST, () => {
      server.off("error", reject);
      resolve();
    });
  });

  // Kick off the initial snapshot in the background. HTTP requests start
  // accepting *immediately* — early requests may see an empty snapshot
  // (the GET endpoint computes one fresh on demand), but the SSE
  // broadcast starts as soon as the first slow refresh completes.
  setImmediate(() => {
    void (async (): Promise<void> => {
      await refreshStreakCache();
      await pushTodayIfChanged();
    })();
  });
  fastTimer = setInterval(() => {
    void pushTodayIfChanged();
  }, TODAY_POLL_INTERVAL_MS);
  slowTimer = setInterval(() => {
    void refreshStreakCache();
  }, STREAK_REFRESH_INTERVAL_MS);

  return {
    server,
    url: `http://${LOCALHOST}:${String(config.port)}`,
    async close() {
      if (fastTimer !== null) {
        clearInterval(fastTimer);
        fastTimer = null;
      }
      if (slowTimer !== null) {
        clearInterval(slowTimer);
        slowTimer = null;
      }
      for (const client of sseClients) {
        client.end();
      }
      sseClients.clear();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    },
  };
}

type RequestContext = {
  readonly config: ServerConfig;
  readonly overlayHtml: string;
  readonly sseClients: Set<ServerResponse>;
  getLatestSnapshotJson(): string | null;
  onClientSubscribed(): void;
};

// eslint-disable-next-line @typescript-eslint/require-await -- caller uses .catch on the returned promise; future endpoints may legitimately await.
async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RequestContext,
): Promise<void> {
  const url = req.url ?? "/";

  if (url === "/" || url === "/index.html") {
    res.writeHead(HTTP_REDIRECT, { Location: "/overlay" });
    res.end();
    return;
  }
  if (url === "/overlay") {
    res.writeHead(HTTP_OK, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(ctx.overlayHtml);
    return;
  }
  if (url === "/api/today" || url === "/api/current") {
    // Always return the cached snapshot. If the cache is still cold
    // (server just booted, background refresh in flight), return a
    // zeroed placeholder rather than block. Consumers (overlay,
    // statusline) handle the empty case gracefully.
    const cached = ctx.getLatestSnapshotJson() ?? emptySnapshotJson();
    res.writeHead(HTTP_OK, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(cached);
    return;
  }
  if (url.startsWith("/api/day")) {
    await handleDayRequest(req, res, ctx);
    return;
  }
  if (url === "/events") {
    handleSse(req, res, ctx);
    return;
  }
  res.writeHead(HTTP_NOT_FOUND, { "Content-Type": "text/plain" });
  res.end("not found");
}

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * One-off aggregate for a historical day. Computed fresh, not from the
 * cache; the cache only holds today. The cost path reads each session's
 * transcript so this is not a fast endpoint — expect 100–500 ms on a
 * busy day. Used by the cost-reconciliation procedure when the operator
 * has URL access but no terminal access.
 */
async function handleDayRequest(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RequestContext,
): Promise<void> {
  const u = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);
  const date = u.searchParams.get("date");
  if (date === null || !DAY_PATTERN.test(date)) {
    res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "missing or malformed ?date=YYYY-MM-DD" }));
    return;
  }
  try {
    const pricing = await PricingProvider.fromFile(ctx.config.pricingFile);
    const aggregatorOptions = ctx.config.sessionsDir !== undefined
      ? { sessionsDir: ctx.config.sessionsDir, autoBackfill: false }
      : {};
    const aggregate = await aggregateDay(date, pricing, aggregatorOptions);
    res.writeHead(HTTP_OK, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify({
      date,
      aggregate,
      pricingAsOf: pricing.asOf,
      pricingStale: pricing.isStale(),
      computedAt: new Date().toISOString(),
    }));
  } catch (err) {
    res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({
      error: "aggregation failed",
      detail: err instanceof Error ? err.message : String(err),
    }));
  }
}

function handleSse(req: IncomingMessage, res: ServerResponse, ctx: RequestContext): void {
  res.writeHead(HTTP_OK, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write(": parallel-burn sse stream\n\n");
  ctx.sseClients.add(res);

  const heartbeat = setInterval(() => {
    if (!res.writableEnded) {
      res.write(": heartbeat\n\n");
    }
  }, SSE_HEARTBEAT_MS);

  const cleanup = (): void => {
    clearInterval(heartbeat);
    ctx.sseClients.delete(res);
  };
  req.on("close", cleanup);
  req.on("error", cleanup);
  res.on("close", cleanup);

  ctx.onClientSubscribed();
}

function sendSseEvent(res: ServerResponse, json: string): void {
  if (res.writableEnded) return;
  res.write(`data: ${json}\n\n`);
}

function emptySnapshotJson(): string {
  const today = new Date().toISOString().slice(0, 10);
  return JSON.stringify({
    date: today,
    aggregate: {
      date: today,
      sessions: [],
      byProject: [],
      sessionContextMs: 0,
      wallClockWindowMs: 0,
      spanMs: 0,
      compressionRatio: 0,
      totalCostUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      cacheDisciplineRatio: 0,
      cacheHitPercent: 0,
    },
    streak: 0,
    longestStreak: 0,
    subsidyMultiplier: 0,
    pricingAsOf: "",
    pricingStale: false,
    computedAt: new Date().toISOString(),
    warming: true,
  });
}

function broadcastSse(clients: ReadonlySet<ServerResponse>, json: string): void {
  for (const client of clients) {
    sendSseEvent(client, json);
  }
}
