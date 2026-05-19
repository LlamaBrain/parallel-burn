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
    // The opening line must contain the exact narrative phrases.
    expect(md).toContain("of session-context squeezed into");
    expect(md).toContain("parallelism multiplier");
    expect(md).toContain("list-price across");
    expect(md).toContain("Max-prorated daily");
    expect(md).toContain("Cache reads cleared");
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
    expect(md).toContain("5.0× the Max-prorated daily");
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
    expect(md).toContain("Pro-prorated daily");
  });

  it("renders a markdown table of sessions sorted by start time", () => {
    const md = renderSessionSummary({
      date: "2026-05-19",
      aggregate: aggregate([
        exampleSession({
          id: "later",
          project: "p",
          startedAt: "2026-05-19T11:00:00Z",
          endedAt: "2026-05-19T12:00:00Z",
          costUsd: 10,
        }),
        exampleSession({
          id: "earlier",
          project: "p",
          startedAt: "2026-05-19T09:00:00Z",
          endedAt: "2026-05-19T10:00:00Z",
          costUsd: 20,
        }),
      ]),
      subscriptionDailyUsd: 6.67,
    });
    const earlierIdx = md.indexOf("earlier");
    const laterIdx = md.indexOf("later");
    expect(earlierIdx).toBeGreaterThan(-1);
    expect(laterIdx).toBeGreaterThan(earlierIdx);
    expect(md).toContain("| Duration | Cost |");
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

  it("closes with an interpretation sentence keyed to compression ratio", () => {
    const heavy = renderSessionSummary({
      date: "2026-05-19",
      aggregate: aggregate(
        [
          exampleSession({
            id: "a",
            project: "p",
            startedAt: "2026-05-19T10:00:00Z",
            endedAt: "2026-05-19T11:00:00Z",
            costUsd: 5,
          }),
        ],
        5.2,
      ),
      subscriptionDailyUsd: 6.67,
    });
    expect(heavy).toContain("heavy parallel workday");

    const mid = renderSessionSummary({
      date: "2026-05-19",
      aggregate: aggregate(
        [
          exampleSession({
            id: "a",
            project: "p",
            startedAt: "2026-05-19T10:00:00Z",
            endedAt: "2026-05-19T11:00:00Z",
            costUsd: 5,
          }),
        ],
        2.5,
      ),
      subscriptionDailyUsd: 6.67,
    });
    expect(mid).toContain("comfortably parallel");

    const low = renderSessionSummary({
      date: "2026-05-19",
      aggregate: aggregate(
        [
          exampleSession({
            id: "a",
            project: "p",
            startedAt: "2026-05-19T10:00:00Z",
            endedAt: "2026-05-19T11:00:00Z",
            costUsd: 5,
          }),
        ],
        1.2,
      ),
      subscriptionDailyUsd: 6.67,
    });
    expect(low).toContain("some overlap");

    const serial = renderSessionSummary({
      date: "2026-05-19",
      aggregate: aggregate(
        [
          exampleSession({
            id: "a",
            project: "p",
            startedAt: "2026-05-19T10:00:00Z",
            endedAt: "2026-05-19T11:00:00Z",
            costUsd: 5,
          }),
        ],
        1.0,
      ),
      subscriptionDailyUsd: 6.67,
    });
    expect(serial).toContain("Strictly serial day");
  });

  it("emits a sensible token-mix description", () => {
    const md = renderSessionSummary({
      date: "2026-05-19",
      aggregate: aggregate([
        exampleSession({
          id: "a",
          project: "p",
          startedAt: "2026-05-19T10:00:00Z",
          endedAt: "2026-05-19T11:00:00Z",
          costUsd: 1,
          inputTokens: 100,
          outputTokens: 200,
          cacheReadTokens: 600,
          cacheWriteTokens: 100,
        }),
      ]),
      subscriptionDailyUsd: 6.67,
    });
    expect(md).toMatch(/~\d+% output, ~\d+% cache/);
  });

  it("handles zero-token sessions without dividing by zero", () => {
    const md = renderSessionSummary({
      date: "2026-05-19",
      aggregate: aggregate([
        exampleSession({
          id: "a",
          project: "p",
          startedAt: "2026-05-19T10:00:00Z",
          endedAt: "2026-05-19T11:00:00Z",
          costUsd: 0,
        }),
      ]),
      subscriptionDailyUsd: 6.67,
    });
    expect(md).toContain("no measured tokens");
  });

  it("uses fallback subsidy display when subscription_daily_usd is 0", () => {
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
    expect(md).toContain("— the Max-prorated daily");
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
