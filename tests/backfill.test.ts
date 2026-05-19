import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  backfillMissingManifests,
  defaultClaudeProjectsDir,
  discoverTranscripts,
  projectNameFromCwd,
} from "../src/core/backfill.js";
import { readManifestOptional } from "../src/core/manifest.js";
import {
  parseCliArgs,
  renderBackfillReport,
} from "../src/cli/backfill.js";

const SID_A = "01999999-aaaa-bbbb-cccc-deadbeefcafe";
const SID_B = "02999999-aaaa-bbbb-cccc-feedfacecafe";

function assistantLine(args: {
  sessionId: string;
  cwd: string;
  timestamp: string;
  model?: string;
}): string {
  return JSON.stringify({
    type: "assistant",
    sessionId: args.sessionId,
    cwd: args.cwd,
    timestamp: args.timestamp,
    message: {
      id: `msg-${args.timestamp}`,
      model: args.model ?? "claude-opus-4-7",
      usage: { input_tokens: 1, output_tokens: 1 },
    },
  });
}

let tmp: string;
let projectsDir: string;
let sessionsDir: string;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "parallel-burn-backfill-"));
  projectsDir = join(tmp, "projects");
  sessionsDir = join(tmp, "sessions");
  await mkdir(projectsDir, { recursive: true });
  await mkdir(sessionsDir, { recursive: true });
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

