import { describe, expect, it } from "vitest";

import { makeProjectId, makeSessionId } from "../src/core/ids.js";
import {
  SESSION_MANIFEST_SCHEMA_VERSION,
  type SessionManifest,
} from "../src/core/manifest.js";
import { buildEndManifest } from "../src/hooks/session-end.js";
import { buildStartManifest } from "../src/hooks/session-start.js";
import { buildTouchedManifest } from "../src/hooks/post-tool-use.js";

const SID = "01999999-aaaa-bbbb-cccc-deadbeefcafe";
const CWD = "E:\\Personal\\parallel-burn";
const NOW = new Date("2026-05-19T10:00:00.000Z");
const LATER = new Date("2026-05-19T10:05:00.000Z");

function priorManifest(): SessionManifest {
  return {
    schema_version: SESSION_MANIFEST_SCHEMA_VERSION,
    session_id: makeSessionId(SID),
    project: makeProjectId("parallel-burn"),
    cwd: CWD,
    transcript_path: "transcript-path-here",
    started_at: NOW.toISOString(),
    last_seen_active: NOW.toISOString(),
    ended_at: null,
  };
}

describe("buildStartManifest", () => {
  it("builds a fresh manifest from a valid payload", () => {
    const m = buildStartManifest({ session_id: SID, cwd: CWD }, NOW);
    expect(m).not.toBeNull();
    expect(m?.session_id).toBe(SID);
    expect(m?.cwd).toBe(CWD);
    expect(m?.project).toBe("parallel-burn");
    expect(m?.started_at).toBe(NOW.toISOString());
    expect(m?.last_seen_active).toBe(NOW.toISOString());
    expect(m?.ended_at).toBeNull();
    expect(m?.transcript_path).toContain("E--Personal-parallel-burn");
    expect(m?.transcript_path).toContain(`${SID}.jsonl`);
  });

  it("returns null when session_id is missing", () => {
    expect(buildStartManifest({ cwd: CWD }, NOW)).toBeNull();
  });

  it("returns null when cwd is missing", () => {
    expect(buildStartManifest({ session_id: SID }, NOW)).toBeNull();
  });

  it("returns null when session_id is not a string", () => {
    expect(buildStartManifest({ session_id: 42, cwd: CWD }, NOW)).toBeNull();
  });
});

describe("buildTouchedManifest", () => {
  it("updates last_seen_active when a prior manifest exists", () => {
    const prior = priorManifest();
    const touched = buildTouchedManifest({ session_id: SID, cwd: CWD }, prior, LATER);
    expect(touched).not.toBeNull();
    expect(touched?.last_seen_active).toBe(LATER.toISOString());
    expect(touched?.started_at).toBe(prior.started_at); // unchanged
    expect(touched?.ended_at).toBeNull();
  });

  it("synthesizes a new manifest when no prior exists", () => {
    const m = buildTouchedManifest({ session_id: SID, cwd: CWD }, null, NOW);
    expect(m).not.toBeNull();
    expect(m?.started_at).toBe(NOW.toISOString());
    expect(m?.last_seen_active).toBe(NOW.toISOString());
    expect(m?.ended_at).toBeNull();
  });

  it("returns null on malformed payloads", () => {
    expect(buildTouchedManifest({}, null, NOW)).toBeNull();
    expect(buildTouchedManifest({ session_id: SID }, null, NOW)).toBeNull();
    expect(buildTouchedManifest({ cwd: CWD }, null, NOW)).toBeNull();
  });
});

describe("buildEndManifest", () => {
  it("stamps ended_at on an open manifest", () => {
    const prior = priorManifest();
    const finalized = buildEndManifest({ session_id: SID }, prior, LATER);
    expect(finalized).not.toBeNull();
    expect(finalized?.ended_at).toBe(LATER.toISOString());
  });

  it("returns null when there is no prior manifest", () => {
    expect(buildEndManifest({ session_id: SID }, null, LATER)).toBeNull();
  });

  it("returns null when the manifest is already finalized", () => {
    const finalized: SessionManifest = {
      ...priorManifest(),
      ended_at: NOW.toISOString(),
    };
    expect(buildEndManifest({ session_id: SID }, finalized, LATER)).toBeNull();
  });

  it("returns null on malformed payload", () => {
    expect(buildEndManifest({}, priorManifest(), LATER)).toBeNull();
  });
});
