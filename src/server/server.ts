// Localhost HTTP server.
//
// Four endpoints (per SPEC §9.3, modulo ADR-0005 substituting SSE for
// WebSocket):
//
//   GET /          → 302 → /overlay
//   GET /overlay   → text/html, the OBS browser-source page
//   GET /api/today → application/json, today's DailyAggregate
//   GET /events    → text/event-stream, push-on-change feed
//
// Binds to 127.0.0.1 only. No auth — the threat model is single-user
// local machine.

import http, { type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { aggregateDay, type DailyAggregate, listSessions, summarizeSession } from "../core/aggregator.js";
import { computeStreak, dateOf } from "../core/streak.js";
import { PricingProvider } from "../core/pricing.js";
import { readTranscript } from "../core/transcript.js";
import { OVERLAY_HTML } from "./overlay.js";

const LOCALHOST = "127.0.0.1";
const SSE_HEARTBEAT_MS = 15_000;
const POLL_INTERVAL_MS = 5_000;
const HTTP_OK = 200;
const HTTP_REDIRECT = 302;
const HTTP_NOT_FOUND = 404;

export type ServerConfig = {
  readonly port: number;
  readonly pricingFile: string;
  readonly subscriptionDailyUsd: number;
  readonly dailyStreakThresholdUsd: number;
};

export type ServerHandle = {
  readonly server: Server;
  readonly url: string;
  close(): Promise<void>;
};

export type LiveSnapshot = {
  readonly date: string;
  readonly aggregate: DailyAggregate;
  readonly streak: number;
  readonly subsidyMultiplier: number;
  readonly pricingAsOf: string;
  readonly pricingStale: boolean;
};

export async function buildSnapshot(config: ServerConfig): Promise<LiveSnapshot> {
  const pricing = await PricingProvider.fromFile(config.pricingFile);
  const today = dateOf(new Date().toISOString());
  const aggregate = await aggregateDay(today, pricing);

  // Last 60 days of daily costs, to compute the streak.
  const dailyCostUsd = new Map<string, number>();
  const sessions = await listSessions();
  for (const m of sessions) {
    let events: Awaited<ReturnType<typeof readTranscript>> = [];
    try {
      events = await readTranscript(m.transcript_path);
    } catch {
      events = [];
    }
    const s = summarizeSession(m, events, pricing);
    const d = dateOf(s.startedAt);
    dailyCostUsd.set(d, (dailyCostUsd.get(d) ?? 0) + s.costUsd);
  }
  // Make sure today is in the map even if no sessions yet.
  if (!dailyCostUsd.has(today)) dailyCostUsd.set(today, aggregate.totalCostUsd);
  const streak = computeStreak(dailyCostUsd, today, config.dailyStreakThresholdUsd);

  const subsidyMultiplier =
    config.subscriptionDailyUsd > 0
      ? aggregate.totalCostUsd / config.subscriptionDailyUsd
      : 0;

  return {
    date: today,
    aggregate,
    streak,
    subsidyMultiplier,
    pricingAsOf: pricing.asOf,
    pricingStale: pricing.isStale(),
  };
}

export async function startServer(config: ServerConfig): Promise<ServerHandle> {
  const overlayHtml = OVERLAY_HTML;

  const sseClients = new Set<ServerResponse>();
  let pollTimer: NodeJS.Timeout | null = null;
  let lastSnapshotJson: string | null = null;

  async function pushIfChanged(): Promise<void> {
    try {
      const snap = await buildSnapshot(config);
      const json = JSON.stringify(snap);
      if (json !== lastSnapshotJson) {
        lastSnapshotJson = json;
        broadcastSse(sseClients, json);
      }
    } catch {
      // Suppress — keep the server alive even if a single tick fails.
    }
  }

  const server = http.createServer((req, res) => {
    handleRequest(req, res, {
      config,
      overlayHtml,
      sseClients,
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

  // Initial snapshot + recurring poll.
  await pushIfChanged();
  pollTimer = setInterval(() => {
    void pushIfChanged();
  }, POLL_INTERVAL_MS);

  return {
    server,
    url: `http://${LOCALHOST}:${String(config.port)}`,
    async close() {
      if (pollTimer !== null) {
        clearInterval(pollTimer);
        pollTimer = null;
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
  onClientSubscribed(): void;
};

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
    const snap = await buildSnapshot(ctx.config);
    res.writeHead(HTTP_OK, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify(snap));
    return;
  }
  if (url === "/events") {
    handleSse(req, res, ctx);
    return;
  }
  res.writeHead(HTTP_NOT_FOUND, { "Content-Type": "text/plain" });
  res.end("not found");
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

function broadcastSse(clients: ReadonlySet<ServerResponse>, json: string): void {
  for (const client of clients) {
    sendSseEvent(client, json);
  }
}
