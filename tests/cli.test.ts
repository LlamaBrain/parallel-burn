import { describe, expect, it } from "vitest";

import {
  renderParallelBurnReport,
  type ParallelBurnSnapshot,
} from "../src/cli/parallel-burn.js";
import { renderStreakReport, type StreakSnapshot } from "../src/cli/streak.js";
import {
  renderStatusline,
  type StatuslineInputs,
} from "../src/cli/statusline.js";
import {
  makeProjectId,
  makeSessionId,
} from "../src/core/ids.js";
import type {
  DailyAggregate,
  SessionAggregate,
} from "../src/core/aggregator.js";

function exampleSession(args: {
  id: string;
  project: string;
  cost: number;
  startedAt?: string;
  endedAt?: string | null;
  in?: number;
  out?: number;
  read?: number;
  write?: number;
}): SessionAggregate {
  const start = args.startedAt ?? "2026-05-19T10:00:00Z";
  const end = args.endedAt ?? "2026-05-19T11:00:00Z";
  return {
    sessionId: makeSessionId(args.id),
    project: makeProjectId(args.project),
    model: "claude-opus-4-7",
    startedAt: start,
    endedAt: end,
    lastSeenActive: end ?? start,
    durationMs: Date.parse(end ?? start) - Date.parse(start),
    messageCount: 10,
    costUsd: args.cost,
    inputTokens: args.in ?? 0,
    outputTokens: args.out ?? 0,
    cacheReadTokens: args.read ?? 0,
    cacheWriteTokens: args.write ?? 0,
    unknownModel: false,
  };
}

function exampleAggregate(sessions: SessionAggregate[]): DailyAggregate {
  const sessionContextMs = sessions.reduce((a, s) => a + s.durationMs, 0);
  return {
    date: "2026-05-19",
    sessions,
    byProject: sessions.map((s) => ({
      project: s.project,
      durationMs: s.durationMs,
      costUsd: s.costUsd,
      sessionCount: 1,
    })),
    sessionContextMs,
    wallClockWindowMs: sessionContextMs > 0 ? sessionContextMs / 2 : 0,
    compressionRatio: sessions.length > 0 ? 2 : 0,
    totalCostUsd: sessions.reduce((a, s) => a + s.costUsd, 0),
    inputTokens: sessions.reduce((a, s) => a + s.inputTokens, 0),
    outputTokens: sessions.reduce((a, s) => a + s.outputTokens, 0),
    cacheReadTokens: sessions.reduce((a, s) => a + s.cacheReadTokens, 0),
    cacheWriteTokens: sessions.reduce((a, s) => a + s.cacheWriteTokens, 0),
    cacheDisciplineRatio: 10,
  };
}

describe("renderParallelBurnReport", () => {
  it("renders an empty-day note when no sessions are present", () => {
    const snap: ParallelBurnSnapshot = {
      date: "2026-05-19",
      aggregate: exampleAggregate([]),
      pricingAsOf: "2026-05-19",
      pricingStale: false,
    };
    const out = renderParallelBurnReport(snap);
    expect(out).toContain("● ParallelBurn — 2026-05-19");
    expect(out).toContain("No sessions recorded yet today");
    expect(out).toContain("pricing.json as_of 2026-05-19");
    expect(out).not.toContain("STALE");
  });

  it("leads with parallelism, not dollars (the spec mandate)", () => {
    const snap: ParallelBurnSnapshot = {
      date: "2026-05-19",
      aggregate: exampleAggregate([
        exampleSession({ id: "a", project: "parallel-burn", cost: 50 }),
        exampleSession({ id: "b", project: "parallel-burn", cost: 25 }),
      ]),
      pricingAsOf: "2026-05-19",
      pricingStale: false,
    };
    const out = renderParallelBurnReport(snap);
    const headlineLine = out.split("\n").find((l) => l.includes("parallelism multiplier")) ?? "";
    const parIdx = headlineLine.indexOf("parallelism");
    const dollarIdx = headlineLine.indexOf("$");
    expect(parIdx).toBeGreaterThan(-1);
    expect(dollarIdx).toBeGreaterThan(parIdx);
  });

  it("flags stale pricing in the footer", () => {
    const snap: ParallelBurnSnapshot = {
      date: "2026-05-19",
      aggregate: exampleAggregate([
        exampleSession({ id: "a", project: "parallel-burn", cost: 5 }),
      ]),
      pricingAsOf: "2025-12-01",
      pricingStale: true,
    };
    const out = renderParallelBurnReport(snap);
    expect(out).toContain("STALE");
  });

  it("renders a per-project rollup", () => {
    const snap: ParallelBurnSnapshot = {
      date: "2026-05-19",
      aggregate: exampleAggregate([
        exampleSession({ id: "a", project: "parallel-burn", cost: 50 }),
        exampleSession({ id: "b", project: "other-project", cost: 25 }),
      ]),
      pricingAsOf: "2026-05-19",
      pricingStale: false,
    };
    const out = renderParallelBurnReport(snap);
    expect(out).toContain("By Project");
    expect(out).toContain("parallel-burn");
    expect(out).toContain("other-project");
  });

  it("includes a closing interpretation line", () => {
    const high = renderParallelBurnReport({
      date: "2026-05-19",
      aggregate: {
        ...exampleAggregate([
          exampleSession({ id: "a", project: "p", cost: 5 }),
        ]),
        compressionRatio: 5.2,
      },
      pricingAsOf: "2026-05-19",
      pricingStale: false,
    });
    expect(high).toContain("heavy parallel work");

    const mid = renderParallelBurnReport({
      date: "2026-05-19",
      aggregate: {
        ...exampleAggregate([
          exampleSession({ id: "a", project: "p", cost: 5 }),
        ]),
        compressionRatio: 2.5,
      },
      pricingAsOf: "2026-05-19",
      pricingStale: false,
    });
    expect(mid).toContain("comfortably parallel");

    const low = renderParallelBurnReport({
      date: "2026-05-19",
      aggregate: {
        ...exampleAggregate([
          exampleSession({ id: "a", project: "p", cost: 5 }),
        ]),
        compressionRatio: 1.2,
      },
      pricingAsOf: "2026-05-19",
      pricingStale: false,
    });
    expect(low).toContain("some overlap");

    const serial = renderParallelBurnReport({
      date: "2026-05-19",
      aggregate: {
        ...exampleAggregate([
          exampleSession({ id: "a", project: "p", cost: 5 }),
        ]),
        compressionRatio: 1.0,
      },
      pricingAsOf: "2026-05-19",
      pricingStale: false,
    });
    expect(serial).toContain("Strictly serial");
  });
});