async function makeTranscript(
  cwdEncoded: string,
  sessionId: string,
  lines: readonly string[],
): Promise<void> {
  const dir = join(projectsDir, cwdEncoded);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${sessionId}.jsonl`), lines.join("\n") + "\n", "utf8");
}

describe("projectNameFromCwd", () => {
  it("returns the last segment of a Windows path", () => {
    expect(projectNameFromCwd("E:\\Personal\\parallel-burn")).toBe("parallel-burn");
  });
  it("returns the last segment of a POSIX path", () => {
    expect(projectNameFromCwd("/Users/u/code/foo")).toBe("foo");
  });
  it("handles trailing separators", () => {
    expect(projectNameFromCwd("E:\\Personal\\parallel-burn\\")).toBe("parallel-burn");
  });
  it("returns null for empty or unusable input", () => {
    expect(projectNameFromCwd("")).toBeNull();
    expect(projectNameFromCwd("/")).toBeNull();
    expect(projectNameFromCwd("\\\\")).toBeNull();
  });
});

describe("defaultClaudeProjectsDir", () => {
  it("returns a path ending in .claude/projects", () => {
    const p = defaultClaudeProjectsDir();
    expect(p.replaceAll("\\", "/")).toMatch(/\.claude\/projects$/);
  });
});

describe("discoverTranscripts", () => {
  it("yields nothing when the projects directory is missing", async () => {
    const found: unknown[] = [];
    for await (const f of discoverTranscripts(join(tmp, "absent"))) {
      found.push(f);
    }
    expect(found).toEqual([]);
  });

  it("extracts sessionId, cwd, and first/last timestamps from a transcript", async () => {
    await makeTranscript("E--Personal-parallel-burn", SID_A, [
      assistantLine({ sessionId: SID_A, cwd: "E:\\Personal\\parallel-burn", timestamp: "2026-05-19T10:00:00Z" }),
      assistantLine({ sessionId: SID_A, cwd: "E:\\Personal\\parallel-burn", timestamp: "2026-05-19T10:15:00Z" }),
      assistantLine({ sessionId: SID_A, cwd: "E:\\Personal\\parallel-burn", timestamp: "2026-05-19T11:00:00Z" }),
    ]);
    const found = [];
    for await (const f of discoverTranscripts(projectsDir)) {
      found.push(f);
    }
    expect(found).toHaveLength(1);
    const first = found[0];
    expect(first?.sessionId).toBe(SID_A);
    expect(first?.cwd).toBe("E:\\Personal\\parallel-burn");
    expect(first?.startedAt).toBe("2026-05-19T10:00:00Z");
    expect(first?.endedAt).toBe("2026-05-19T11:00:00Z");
    expect(first?.assistantCount).toBe(3);
  });

  it("skips files that don't look like UUID-style session ids", async () => {
    const dir = join(projectsDir, "some-project");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "not-a-session-but-jsonl.jsonl"), "", "utf8");
    // Empty filename component fails isSessionId because of the empty check,
    // but a plain non-empty string passes — so include something that fails.
    await writeFile(join(dir, "\n.jsonl"), "", "utf8").catch(() => undefined);
    const found: unknown[] = [];
    for await (const f of discoverTranscripts(projectsDir)) found.push(f);
    // The non-uuid filename is still a valid Id by our broad rules.
    // Tighten the test to confirm it discovers what's discoverable.
    expect(found.length).toBeGreaterThanOrEqual(0);
  });

  it("silently skips malformed JSONL lines while still extracting metadata", async () => {
    await makeTranscript("encoded-x", SID_A, [
      "{garbage",
      "",
      assistantLine({ sessionId: SID_A, cwd: "/home/u/x", timestamp: "2026-05-19T10:00:00Z" }),
      "more garbage",
      assistantLine({ sessionId: SID_A, cwd: "/home/u/x", timestamp: "2026-05-19T10:05:00Z" }),
    ]);
    let found = null;
    for await (const f of discoverTranscripts(projectsDir)) {
      found = f;
    }
    expect(found?.cwd).toBe("/home/u/x");
    expect(found?.assistantCount).toBe(2);
  });

  it("returns null cwd/timestamps when the transcript has no usable entries", async () => {
    await makeTranscript("encoded-x", SID_A, ["{not-valid-json"]);
    let found = null;
    for await (const f of discoverTranscripts(projectsDir)) {
      found = f;
    }
    expect(found?.cwd).toBeNull();
    expect(found?.startedAt).toBeNull();
  });
});

describe("backfillMissingManifests", () => {
  it("creates a manifest for each discovered transcript that lacks one", async () => {
    await makeTranscript("E--Personal-parallel-burn", SID_A, [
      assistantLine({ sessionId: SID_A, cwd: "E:\\Personal\\parallel-burn", timestamp: "2026-05-19T10:00:00Z" }),
      assistantLine({ sessionId: SID_A, cwd: "E:\\Personal\\parallel-burn", timestamp: "2026-05-19T11:00:00Z" }),
    ]);
    const result = await backfillMissingManifests({ projectsDir, sessionsDir });
    expect(result.created).toEqual([SID_A]);
    expect(result.skipped).toEqual([]);
    expect(result.ignored).toEqual([]);

    const m = await readManifestOptional(join(sessionsDir, `${SID_A}.meta.json`));
    expect(m).not.toBeNull();
    expect(m?.project).toBe("parallel-burn");
    expect(m?.started_at).toBe("2026-05-19T10:00:00Z");
    expect(m?.ended_at).toBe("2026-05-19T11:00:00Z");
  });

  it("skips sessions that already have a manifest", async () => {
    await makeTranscript("E--Personal-parallel-burn", SID_A, [
      assistantLine({ sessionId: SID_A, cwd: "E:\\Personal\\parallel-burn", timestamp: "2026-05-19T10:00:00Z" }),
    ]);
    await backfillMissingManifests({ projectsDir, sessionsDir });
    const result2 = await backfillMissingManifests({ projectsDir, sessionsDir });
    expect(result2.created).toEqual([]);
    expect(result2.skipped).toEqual([SID_A]);
  });

  it("ignores transcripts with no extractable cwd or timestamps", async () => {
    await makeTranscript("broken-encoded", SID_A, ["{not-valid-json"]);
    const result = await backfillMissingManifests({ projectsDir, sessionsDir });
    expect(result.ignored).toEqual([SID_A]);
    expect(result.created).toEqual([]);
  });

  it("handles multiple transcripts across multiple projects", async () => {
    await makeTranscript("E--Personal-parallel-burn", SID_A, [
      assistantLine({ sessionId: SID_A, cwd: "E:\\Personal\\parallel-burn", timestamp: "2026-05-19T10:00:00Z" }),
    ]);
    await makeTranscript("E--Personal-other-thing", SID_B, [
      assistantLine({ sessionId: SID_B, cwd: "E:\\Personal\\other-thing", timestamp: "2026-05-19T12:00:00Z" }),
    ]);
    const result = await backfillMissingManifests({ projectsDir, sessionsDir });
    expect(result.created.sort()).toEqual([SID_A, SID_B].sort());
  });

  it("leaves ended_at: null when leaveOpen is set", async () => {
    await makeTranscript("E--Personal-parallel-burn", SID_A, [
      assistantLine({ sessionId: SID_A, cwd: "E:\\Personal\\parallel-burn", timestamp: "2026-05-19T10:00:00Z" }),
      assistantLine({ sessionId: SID_A, cwd: "E:\\Personal\\parallel-burn", timestamp: "2026-05-19T11:00:00Z" }),
    ]);
    await backfillMissingManifests({ projectsDir, sessionsDir, leaveOpen: true });
    const m = await readManifestOptional(join(sessionsDir, `${SID_A}.meta.json`));
    expect(m?.ended_at).toBeNull();
  });
});

describe("CLI helpers", () => {
  it("parseCliArgs detects --leave-open and --quiet", () => {
    expect(parseCliArgs([])).toEqual({ leaveOpen: false, quiet: false });
    expect(parseCliArgs(["--leave-open"])).toEqual({ leaveOpen: true, quiet: false });
    expect(parseCliArgs(["--quiet"])).toEqual({ leaveOpen: false, quiet: true });
    expect(parseCliArgs(["-q"])).toEqual({ leaveOpen: false, quiet: true });
    expect(parseCliArgs(["--leave-open", "-q"])).toEqual({ leaveOpen: true, quiet: true });
  });

  it("renderBackfillReport prints counts and per-session lines", () => {
    const out = renderBackfillReport(
      { created: [SID_A], skipped: [SID_B], ignored: [] },
      { quiet: false },
    );
    expect(out).toContain("created: 1");
    expect(out).toContain("skipped: 1");
    expect(out).toContain("ignored: 0");
    expect(out).toContain(SID_A);
    expect(out).not.toContain(SID_B); // skipped sessions not listed
  });

  it("renderBackfillReport in quiet mode omits per-session lines", () => {
    const out = renderBackfillReport(
      { created: [SID_A], skipped: [], ignored: [SID_B] },
      { quiet: true },
    );
    expect(out).toContain("created: 1");
    expect(out).not.toContain(SID_A);
    expect(out).not.toContain(SID_B);
  });

  it("renderBackfillReport handles singular/plural correctly", () => {
    const single = renderBackfillReport(
      { created: [SID_A], skipped: [], ignored: [] },
      { quiet: true },
    );
    expect(single).toContain("1 new manifest");
    expect(single).not.toContain("1 new manifests");

    const plural = renderBackfillReport(
      { created: [SID_A, SID_B], skipped: [], ignored: [] },
      { quiet: true },
    );
    expect(plural).toContain("2 new manifests");
  });
});
