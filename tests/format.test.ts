import { describe, expect, it } from "vitest";

import {
  formatCount,
  formatDuration,
  formatRatio,
  formatUsd,
  renderTable,
  truncate,
  type ColumnSpec,
} from "../src/cli/format.js";

describe("formatDuration", () => {
  it("returns 0m for zero or negative", () => {
    expect(formatDuration(0)).toBe("0m");
    expect(formatDuration(-1)).toBe("0m");
    expect(formatDuration(Number.NaN)).toBe("0m");
  });

  it("returns seconds when under one minute", () => {
    expect(formatDuration(30_000)).toBe("30s");
  });

  it("returns minutes when under one hour", () => {
    expect(formatDuration(15 * 60 * 1000)).toBe("15m");
  });

  it("returns hours and minutes when over one hour", () => {
    expect(formatDuration(3 * 60 * 60 * 1000 + 25 * 60 * 1000)).toBe("3h 25m");
  });

  it("returns Xh 0m at exact hour boundaries", () => {
    expect(formatDuration(2 * 60 * 60 * 1000)).toBe("2h 0m");
  });
});

describe("formatUsd", () => {
  it("formats with two decimals", () => {
    expect(formatUsd(1)).toBe("$1.00");
    expect(formatUsd(12.345)).toBe("$12.35");
    expect(formatUsd(0)).toBe("$0.00");
  });

  it("handles negative and non-finite", () => {
    expect(formatUsd(-1.5)).toBe("$-1.50");
    expect(formatUsd(Number.NaN)).toBe("$—");
    expect(formatUsd(Number.POSITIVE_INFINITY)).toBe("$—");
  });
});

describe("formatCount", () => {
  it("uses thousands separators", () => {
    expect(formatCount(1_234_567)).toBe("1,234,567");
    expect(formatCount(42)).toBe("42");
  });

  it("rounds non-integers", () => {
    expect(formatCount(12.4)).toBe("12");
    expect(formatCount(12.6)).toBe("13");
  });

  it("returns dash for non-finite", () => {
    expect(formatCount(Number.NaN)).toBe("—");
    expect(formatCount(Number.POSITIVE_INFINITY)).toBe("—");
  });
});

describe("formatRatio", () => {
  it("formats with one decimal and a trailing ×", () => {
    expect(formatRatio(1)).toBe("1.0×");
    expect(formatRatio(4.12)).toBe("4.1×");
    expect(formatRatio(4.16)).toBe("4.2×");
  });

  it("returns dash for zero, negative, and non-finite", () => {
    expect(formatRatio(0)).toBe("—");
    expect(formatRatio(-1)).toBe("—");
    expect(formatRatio(Number.NaN)).toBe("—");
  });
});

describe("truncate", () => {
  it("returns the input unchanged when under or equal to max", () => {
    expect(truncate("hi", 5)).toBe("hi");
    expect(truncate("hello", 5)).toBe("hello");
  });

  it("truncates with an ellipsis", () => {
    expect(truncate("the-quick-brown-fox", 10)).toBe("the-quick…");
  });

  it("returns just an ellipsis when max <= 1", () => {
    expect(truncate("abc", 1)).toBe("…");
    expect(truncate("abc", 0)).toBe("…");
  });
});

describe("renderTable", () => {
  it("returns empty string for no columns", () => {
    expect(renderTable([], [])).toBe("");
  });

  it("renders header + separator + rows with auto-sized columns", () => {
    const cols: ColumnSpec[] = [
      { header: "name", align: "left" },
      { header: "qty", align: "right" },
    ];
    const out = renderTable(cols, [
      ["apple", "12"],
      ["bananas", "345"],
    ]);
    const lines = out.split("\n");
    expect(lines).toHaveLength(4);
    expect(lines[0]).toBe("name     qty");
    expect(lines[1]).toBe("-------  ---");
    expect(lines[2]).toBe("apple     12");
    expect(lines[3]).toBe("bananas  345");
  });

  it("aligns right-columns right", () => {
    const cols: ColumnSpec[] = [{ header: "n", align: "right" }];
    const out = renderTable(cols, [["1"], ["12"], ["123"]]);
    const lines = out.split("\n");
    expect(lines[2]).toBe("  1");
    expect(lines[3]).toBe(" 12");
    expect(lines[4]).toBe("123");
  });

  it("handles missing cells gracefully", () => {
    const cols: ColumnSpec[] = [
      { header: "a", align: "left" },
      { header: "b", align: "left" },
    ];
    const out = renderTable(cols, [["x"]]); // row missing second cell
    const lines = out.split("\n");
    expect(lines[2]).toBe("x");
  });

  it("strips trailing whitespace from each row (right-aligned rows excepted)", () => {
    const cols: ColumnSpec[] = [
      { header: "a", align: "left" },
      { header: "b", align: "left" },
    ];
    const out = renderTable(cols, [["x", "y"]]);
    for (const line of out.split("\n")) {
      expect(line).not.toMatch(/\s$/);
    }
  });
});
