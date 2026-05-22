import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { startServer, type ServerHandle } from "../src/server/server.js";

let tmp: string;
let pricingPath: string;
let sessionsDir: string;
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "parallel-burn-server-"));
  pricingPath = join(tmp, "pricing.json");
  sessionsDir = join(tmp, "sessions");
  await writeFile(
    pricingPath,
    JSON.stringify({
      schema_version: "1.0",
      as_of: "2026-05-19",
      source: "test fixture",
      currency: "USD",
      models: {
        "claude-opus-4-7": {
          input_per_mtok: 15,
          output_per_mtok: 75,
          cache_write_5m_per_mtok: 18.75,
          cache_write_1h_per_mtok: 30,
          cache_read_per_mtok: 1.5,
        },
      },
    }),
    "utf8",
  );
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

async function withServer<T>(
  fn: (handle: ServerHandle) => Promise<T>,
): Promise<T> {
  const handle = await startServer({
    port: 0, // ephemeral
    pricingFile: pricingPath,
    subscriptionDailyUsd: 6.67,
    dailyStreakThresholdUsd: 50,
    sessionsDir,
  });
  try {
    return await fn(handle);
  } finally {
    await handle.close();
  }
}

function urlOf(handle: ServerHandle): string {
  const addr = handle.server.address();
  if (addr === null || typeof addr === "string") {
    throw new Error("server address unavailable");
  }
  return `http://127.0.0.1:${String(addr.port)}`;
}

describe("server HTTP endpoints", () => {
  it("redirects / to /overlay", async () => {
    await withServer(async (handle) => {
      const res = await fetch(`${urlOf(handle)}/`, { redirect: "manual" });
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/overlay");
    });
  });

  it("serves the overlay HTML at /overlay", async () => {
    await withServer(async (handle) => {
      const res = await fetch(`${urlOf(handle)}/overlay`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/html");
      const body = await res.text();
      expect(body).toContain("ParallelBurn");
      expect(body).toContain("EventSource");
    });
  });

  it("overlay HTML exposes the element IDs the live updater targets", async () => {
    // The live updater (inline script in the overlay) targets specific element
    // IDs via getElementById. Renaming or removing any of these IDs silently
    // breaks the overlay without breaking the build. This pins them.
    await withServer(async (handle) => {
      const res = await fetch(`${urlOf(handle)}/overlay`);
      const body = await res.text();
      // cache-hit replaced subsidy in the overlay header row.
      expect(body).toContain('id="cache-hit"');
      // wall/span collapse logic toggles row-span display and rewrites
      // wall-label depending on whether wall and span agree.
      expect(body).toContain('id="row-wall"');
      expect(body).toContain('id="row-span"');
      expect(body).toContain('id="wall-label"');
      expect(body).toContain('id="wall"');
      expect(body).toContain('id="span"');
    });
  });

  it("returns JSON at /api/today with the live snapshot shape", async () => {
    await withServer(async (handle) => {
      const res = await fetch(`${urlOf(handle)}/api/today`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("application/json");
      const snap = (await res.json()) as Record<string, unknown>;
      expect(typeof snap["date"]).toBe("string");
      expect(snap["aggregate"]).toBeDefined();
      expect(typeof snap["streak"]).toBe("number");
      expect(typeof snap["pricingAsOf"]).toBe("string");
      expect(typeof snap["pricingStale"]).toBe("boolean");
      // Live-snapshot fields the overlay updater depends on. Regression guard
      // against accidental field removal during refactors.
      expect(typeof snap["computedAt"]).toBe("string");
      const agg = snap["aggregate"] as Record<string, unknown>;
      expect(typeof agg["cacheHitPercent"]).toBe("number");
      expect(typeof agg["spanMs"]).toBe("number");
      expect(typeof agg["wallClockWindowMs"]).toBe("number");
      expect(typeof agg["cacheDisciplineRatio"]).toBe("number");
    });
  });

  it("aliases /api/current to the same snapshot", async () => {
    await withServer(async (handle) => {
      const res = await fetch(`${urlOf(handle)}/api/current`);
      expect(res.status).toBe(200);
      const snap = (await res.json()) as { date: string };
      expect(typeof snap.date).toBe("string");
    });
  });

  it("returns 404 for unknown paths", async () => {
    await withServer(async (handle) => {
      const res = await fetch(`${urlOf(handle)}/does-not-exist`);
      expect(res.status).toBe(404);
    });
  });

  it("/events sends an SSE message on connect", async () => {
    await withServer(async (handle) => {
      const res = await fetch(`${urlOf(handle)}/events`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/event-stream");
      const body = res.body;
      if (body === null) throw new Error("no body");
      const reader: ReadableStreamDefaultReader<Uint8Array> = body.getReader();
      let buf = "";
      const decoder = new TextDecoder();
      const deadline = Date.now() + 5000;
      while (!buf.includes("data:") && Date.now() < deadline) {
        const result = await reader.read();
        if (result.done) break;
        buf += decoder.decode(result.value, { stream: true });
      }
      expect(buf).toContain("data:");
      void reader.cancel();
    });
  });

  it("rejects /api/day without a date query parameter", async () => {
    await withServer(async (handle) => {
      const res = await fetch(`${urlOf(handle)}/api/day`);
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error?: string };
      expect(body.error).toMatch(/date/i);
    });
  });

  it("rejects /api/day with a malformed date", async () => {
    await withServer(async (handle) => {
      const res = await fetch(`${urlOf(handle)}/api/day?date=not-a-date`);
      expect(res.status).toBe(400);
    });
  });

  it("returns a well-formed aggregate for /api/day?date=YYYY-MM-DD", async () => {
    await withServer(async (handle) => {
      const res = await fetch(`${urlOf(handle)}/api/day?date=2020-01-01`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("application/json");
      const body = (await res.json()) as {
        date: string;
        aggregate: { date: string; sessions: unknown[]; totalCostUsd: number };
        pricingAsOf: string;
        pricingStale: boolean;
        computedAt: string;
      };
      expect(body.date).toBe("2020-01-01");
      expect(body.aggregate.date).toBe("2020-01-01");
      expect(body.aggregate.sessions).toEqual([]);
      expect(body.aggregate.totalCostUsd).toBe(0);
      expect(body.pricingAsOf).toBe("2026-05-19");
      expect(typeof body.computedAt).toBe("string");
    });
  });

  it("binds to 127.0.0.1 only (security: not 0.0.0.0)", async () => {
    await withServer((handle) => {
      const addr = handle.server.address();
      if (addr === null || typeof addr === "string") {
        throw new Error("no address");
      }
      expect(addr.address).toBe("127.0.0.1");
      return Promise.resolve();
    });
  });
});