describe("renderStreakReport", () => {
  it("shows today's cost when streak is 0", () => {
    const snap: StreakSnapshot = {
      today: "2026-05-19",
      dailyCostUsd: new Map([["2026-05-19", 10]]),
      thresholdUsd: 50,
      windowDays: 5,
    };
    const out = renderStreakReport(snap);
    expect(out).toContain("0 days at or above $50.00");
    expect(out).toContain("(Today is $10.00 so far.)");
  });

  it("counts a multi-day streak and labels qualifying days", () => {
    const snap: StreakSnapshot = {
      today: "2026-05-19",
      dailyCostUsd: new Map([
        ["2026-05-19", 75],
        ["2026-05-18", 60],
        ["2026-05-17", 51],
      ]),
      thresholdUsd: 50,
      windowDays: 3,
    };
    const out = renderStreakReport(snap);
    expect(out).toContain("3 days at or above $50.00");
    expect(out).toMatch(/yes/);
  });

  it("uses singular 'day' for streak of 1", () => {
    const snap: StreakSnapshot = {
      today: "2026-05-19",
      dailyCostUsd: new Map([["2026-05-19", 60]]),
      thresholdUsd: 50,
      windowDays: 1,
    };
    const out = renderStreakReport(snap);
    expect(out).toContain("1 day at or above");
  });
});

describe("renderStatusline", () => {
  it("leads with parallelism, then dollars, then streak", () => {
    const inputs: StatuslineInputs = {
      today: "2026-05-19",
      sessions: [
        exampleSession({
          id: "a",
          project: "parallel-burn",
          cost: 60,
          startedAt: "2026-05-19T10:00:00Z",
          endedAt: "2026-05-19T11:00:00Z",
        }),
        exampleSession({
          id: "b",
          project: "parallel-burn",
          cost: 30,
          startedAt: "2026-05-19T10:30:00Z",
          endedAt: "2026-05-19T11:30:00Z",
        }),
      ],
      dailyCostUsd: new Map([["2026-05-19", 90]]),
      thresholdUsd: 50,
      pricingStale: false,
    };
    const out = renderStatusline(inputs);
    // Strip ANSI color codes for the order check.
    // eslint-disable-next-line no-control-regex
    const plain = out.replace(/\[[0-9;]*m/g, "");
    const parIdx = plain.indexOf("parallel");
    const dollarIdx = plain.indexOf("$");
    const streakIdx = plain.indexOf("streak");
    expect(parIdx).toBeGreaterThan(-1);
    expect(dollarIdx).toBeGreaterThan(parIdx);
    expect(streakIdx).toBeGreaterThan(dollarIdx);
    expect(plain).toContain("$90.00 today");
    expect(plain).toContain("streak 1d");
  });

  it("filters non-today sessions out of the parallelism calc", () => {
    const inputs: StatuslineInputs = {
      today: "2026-05-19",
      sessions: [
        exampleSession({
          id: "today",
          project: "p",
          cost: 10,
          startedAt: "2026-05-19T10:00:00Z",
          endedAt: "2026-05-19T11:00:00Z",
        }),
        exampleSession({
          id: "yesterday",
          project: "p",
          cost: 999,
          startedAt: "2026-05-18T10:00:00Z",
          endedAt: "2026-05-18T11:00:00Z",
        }),
      ],
      dailyCostUsd: new Map([
        ["2026-05-19", 10],
        ["2026-05-18", 999],
      ]),
      thresholdUsd: 50,
      pricingStale: false,
    };
    const out = renderStatusline(inputs);
    // eslint-disable-next-line no-control-regex
    const plain = out.replace(/\[[0-9;]*m/g, "");
    expect(plain).toContain("$10.00 today");
  });

  it("appends a stale-pricing tag when applicable", () => {
    const inputs: StatuslineInputs = {
      today: "2026-05-19",
      sessions: [],
      dailyCostUsd: new Map(),
      thresholdUsd: 50,
      pricingStale: true,
    };
    const out = renderStatusline(inputs);
    expect(out).toContain("pricing stale");
  });
});
