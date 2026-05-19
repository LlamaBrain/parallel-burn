import { homedir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { makeSessionId } from "../src/core/ids.js";
import {
  claudeCodeProjectDir,
  claudeCodeTranscriptPath,
  encodeProjectDirName,
  parallelBurnRoot,
  parallelBurnSessionEventsPath,
  parallelBurnSessionMetaPath,
  parallelBurnSessionsDir,
  parallelBurnSummariesDir,
} from "../src/core/paths.js";

describe("encodeProjectDirName — ADR-0004 rule", () => {
  it("encodes the parallel-burn cwd as Claude Code does", () => {
    expect(encodeProjectDirName("E:\\Personal\\parallel-burn")).toBe(
      "E--Personal-parallel-burn",
    );
  });

  it("encodes a path with a dot-prefixed segment as a double dash", () => {
    expect(
      encodeProjectDirName("C:\\Users\\metag\\.claude-mem\\observer\\sessions"),
    ).toBe("C--Users-metag--claude-mem-observer-sessions");
  });

  it("encodes a deeply nested dot-segmented path verbatim against the observation table", () => {
    expect(
      encodeProjectDirName(
        "E:\\Personal\\dirigible2D\\Assets\\.Dirigible-Media\\Documentation\\Plan",
      ),
    ).toBe(
      "E--Personal-dirigible2D-Assets--Dirigible-Media-Documentation-Plan",
    );
  });

  it("encodes a POSIX path symmetrically", () => {
    expect(encodeProjectDirName("/Users/metag/code/foo")).toBe(
      "-Users-metag-code-foo",
    );
  });

  it("collapses adjacent target characters to adjacent dashes (not a single dash)", () => {
    // Per ADR-0004 the rule is a 1:1 replacement, not a 1:N collapse.
    expect(encodeProjectDirName("a::b")).toBe("a--b");
    expect(encodeProjectDirName("a/./b")).toBe("a---b");
  });
});

describe("parallel-burn paths", () => {
  it("roots under ~/.parallel-burn", () => {
    expect(parallelBurnRoot()).toBe(join(homedir(), ".parallel-burn"));
  });

  it("places per-session manifests under data/sessions", () => {
    const sid = makeSessionId("abc-123");
    expect(parallelBurnSessionMetaPath(sid)).toBe(
      join(homedir(), ".parallel-burn", "data", "sessions", "abc-123.meta.json"),
    );
  });

  it("places per-session event JSONLs under data/sessions", () => {
    const sid = makeSessionId("abc-123");
    expect(parallelBurnSessionEventsPath(sid)).toBe(
      join(homedir(), ".parallel-burn", "data", "sessions", "abc-123.jsonl"),
    );
  });

  it("places summaries under summaries/", () => {
    expect(parallelBurnSummariesDir()).toBe(
      join(homedir(), ".parallel-burn", "summaries"),
    );
  });

  it("places sessions dir under data/sessions", () => {
    expect(parallelBurnSessionsDir()).toBe(
      join(homedir(), ".parallel-burn", "data", "sessions"),
    );
  });
});

describe("Claude Code transcript paths", () => {
  it("resolves the transcript path for a Windows cwd", () => {
    const sid = makeSessionId("ea18583d-d084-4a30-a186-c8c4c08bb739");
    expect(claudeCodeTranscriptPath("E:\\Personal\\parallel-burn", sid)).toBe(
      join(
        homedir(),
        ".claude",
        "projects",
        "E--Personal-parallel-burn",
        "ea18583d-d084-4a30-a186-c8c4c08bb739.jsonl",
      ),
    );
  });

  it("resolves the project directory regardless of trailing session", () => {
    expect(claudeCodeProjectDir("E:\\Personal\\parallel-burn")).toBe(
      join(homedir(), ".claude", "projects", "E--Personal-parallel-burn"),
    );
  });
});
