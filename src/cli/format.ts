// Terminal output helpers.
//
// Keeps SPEC.md §11 happy ("No framework dependencies for HTTP. Built-in
// node:http is sufficient. No Express, no Fastify, no Koa.") — by
// extension, no cli-table3 either. The table renderer is small, pure, and
// 100 %-covered, which is what we want for a hire-me artifact.
//
// All formatters are pure: `string` in, `string` out. No I/O. The CLI
// entry points handle stdout writes.

const COL_PADDING = 2;
const NUM_LOCALE = "en-US";

export type ColumnAlign = "left" | "right";

export type ColumnSpec = {
  readonly header: string;
  readonly align: ColumnAlign;
};

/**
 * Render a simple ASCII table. Numeric-looking columns can be right-aligned
 * via the column spec. Column widths are auto-sized from the longest value
 * (header included). No fancy borders — just header underlines.
 *
 * Format (3-col example):
 *
 *   col_a  col_b   col_c
 *   -----  -----  ------
 *   row1     12   apple
 *   row2    345   bananas
 */
export function renderTable(
  columns: readonly ColumnSpec[],
  rows: readonly (readonly string[])[],
): string {
  if (columns.length === 0) return "";
  const widths = columns.map((c, i) => {
    let w = c.header.length;
    for (const row of rows) {
      const cell = row[i] ?? "";
      if (cell.length > w) w = cell.length;
    }
    return w;
  });
  const pad = " ".repeat(COL_PADDING);
  const headerLine = columns
    .map((c, i) => alignCell(c.header, widths[i] ?? 0, c.align))
    .join(pad);
  const sepLine = columns
    .map((_, i) => "-".repeat(widths[i] ?? 0))
    .join(pad);
  const rowLines = rows.map((row) =>
    columns
      .map((c, i) => alignCell(row[i] ?? "", widths[i] ?? 0, c.align))
      .join(pad)
      .trimEnd(),
  );
  return [headerLine.trimEnd(), sepLine.trimEnd(), ...rowLines].join("\n");
}

function alignCell(text: string, width: number, align: ColumnAlign): string {
  const padding = Math.max(0, width - text.length);
  if (padding === 0) return text;
  return align === "right" ? " ".repeat(padding) + text : text + " ".repeat(padding);
}

const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;
const MS_PER_SECOND = 1000;

/**
 * Format a millisecond duration as `Xh Ym` (or `Ym Ws` if under one hour).
 * Used for compression ratio narratives and the per-session column.
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0m";
  const totalSeconds = Math.floor(ms / MS_PER_SECOND);
  const hours = Math.floor(totalSeconds / SECONDS_PER_HOUR);
  const minutes = Math.floor((totalSeconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
  if (hours === 0) {
    if (minutes === 0) {
      const seconds = totalSeconds % SECONDS_PER_MINUTE;
      return `${String(seconds)}s`;
    }
    return `${String(minutes)}m`;
  }
  return `${String(hours)}h ${String(minutes)}m`;
}

/**
 * Format USD as `$X.YZ` with two decimals.
 */
export function formatUsd(usd: number): string {
  if (!Number.isFinite(usd)) return "$—";
  return `$${usd.toFixed(2)}`;
}

/**
 * Format a count with thousands separators (`12,345`).
 */
export function formatCount(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return Math.round(n).toLocaleString(NUM_LOCALE);
}

/**
 * Format a ratio with one decimal and a trailing `×` (`4.0×`, `34.9×`).
 */
export function formatRatio(r: number): string {
  if (!Number.isFinite(r) || r <= 0) return "—";
  return `${r.toFixed(1)}×`;
}

/**
 * Truncate `s` to at most `max` chars, suffixing `…` when truncated.
 */
export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  if (max <= 1) return "…";
  return `${s.slice(0, max - 1)}…`;
}
