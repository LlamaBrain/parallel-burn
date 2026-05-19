import { describe, expect, it } from "vitest";

import {
  compressionRatio,
  computeCompression,
  mergeIntervals,
  totalIntervalDurationMs,
  type Interval,
} from "../src/core/compression.js";

const M = (start: number, end: number): Interval => ({ start, end });

describe("mergeIntervals", () => {
  it("returns [] for empty input", () => {
    expect(mergeIntervals([])).toEqual([]);
  });

  it("returns a single interval unchanged", () => {
    expect(mergeIntervals([M(0, 10)])).toEqual([M(0, 10)]);
  });

  it("merges two overlapping intervals", () => {
    expect(mergeIntervals([M(0, 10), M(5, 15)])).toEqual([M(0, 15)]);
  });

  it("merges three back-to-back intervals into one", () => {
    expect(mergeIntervals([M(0, 5), M(5, 10), M(10, 15)])).toEqual([M(0, 15)]);
  });

  it("keeps strictly separated intervals separate", () => {
    expect(mergeIntervals([M(0, 5), M(10, 15)])).toEqual([M(0, 5), M(10, 15)]);
  });

  it("sorts unordered inputs before merging", () => {
    expect(mergeIntervals([M(10, 15), M(0, 5), M(5, 10)])).toEqual([M(0, 15)]);
  });

  it("handles a fully nested interval inside a larger one", () => {
    expect(mergeIntervals([M(0, 100), M(20, 30)])).toEqual([M(0, 100)]);
  });

  it("discards zero-duration intervals", () => {
    expect(mergeIntervals([M(0, 0), M(5, 10)])).toEqual([M(5, 10)]);
  });

  it("discards negative-duration intervals", () => {
    expect(mergeIntervals([M(10, 5)])).toEqual([]);
  });
});

describe("totalIntervalDurationMs", () => {
  it("sums positive intervals", () => {
    expect(totalIntervalDurationMs([M(0, 5), M(10, 30)])).toBe(25);
  });

  it("ignores zero and negative intervals", () => {
    expect(totalIntervalDurationMs([M(0, 0), M(10, 5), M(0, 1)])).toBe(1);
  });
});

describe("compressionRatio", () => {
  it("returns sessionContext / wallClock", () => {
    expect(compressionRatio(120, 60)).toBeCloseTo(2.0);
  });

  it("returns 0 when wallClock is 0 (avoid div by 0)", () => {
    expect(compressionRatio(0, 0)).toBe(0);
    expect(compressionRatio(100, 0)).toBe(0);
  });
});

describe("computeCompression", () => {
  it("strictly serial sessions yield ratio = 1", () => {
    const r = computeCompression([M(0, 100), M(100, 200), M(200, 300)]);
    expect(r.sessionContextMs).toBe(300);
    expect(r.wallClockWindowMs).toBe(300);
    expect(r.ratio).toBeCloseTo(1.0);
  });

  it("four fully-overlapping equal sessions yield ratio = 4", () => {
    const r = computeCompression([M(0, 100), M(0, 100), M(0, 100), M(0, 100)]);
    expect(r.sessionContextMs).toBe(400);
    expect(r.wallClockWindowMs).toBe(100);
    expect(r.ratio).toBeCloseTo(4.0);
  });

  it("partial overlap of two sessions", () => {
    // Session A: 0-100, Session B: 50-150.
    // session-context = 100 + 100 = 200.
    // merged          = 0-150 = 150.
    // ratio           = 200/150 = 1.333...
    const r = computeCompression([M(0, 100), M(50, 150)]);
    expect(r.sessionContextMs).toBe(200);
    expect(r.wallClockWindowMs).toBe(150);
    expect(r.ratio).toBeCloseTo(200 / 150);
  });

  it("uses merged-interval, NOT naive max(end) - min(start)", () => {
    // If we used naive first-to-last, gap windows would be counted.
    // Session A: 0-10, Session B: 50-60. Wall clock should be 20, not 60.
    const r = computeCompression([M(0, 10), M(50, 60)]);
    expect(r.sessionContextMs).toBe(20);
    expect(r.wallClockWindowMs).toBe(20);
    expect(r.ratio).toBeCloseTo(1.0);
  });

  it("returns zeroes for empty input", () => {
    const r = computeCompression([]);
    expect(r.sessionContextMs).toBe(0);
    expect(r.wallClockWindowMs).toBe(0);
    expect(r.ratio).toBe(0);
  });
});
