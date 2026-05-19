import { describe, expect, it } from "vitest";

import type {
  DailyAggregate,
  SessionAggregate,
} from "../src/core/aggregator.js";
import {
  makeProjectId,
  makeSessionId,
} from "../src/core/ids.js";
import {
  renderSessionSummary,
  summaryFilename,
} from "../src/core/summary.js";

function exampleSession(args: {
  id: string;
  project: string;
  startedAt: string;
  endedAt: string;
  costUsd: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}): SessionAggregate {
  return {
    sessionId: makeSessionId(args.id),
    project: makeProjectId(args.project),
    model: "claude-opus-4-7",
    startedAt: args.startedAt,
    endedAt: args.endedAt,
    lastSeenActive: args.endedAt,
    durationMs: Date.parse(args.endedAt) - Date.parse(args.startedAt),
    messageCount: 1,
    costUsd: args.costUsd,
    inputTokens: args.inputTokens ?? 0,
    outputTokens: args.outputTokens ?? 0,
    cacheReadTokens: args.cacheReadTokens ?? 0,
    cacheWriteTokens: args.cacheWriteTokens ?? 0,
    unknownModel: false,
  };
}

function aggregate(sessions: SessionAggregate[], compressionRatio = 2): DailyAggregate {
  return {
    date: "2026-05-19",
    sessions,
    byProject: Array.from(
      sessions.reduce((acc, s) => {
        const cur = acc.get(s.project) ?? { durationMs: 0, costUsd: 0, sessionCount: 0 };
        cur.durationMs += s.durationMs;
        cur.costUsd += s.costUsd;
        cur.sessionCount += 1;
        acc.set(s.project, cur);
        return acc;
      }, new Map<string, { durationMs: number; costUsd: number; sessionCount: number }>()),
    )
      .map(([project, agg]) => ({ project: makeProjectId(project), ...agg }))
      .sort((a, b) => b.costUsd - a.costUsd),
    sessionContextMs: sessions.reduce((acc, s) => acc + s.durationMs, 0),
    wallClockWindowMs:
      sessions.length > 0
        ? sessions.reduce((acc, s) => acc + s.durationMs, 0) / compressionRatio
        : 0,
    compressionRatio,
    totalCostUsd: sessions.reduce((acc, s) => acc + s.costUsd, 0),
    inputTokens: sessions.reduce((acc, s) => acc + s.inputTokens, 0),
    outputTokens: sessions.reduce((acc, s) => acc + s.outputTokens, 0),
    cacheReadTokens: sessions.reduce((acc, s) => acc + s.cacheReadTokens, 0),
    cacheWriteTokens: sessions.reduce((acc, s) => acc + s.cacheWriteTokens, 0),
    cacheDisciplineRatio: 10,
  };
}

