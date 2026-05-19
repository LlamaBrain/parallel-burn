import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { makeProjectId, makeSessionId } from "../src/core/ids.js";
import {
  ManifestValidationError,
  parseManifest,
  readManifestOptional,
  SESSION_MANIFEST_SCHEMA_VERSION,
  type SessionManifest,
  writeManifest,
} from "../src/core/manifest.js";

let tmp: string;
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "parallel-burn-manifest-"));
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

function exampleManifest(): SessionManifest {
  return {
    schema_version: SESSION_MANIFEST_SCHEMA_VERSION,
    session_id: makeSessionId("01999999-aaaa-bbbb-cccc-deadbeefcafe"),
    project: makeProjectId("parallel-burn"),
    cwd: "E:\\Personal\\parallel-burn",
    transcript_path:
      "C:\\Users\\u\\.claude\\projects\\E--Personal-parallel-burn\\01999999-aaaa-bbbb-cccc-deadbeefcafe.jsonl",
    started_at: "2026-05-19T10:00:00.000Z",
    last_seen_active: "2026-05-19T10:05:00.000Z",
    ended_at: null,
  };
}

describe("manifest write/read round trip", () => {
  it("round-trips a fresh manifest atomically", async () => {
    const path = join(tmp, "x.meta.json");
    const m = exampleManifest();
    await writeManifest(path, m);
    const read = await readManifestOptional(path);
    expect(read).toEqual(m);
  });

  it("returns null when the manifest does not exist", async () => {
    expect(await readManifestOptional(join(tmp, "missing.meta.json"))).toBeNull();
  });
});

describe("parseManifest validation", () => {
  it("rejects unsupported schema_version", () => {
    expect(() =>
      parseManifest({ ...exampleManifest(), schema_version: "2.0" }),
    ).toThrow(ManifestValidationError);
  });

  it("rejects an invalid session_id", () => {
    expect(() =>
      parseManifest({ ...exampleManifest(), session_id: "" }),
    ).toThrow(/session_id/);
  });

  it("rejects an invalid project id", () => {
    expect(() =>
      parseManifest({ ...exampleManifest(), project: " has-space " }),
    ).toThrow(/project/);
  });

  it("rejects an empty cwd", () => {
    expect(() => parseManifest({ ...exampleManifest(), cwd: "" })).toThrow(/cwd/);
  });

  it("rejects an empty transcript_path", () => {
    expect(() =>
      parseManifest({ ...exampleManifest(), transcript_path: "" }),
    ).toThrow(/transcript_path/);
  });

  it("rejects non-string timestamps", () => {
    expect(() =>
      parseManifest({ ...exampleManifest(), started_at: 0 as never }),
    ).toThrow(/timestamps must be strings/);
  });

  it("rejects non-null non-string ended_at", () => {
    expect(() =>
      parseManifest({ ...exampleManifest(), ended_at: 0 as never }),
    ).toThrow(/ended_at/);
  });

  it("rejects array input", () => {
    expect(() => parseManifest([] as never)).toThrow(/expected object/);
  });

  it("rejects null input", () => {
    expect(() => parseManifest(null)).toThrow(/expected object/);
  });

  it("accepts a finalized manifest with a non-null ended_at", () => {
    const m = parseManifest({
      ...exampleManifest(),
      ended_at: "2026-05-19T11:00:00.000Z",
    });
    expect(m.ended_at).toBe("2026-05-19T11:00:00.000Z");
  });
});
