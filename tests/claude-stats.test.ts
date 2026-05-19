import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  computeActiveStreak,
  computeLongestActiveStreak,
  defaultStatsCachePath,
  parseStatsCache,
  readStatsCache,
  type DailyActivity,
} from "../src/core/claude-stats.js";

const VALID_CACHE = {
  version: 3,
  lastComputedDate: "2026-05-18",
  firstSessionDate: "2025-12-28T21:59:52.462Z",
  totalSessions: 4544,
  totalMessages: 497573,
  dailyActivity: [
    { date: "2026-05-18", sessionCount: 86, messageCount: 10783, toolCallCount: 2593 },
    { date: "2026-05-17", sessionCount: 50, messageCount: 1000, toolCallCount: 200 },
    { date: "2026-05-16", sessionCount: 30, messageCount: 500, toolCallCount: 100 },
  ],
  dailyModelTokens: [
    { date: "2026-05-18", tokensByModel: { "claude-opus-4-7": 5_000_000 } },
  ],
};

describe("parseStatsCache", () => {
  it("accepts a well-formed cache", () => {
    const c = parseStatsCache(VALID_CACHE);
    expect(c).not.toBeNull();
    expect(c?.version).toBe(3);
    expect(c?.lastComputedDate).toBe("2026-05-18");
    expect(c?.dailyActivity).toHaveLength(3);
    expect(c?.totalSessions).toBe(4544);
  });

  it("rejects non-object inputs", () => {
    expect(parseStatsCache(null)).toBeNull();
    expect(parseStatsCache("string")).toBeNull();
    expect(parseStatsCache([])).toBeNull();
  });

  it("rejects unsupported schema versions", () => {
    expect(parseStatsCache({ ...VALID_CACHE, version: 99 })).toBeNull();
    expect(parseStatsCache({ ...VALID_CACHE, version: "3" })).toBeNull();
  });

  it("rejects missing or non-string lastComputedDate / firstSessionDate", () => {
    expect(parseStatsCache({ ...VALID_CACHE, lastComputedDate: 42 })).toBeNull();
    expect(parseStatsCache({ ...VALID_CACHE, firstSessionDate: undefined })).toBeNull();
  });

  it("defaults totalSessions / totalMessages to 0 when missing", () => {
    const noCounts = { ...VALID_CACHE };
    delete (noCounts as { totalSessions?: number }).totalSessions;
    delete (noCounts as { totalMessages?: number }).totalMessages;
    const c = parseStatsCache(noCounts);
    expect(c?.totalSessions).toBe(0);
    expect(c?.totalMessages).toBe(0);
  });

  it("skips malformed dailyActivity entries", () => {
    const c = parseStatsCache({
      ...VALID_CACHE,
      dailyActivity: [
        { date: "2026-05-18", sessionCount: 5, messageCount: 10, toolCallCount: 3 },
        "garbage",
        { date: 42 }, // wrong type
        null,
        { date: "2026-05-17", sessionCount: 3 }, // partial — fills missing fields with 0
      ],
    });
    expect(c?.dailyActivity).toHaveLength(2);
    expect(c?.dailyActivity[1]?.messageCount).toBe(0);
    expect(c?.dailyActivity[1]?.toolCallCount).toBe(0);
  });

  it("filters non-numeric / negative token counts from dailyModelTokens", () => {
    const c = parseStatsCache({
      ...VALID_CACHE,
      dailyModelTokens: [
        {
          date: "2026-05-18",
          tokensByModel: { good: 100, neg: -1, nan: Number.NaN, str: "x", inf: Infinity },
        },
      ],
    });
    expect(c?.dailyModelTokens[0]?.tokensByModel).toEqual({ good: 100 });
  });
});

describe("readStatsCache", () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "parallel-burn-stats-cache-"));
  });
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it("returns null when the file is missing", async () => {
    const r = await readStatsCache(join(tmp, "absent.json"));
    expect(r).toBeNull();
  });

  it("returns the parsed cache when the file exists", async () => {
    const path = join(tmp, "stats.json");
    await writeFile(path, JSON.stringify(VALID_CACHE), "utf8");
    const r = await readStatsCache(path);
    expect(r?.version).toBe(3);
    expect(r?.totalSessions).toBe(4544);
  });
});

