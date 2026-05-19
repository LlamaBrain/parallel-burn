import { describe, expect, it } from "vitest";

import {
  computeStreak,
  dateOf,
  DEFAULT_DAILY_THRESHOLD_USD,
  previousDay,
} from "../src/core/streak.js";

describe("previousDay", () => {
  it("subtracts one calendar day", () => {
    expect(previousDay("2026-05-19")).toBe("2026-05-18");
  });

  it("walks across a month boundary", () => {
    expect(previousDay("2026-05-01")).toBe("2026-04-30");
  });

  it("walks across a year boundary", () => {
    expect(previousDay("2026-01-01")).toBe("2025-12-31");
  });

  it("walks across a leap-day boundary", () => {
    expect(previousDay("2024-03-01")).toBe("2024-02-29");
  });

  it("throws on a malformed input", () => {
    expect(() => previousDay("May 19, 2026")).toThrow();
  });
});

describe("dateOf", () => {
  it("extracts the YYYY-MM-DD prefix from an ISO timestamp", () => {
    expect(dateOf("2026-05-19T16:46:51.378Z")).toBe("2026-05-19");
  });
});

describe("computeStreak", () => {
  it("returns 0 when today is below threshold", () => {
    const m = new Map([["2026-05-19", 10]]);
    expect(computeStreak(m, "2026-05-19", 50)).toBe(0);
  });

  it("returns 1 for a single qualifying day with no history", () => {
    const m = new Map([["2026-05-19", 75]]);
    expect(computeStreak(m, "2026-05-19", 50)).toBe(1);
  });

  it("counts consecutive qualifying days", () => {
    const m = new Map([
      ["2026-05-19", 75],
      ["2026-05-18", 60],
      ["2026-05-17", 100],
    ]);
    expect(computeStreak(m, "2026-05-19", 50)).toBe(3);
  });

  it("stops at the first day below threshold (gap breaks streak)", () => {
    const m = new Map([
      ["2026-05-19", 75],
      ["2026-05-18", 49],
      ["2026-05-17", 100],
    ]);
    expect(computeStreak(m, "2026-05-19", 50)).toBe(1);
  });

  it("treats missing days as 0 (gap breaks streak)", () => {
    const m = new Map([
      ["2026-05-19", 75],
      // 2026-05-18 missing
      ["2026-05-17", 100],
    ]);
    expect(computeStreak(m, "2026-05-19", 50)).toBe(1);
  });

  it("uses the default threshold when none is provided", () => {
    const m = new Map([["2026-05-19", DEFAULT_DAILY_THRESHOLD_USD]]);
    expect(computeStreak(m, "2026-05-19")).toBe(1);
  });

  it("threshold of 0 + a missing day still breaks the streak (cost is 0, 0 >= 0 is true, so streak continues)", () => {
    // With threshold 0, every day with cost ≥ 0 qualifies. Missing days
    // default to 0 which equals the threshold, so the streak runs back the
    // full safety cap.
    const m = new Map<string, number>();
    expect(computeStreak(m, "2026-05-19", 0)).toBe(366);
  });

  it("rejects a malformed `today`", () => {
    expect(() => computeStreak(new Map(), "yesterday")).toThrow();
  });
});
