import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  appendJsonLine,
  readJsonOptional,
  writeJsonAtomic,
} from "../src/core/store.js";

let tmp: string;
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "parallel-burn-store-"));
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("writeJsonAtomic", () => {
  it("creates the target directory if missing", async () => {
    const path = join(tmp, "nested", "deeply", "out.json");
    await writeJsonAtomic(path, { a: 1 });
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    expect(parsed).toEqual({ a: 1 });
  });

  it("overwrites an existing file atomically (no orphan temp files)", async () => {
    const path = join(tmp, "out.json");
    await writeJsonAtomic(path, { generation: 1 });
    await writeJsonAtomic(path, { generation: 2 });
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    expect(parsed).toEqual({ generation: 2 });
    const leftovers = (await readdir(tmp)).filter((n) => n.includes(".tmp."));
    expect(leftovers).toEqual([]);
  });

  it("leaves the original file untouched when serialization fails", async () => {
    const path = join(tmp, "out.json");
    await writeJsonAtomic(path, { ok: true });
    const circular: Record<string, unknown> = {};
    circular["self"] = circular;
    await expect(writeJsonAtomic(path, circular)).rejects.toThrow();
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    expect(parsed).toEqual({ ok: true });
    const leftovers = (await readdir(tmp)).filter((n) => n.includes(".tmp."));
    expect(leftovers).toEqual([]);
  });
});

describe("readJsonOptional", () => {
  it("returns null when the file does not exist", async () => {
    expect(await readJsonOptional(join(tmp, "nope.json"))).toBeNull();
  });

  it("returns the parsed value when the file exists", async () => {
    const path = join(tmp, "x.json");
    await writeFile(path, JSON.stringify({ hi: "there" }), "utf8");
    expect(await readJsonOptional(path)).toEqual({ hi: "there" });
  });

  it("propagates parse errors for malformed JSON", async () => {
    const path = join(tmp, "bad.json");
    await writeFile(path, "{not json", "utf8");
    await expect(readJsonOptional(path)).rejects.toThrow();
  });
});

describe("appendJsonLine", () => {
  it("appends each call as a single JSONL line ending in \\n", async () => {
    const path = join(tmp, "events.jsonl");
    await appendJsonLine(path, { i: 1 });
    await appendJsonLine(path, { i: 2 });
    await appendJsonLine(path, { i: 3 });
    const text = await readFile(path, "utf8");
    expect(text.endsWith("\n")).toBe(true);
    const lines = text.split("\n").filter((l) => l.length > 0);
    expect(lines).toHaveLength(3);
    expect(lines.map((l) => JSON.parse(l) as unknown)).toEqual([
      { i: 1 },
      { i: 2 },
      { i: 3 },
    ]);
  });

  it("creates the parent directory if missing", async () => {
    const path = join(tmp, "deep", "events.jsonl");
    await appendJsonLine(path, { ok: 1 });
    const s = await stat(path);
    expect(s.isFile()).toBe(true);
  });

  it("safely interleaves many parallel appends without truncation", async () => {
    const path = join(tmp, "many.jsonl");
    const N = 100;
    await Promise.all(
      Array.from({ length: N }, (_, i) => appendJsonLine(path, { i })),
    );
    const text = await readFile(path, "utf8");
    const lines = text.split("\n").filter((l) => l.length > 0);
    expect(lines).toHaveLength(N);
    const seen = new Set(lines.map((l) => (JSON.parse(l) as { i: number }).i));
    expect(seen.size).toBe(N);
  });
});