describe("defaultStatsCachePath", () => {
  it("returns a path ending in .claude/stats-cache.json", () => {
    const p = defaultStatsCachePath();
    expect(p.replaceAll("\\", "/")).toMatch(/\.claude\/stats-cache\.json$/);
  });
});

describe("computeActiveStreak", () => {
  function day(date: string, sessionCount: number): DailyActivity {
    return { date, sessionCount, messageCount: 0, toolCallCount: 0 };
  }

  it("returns 0 when no activity on today and override is false", () => {
    expect(computeActiveStreak("2026-05-19", [], false)).toBe(0);
  });

  it("returns 1 for a single active day (today, via override)", () => {
    expect(computeActiveStreak("2026-05-19", [], true)).toBe(1);
  });

  it("walks back through consecutive active days", () => {
    const activity = [
      day("2026-05-18", 5),
      day("2026-05-17", 3),
      day("2026-05-16", 1),
    ];
    expect(computeActiveStreak("2026-05-19", activity, true)).toBe(4);
  });

  it("breaks at a gap day (missing entry counts as 0)", () => {
    const activity = [
      day("2026-05-19", 5),
      // 2026-05-18 missing — gap
      day("2026-05-17", 3),
    ];
    expect(computeActiveStreak("2026-05-19", activity, false)).toBe(1);
  });

  it("breaks at a sessionCount: 0 entry", () => {
    const activity = [
      day("2026-05-19", 5),
      day("2026-05-18", 0),
      day("2026-05-17", 3),
    ];
    expect(computeActiveStreak("2026-05-19", activity, false)).toBe(1);
  });

  it("reproduces the observed 57-day streak shape", () => {
    // Build 57 consecutive active days ending on 2026-05-19 (today),
    // with the cache's lastComputedDate at 2026-05-18 (which is the
    // real-world configuration that prompted ADR-0006).
    const activity: DailyActivity[] = [];
    const MS_DAY = 86_400_000;
    const today = "2026-05-19";
    const yesterday = "2026-05-18";
    const startMs = Date.parse(yesterday + "T00:00:00Z");
    for (let i = 0; i < 56; i++) {
      const d = new Date(startMs - i * MS_DAY).toISOString().slice(0, 10);
      activity.push(day(d, 1));
    }
    expect(computeActiveStreak(today, activity, true)).toBe(57);
  });
});

describe("computeLongestActiveStreak", () => {
  function day(date: string, sessionCount: number): DailyActivity {
    return { date, sessionCount, messageCount: 0, toolCallCount: 0 };
  }

  it("returns 0 for empty input", () => {
    expect(computeLongestActiveStreak([])).toBe(0);
  });

  it("returns 1 for a single active day", () => {
    expect(computeLongestActiveStreak([day("2026-05-19", 1)])).toBe(1);
  });

  it("finds the longest among multiple separated runs", () => {
    const activity = [
      // Run A: 3 days
      day("2026-05-01", 1),
      day("2026-05-02", 1),
      day("2026-05-03", 1),
      // gap
      day("2026-05-10", 1),
      day("2026-05-11", 1),
      // Run B: 4 days, the longest
      day("2026-05-15", 1),
      day("2026-05-16", 1),
      day("2026-05-17", 1),
      day("2026-05-18", 1),
    ];
    expect(computeLongestActiveStreak(activity)).toBe(4);
  });

  it("ignores sessionCount: 0 days when scanning", () => {
    const activity = [
      day("2026-05-01", 1),
      day("2026-05-02", 0), // inactive
      day("2026-05-03", 1),
    ];
    expect(computeLongestActiveStreak(activity)).toBe(1);
  });

  it("extends longest by today when the override is set", () => {
    // Cache shows 56 days through yesterday; today's override adds one.
    const activity: DailyActivity[] = [];
    const MS_DAY = 86_400_000;
    const yesterday = "2026-05-18";
    const startMs = Date.parse(yesterday + "T00:00:00Z");
    for (let i = 0; i < 56; i++) {
      const d = new Date(startMs - i * MS_DAY).toISOString().slice(0, 10);
      activity.push(day(d, 1));
    }
    expect(computeLongestActiveStreak(activity)).toBe(56);
    expect(computeLongestActiveStreak(activity, "2026-05-19", true)).toBe(57);
  });
});
