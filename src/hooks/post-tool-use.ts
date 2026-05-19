// PostToolUse hook entrypoint.
//
// Per ADR-0003, this is *not* the data source for token usage — that comes
// from reading Claude Code's transcript JSONL. This hook exists only as a
// liveness signal: it updates `last_seen_active` on the manifest so the
// localhost server (Phase 7) can tell which sessions are still ticking.
//
// If the manifest is absent (e.g. session started before parallel-burn was
// installed, or the SessionStart hook didn't fire), we synthesize one from
// the PostToolUse payload — better to capture a partial session than to
// drop it.

import { basename } from "node:path";

import { makeProjectId, makeSessionId } from "../core/ids.js";
import {
  readManifestOptional,
  SESSION_MANIFEST_SCHEMA_VERSION,
  type SessionManifest,
  writeManifest,
} from "../core/manifest.js";
import {
  claudeCodeTranscriptPath,
  parallelBurnSessionMetaPath,
} from "../core/paths.js";
import { isEntryPoint, readStdinJson, readString, runHook } from "./_lib.js";

/**
 * Pure decision function: given the hook stdin payload, the prior
 * manifest (or null), and current time, produce the manifest to write —
 * or `null` to skip silently.
 */
export function buildTouchedManifest(
  payload: Record<string, unknown>,
  prior: SessionManifest | null,
  now: Date,
): SessionManifest | null {
  const sessionIdRaw = readString(payload, "session_id");
  const cwd = readString(payload, "cwd");
  if (sessionIdRaw === null || cwd === null) return null;
  const sessionId = makeSessionId(sessionIdRaw);
  const iso = now.toISOString();

  if (prior !== null) {
    return { ...prior, last_seen_active: iso };
  }
  const projectName = basename(cwd);
  if (projectName.length === 0) return null;
  const project = makeProjectId(projectName);
  return {
    schema_version: SESSION_MANIFEST_SCHEMA_VERSION,
    session_id: sessionId,
    project,
    cwd,
    transcript_path: claudeCodeTranscriptPath(cwd, sessionId),
    started_at: iso,
    last_seen_active: iso,
    ended_at: null,
  };
}

if (isEntryPoint(import.meta.url)) {
  runHook("post-tool-use", async () => {
    const payload = await readStdinJson();
    if (payload === null) return;
    const sessionIdRaw = readString(payload, "session_id");
    if (sessionIdRaw === null) return;
    const sessionId = makeSessionId(sessionIdRaw);
    const metaPath = parallelBurnSessionMetaPath(sessionId);
    const prior = await readManifestOptional(metaPath);
    const manifest = buildTouchedManifest(payload, prior, new Date());
    if (manifest === null) return;
    await writeManifest(metaPath, manifest);
  });
}
