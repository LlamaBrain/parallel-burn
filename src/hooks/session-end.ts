// SessionEnd hook entrypoint.
//
// Stamps `ended_at` on the manifest. Summary generation lands in Phase 6
// and will be triggered from here; for now this hook only marks the
// boundary.
//
// If the manifest is absent we do nothing — there's no in-flight state
// to finalize, and the missing SessionStart already meant we never had a
// running session to track.

import { makeSessionId } from "../core/ids.js";
import {
  readManifestOptional,
  type SessionManifest,
  writeManifest,
} from "../core/manifest.js";
import { parallelBurnSessionMetaPath } from "../core/paths.js";
import { isEntryPoint, readStdinJson, readString, runHook } from "./_lib.js";

/**
 * Pure decision function: returns the manifest to write, or `null` if
 * nothing should be persisted (no prior manifest, already finalized,
 * or malformed payload).
 */
export function buildEndManifest(
  payload: Record<string, unknown>,
  prior: SessionManifest | null,
  now: Date,
): SessionManifest | null {
  const sessionIdRaw = readString(payload, "session_id");
  if (sessionIdRaw === null) return null;
  if (prior === null) return null;
  if (prior.ended_at !== null) return null;
  return { ...prior, ended_at: now.toISOString() };
}

if (isEntryPoint(import.meta.url)) {
  runHook("session-end", async () => {
    const payload = await readStdinJson();
    if (payload === null) return;
    const sessionIdRaw = readString(payload, "session_id");
    if (sessionIdRaw === null) return;
    const sessionId = makeSessionId(sessionIdRaw);
    const metaPath = parallelBurnSessionMetaPath(sessionId);
    const prior = await readManifestOptional(metaPath);
    const manifest = buildEndManifest(payload, prior, new Date());
    if (manifest === null) return;
    await writeManifest(metaPath, manifest);
  });
}