describe("renderSessionSummary", () => {
  it("renders an empty-day note for no sessions", () => {
    const md = renderSessionSummary({
      date: "2026-05-19",
      aggregate: aggregate([]),
      subscriptionDailyUsd: 6.67,
    });
    expect(md).toContain("● Session Summary for 2026-05-19");
    expect(md).toContain("No sessions recorded for this date.");
  });

  it("leads with the SPEC §7.3 narrative shape", () => {
    const md = renderSessionSummary({
      date: "2026-05-19",
      aggregate: aggregate([
        exampleSession({
          id: "a",
          project: "parallel-burn",
          startedAt: "2026-05-19T10:00:00Z",
          endedAt: "2026-05-19T11:00:00Z",
          costUsd: 75,
        }),
      ]),
      subscriptionDailyUsd: 6.67,
    });
    expect(md).toContain("of session-context compressed into");
    expect(md).toContain("parallelism multiplier");
    expect(md).toContain("daily prorated Max subscription");
    expect(md).toContain("cache reads doing most of the actual labor");
  });

  it("computes subsidy multiplier against the supplied subscription rate", () => {
    const md = renderSessionSummary({
      date: "2026-05-19",
      aggregate: aggregate([
        exampleSession({
          id: "a",
          project: "p",
          startedAt: "2026-05-19T10:00:00Z",
          endedAt: "2026-05-19T11:00:00Z",
          costUsd: 33.35, // 5× $6.67
        }),
      ]),
      subscriptionDailyUsd: 6.67,
    });
    expect(md).toContain("5× the daily prorated Max subscription");
  });

  it("uses a custom plan label when supplied", () => {
    const md = renderSessionSummary({
      date: "2026-05-19",
      aggregate: aggregate([
        exampleSession({
          id: "a",
          project: "p",
          startedAt: "2026-05-19T10:00:00Z",
          endedAt: "2026-05-19T11:00:00Z",
          costUsd: 5,
        }),
      ]),
      subscriptionDailyUsd: 0.67,
      planLabel: "Pro",
    });
    expect(md).toContain("daily prorated Pro subscription");
  });

  it("renders a box-drawing session table sorted by cost desc", () => {
    // The session-table column shows the last 8 chars of each session ID.
    const md = renderSessionSummary({
      date: "2026-05-19",
      aggregate: aggregate([
        exampleSession({
          id: "session-cheaplate",
          project: "p",
          startedAt: "2026-05-19T11:00:00Z",
          endedAt: "2026-05-19T12:00:00Z",
          costUsd: 10,
        }),
        exampleSession({
          id: "session-bigearly",
          project: "p",
          startedAt: "2026-05-19T09:00:00Z",
          endedAt: "2026-05-19T10:00:00Z",
          costUsd: 20,
        }),
      ]),
      subscriptionDailyUsd: 6.67,
    });
    // shortSession returns the LAST 8 chars of the session id.
    const bigIdx = md.indexOf("bigearly"); // last 8 of "session-bigearly"
    const cheapIdx = md.indexOf("heaplate"); // last 8 of "session-cheaplate"
    expect(bigIdx).toBeGreaterThan(-1);
    expect(cheapIdx).toBeGreaterThan(bigIdx);
    expect(md).toContain("┌");
    expect(md).toContain("│ Duration │");
    expect(md).toContain("└");
  });

  it("renders a per-project rollup section", () => {
    const md = renderSessionSummary({
      date: "2026-05-19",
      aggregate: aggregate([
        exampleSession({
          id: "a",
          project: "parallel-burn",
          startedAt: "2026-05-19T09:00:00Z",
          endedAt: "2026-05-19T10:00:00Z",
          costUsd: 50,
        }),
        exampleSession({
          id: "b",
          project: "other",
          startedAt: "2026-05-19T11:00:00Z",
          endedAt: "2026-05-19T12:00:00Z",
          costUsd: 20,
        }),
      ]),
      subscriptionDailyUsd: 6.67,
    });
    expect(md).toContain("By Project");
    expect(md).toContain("- parallel-burn:");
    expect(md).toContain("- other:");
  });

  it("closes with a tokens line including cache rate and the punchline", () => {
    const md = renderSessionSummary({
      date: "2026-05-19",
      aggregate: aggregate([
        exampleSession({
          id: "a",
          project: "p",
          startedAt: "2026-05-19T10:00:00Z",
          endedAt: "2026-05-19T11:00:00Z",
          costUsd: 5,
          inputTokens: 100,
          outputTokens: 200,
          cacheReadTokens: 600,
          cacheWriteTokens: 60,
        }),
      ]),
      subscriptionDailyUsd: 6.67,
    });
    expect(md).toContain("Tokens:");
    expect(md).toContain(" in / ");
    expect(md).toContain(" out / ");
    expect(md).toContain("cache writes");
    expect(md).toContain("cache reads");
    expect(md).toContain("× cache rate");
    expect(md).toContain("only reason this isn't a car payment");
  });

  it("falls back to 'no cache yet' when cache discipline is 0", () => {
    const md = renderSessionSummary({
      date: "2026-05-19",
      aggregate: {
        ...aggregate([
          exampleSession({
            id: "a",
            project: "p",
            startedAt: "2026-05-19T10:00:00Z",
            endedAt: "2026-05-19T11:00:00Z",
            costUsd: 0,
          }),
        ]),
        cacheDisciplineRatio: 0,
      },
      subscriptionDailyUsd: 6.67,
    });
    expect(md).toContain("no cache yet");
  });

  it("uses the fallback subsidy placeholder when subscription_daily_usd is 0", () => {
    const md = renderSessionSummary({
      date: "2026-05-19",
      aggregate: aggregate([
        exampleSession({
          id: "a",
          project: "p",
          startedAt: "2026-05-19T10:00:00Z",
          endedAt: "2026-05-19T11:00:00Z",
          costUsd: 5,
        }),
      ]),
      subscriptionDailyUsd: 0,
    });
    expect(md).toContain("— the daily prorated");
  });

  it("describes a single-stretch day when span ≈ wall", () => {
    const md = renderSessionSummary({
      date: "2026-05-19",
      aggregate: {
        ...aggregate([
          exampleSession({
            id: "a",
            project: "p",
            startedAt: "2026-05-19T10:00:00Z",
            endedAt: "2026-05-19T11:00:00Z",
            costUsd: 5,
          }),
        ]),
        sessionContextMs: 60 * 60 * 1000,
        wallClockWindowMs: 60 * 60 * 1000, // wall ≈ span
        compressionRatio: 1.0,
      },
      subscriptionDailyUsd: 6.67,
    });
    expect(md).toContain("lined up almost perfectly");
  });

  it("describes meaningful idle stretches when span ≫ wall", () => {
    const md = renderSessionSummary({
      date: "2026-05-19",
      aggregate: {
        ...aggregate([
          exampleSession({
            id: "early",
            project: "p",
            startedAt: "2026-05-19T09:00:00Z",
            endedAt: "2026-05-19T10:00:00Z",
            costUsd: 5,
          }),
          exampleSession({
            id: "late",
            project: "p",
            startedAt: "2026-05-19T15:00:00Z",
            endedAt: "2026-05-19T16:00:00Z",
            costUsd: 5,
          }),
        ]),
        sessionContextMs: 2 * 60 * 60 * 1000,
        wallClockWindowMs: 2 * 60 * 60 * 1000, // 2h merged
        // span 9-16 = 7h, wall 2h → big gap
      },
      subscriptionDailyUsd: 6.67,
    });
    expect(md).toContain("idle stretches");
  });
});

describe("summaryFilename", () => {
  it("produces YYYY-MM-DD-HHMM.md in UTC", () => {
    expect(summaryFilename(new Date("2026-05-19T09:42:00.000Z"))).toBe(
      "2026-05-19-0942.md",
    );
  });

  it("pads single-digit hour and minute", () => {
    expect(summaryFilename(new Date("2026-01-01T00:05:00.000Z"))).toBe(
      "2026-01-01-0005.md",
    );
  });
});
