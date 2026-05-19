// SessionManifest — the per-session sidecar at
// `~/.parallel-burn/data/sessions/<session-id>.meta.json`.
//
// Recorded once at SessionStart, touched on PostToolUse (last_seen_active),
// finalized at SessionEnd. Stable across crashes: if the process dies
// without calling SessionEnd, the absence of `ended_at` is the
// crash-marker; the session is otherwise readable.

import type { ProjectId, SessionId } from "./ids.js";
import { isProjectId, isSessionId } from "./ids.js";
import { readJsonOptional, writeJsonAtomic } from "./store.js";

export const SESSION_MANIFEST_SCHEMA_VERSION = "1.0" as const;

export type SessionManifest = {
  readonly schema_version: typeof SESSION_MANIFEST_SCHEMA_VERSION;
  readonly session_id: SessionId;
  readonly project: ProjectId;
  /** Working directory of the session (raw, unencoded). */
  readonly cwd: string;
  /** Absolute path to Claude Code's transcript JSONL for this session. */
  readonly transcript_path: string;
  /** ISO 8601 timestamp set once at SessionStart. */
  readonly started_at: string;
  /** ISO 8601 timestamp, updated on every PostToolUse. */
  readonly last_seen_active: string;
  /** ISO 8601 timestamp, set on SessionEnd. Null while the session is alive. */
  readonly ended_at: string | null;
};

export class ManifestValidationError extends Error {
  constructor(message: string) {
    super(`Invalid SessionManifest: ${message}`);
    this.name = "ManifestValidationError";
  }
}

export async function writeManifest(path: string, manifest: SessionManifest): Promise<void> {
  await writeJsonAtomic(path, manifest);
}

export async function readManifestOptional(path: string): Promise<SessionManifest | null> {
  const raw = await readJsonOptional(path);
  if (raw === null) return null;
  return parseManifest(raw);
}

export function parseManifest(raw: unknown): SessionManifest {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new ManifestValidationError(`expected object, got ${typeof raw}`);
  }
  const obj = raw as Record<string, unknown>;
  if (obj["schema_version"] !== SESSION_MANIFEST_SCHEMA_VERSION) {
    throw new ManifestValidationError(
      `unsupported schema_version ${JSON.stringify(obj["schema_version"])}`,
    );
  }
  const session_id = obj["session_id"];
  const project = obj["project"];
  const cwd = obj["cwd"];
  const transcript_path = obj["transcript_path"];
  const started_at = obj["started_at"];
  const last_seen_active = obj["last_seen_active"];
  const ended_at = obj["ended_at"];
  if (!isSessionId(session_id)) {
    throw new ManifestValidationError(`session_id is not a valid SessionId`);
  }
  if (!isProjectId(project)) {
    throw new ManifestValidationError(`project is not a valid ProjectId`);
  }
  if (typeof cwd !== "string" || cwd.length === 0) {
    throw new ManifestValidationError(`cwd must be a non-empty string`);
  }
  if (typeof transcript_path !== "string" || transcript_path.length === 0) {
    throw new ManifestValidationError(`transcript_path must be a non-empty string`);
  }
  if (typeof started_at !== "string" || typeof last_seen_active !== "string") {
    throw new ManifestValidationError(`timestamps must be strings`);
  }
  if (ended_at !== null && typeof ended_at !== "string") {
    throw new ManifestValidationError(`ended_at must be a string or null`);
  }
  return {
    schema_version: SESSION_MANIFEST_SCHEMA_VERSION,
    session_id,
    project,
    cwd,
    transcript_path,
    started_at,
    last_seen_active,
    ended_at,
  };
}
