// SessionStart hook entrypoint.
//
// Stdin: { session_id, cwd, hook_event_name, ... } (Claude Code's hook
// payload). On a valid payload, writes a fresh SessionManifest sidecar at
// `~/.parallel-burn/data/sessions/<session-id>.meta.json` recording the
// resolved transcript path. Idempotent: re-running this hook for the same
// session overwrites the manifest with a new `started_at`, which is the
// correct behavior if Claude Code legitimately re-emits SessionStart.

import { basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { readConfig } from "../core/config.js";
import { ensureServerRunning } from "../core/ensure-server.js";
import { makeProjectId, makeSessionId } from "../core/ids.js";
import {
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
 * Pure decision function: given the hook stdin payload and current time,
 * produce the manifest to write, or `null` to skip silently.
 */
export function buildStartManifest(
  payload: Record<string, unknown>,
  now: Date,
): SessionManifest | null {
  const sessionIdRaw = readString(payload, "session_id");
  const cwd = readString(payload, "cwd");
  if (sessionIdRaw === null || cwd === null) return null;
  const sessionId = makeSessionId(sessionIdRaw);
  const projectName = basename(cwd);
  if (projectName.length === 0) return null;
  const project = makeProjectId(projectName);
  const iso = now.toISOString();
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

/**
 * Resolve the plugin root from this module's own location. session-start.js
 * lives at `<plugin-root>/dist/hooks/session-start.js`, so three `dirname`s
 * climb back to the plugin root.
 */
function pluginRootFromModuleUrl(moduleUrl: string): string {
  return dirname(dirname(dirname(fileURLToPath(moduleUrl))));
}

if (isEntryPoint(import.meta.url)) {
  runHook("session-start", async () => {
    const payload = await readStdinJson();
    if (payload === null) return;
    const manifest = buildStartManifest(payload, new Date());
    if (manifest === null) return;
    await writeManifest(parallelBurnSessionMetaPath(manifest.session_id), manifest);

    const config = await readConfig();
    const pluginRoot = pluginRootFromModuleUrl(import.meta.url);
    const serveScriptPath = fileURLToPath(new URL("../cli/serve.js", import.meta.url));
    await ensureServerRunning({
      port: config.serverPort,
      serveScriptPath,
      pluginRoot,
    });
  });
}
