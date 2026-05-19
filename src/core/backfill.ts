// Backfill — scan Claude Code's transcript directory for sessions that
// ParallelBurn doesn't yet have a manifest for, and synthesize one.
//
// Useful when ParallelBurn is installed *after* sessions have already
// run, or for the active session (whose `SessionStart` hook can't fire
// retroactively). Pure-discovery-plus-write — no transcript parsing
// beyond extracting the metadata fields we need (`cwd`, first/last
// timestamp), so it's fast even on large transcript directories.

import { homedir } from "node:os";
import { join } from "node:path";
import { readdir, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

import { isSessionId, makeProjectId, makeSessionId } from "./ids.js";
import {
  SESSION_MANIFEST_SCHEMA_VERSION,
  readManifestOptional,
  writeManifest,
} from "./manifest.js";
import {
  claudeCodeTranscriptPath,
  parallelBurnSessionMetaPath,
  parallelBurnSessionsDir,
} from "./paths.js";

const JSONL_SUFFIX = ".jsonl";
const CLAUDE_DIR = ".claude";
const PROJECTS_SUBDIR = "projects";
const ASSISTANT_TYPE = "assistant";
const MAX_SCAN_LINES = 5_000;

export type DiscoveredSession = {
  readonly sessionId: string;
  readonly transcriptPath: string;
  readonly cwd: string | null;
  readonly startedAt: string | null;
  readonly endedAt: string | null;
  readonly assistantCount: number;
};

export type BackfillResult = {
  readonly created: string[];
  readonly skipped: string[];
  readonly ignored: string[];
};

export function defaultClaudeProjectsDir(): string {
  return join(homedir(), CLAUDE_DIR, PROJECTS_SUBDIR);
}

/**
 * Walk every `<encoded-cwd>/<session-id>.jsonl` under the projects
 * directory and extract enough metadata to synthesize a manifest. Yields
 * one record per transcript file found. Never throws — malformed or
 * unreadable files are silently skipped.
 */
export async function* discoverTranscripts(
  projectsDir: string = defaultClaudeProjectsDir(),
): AsyncIterable<DiscoveredSession> {
  let projects: string[];
  try {
    projects = await readdir(projectsDir);
  } catch {
    return;
  }
  for (const projectDirName of projects) {
    const projectDir = join(projectsDir, projectDirName);
    let entries: string[];
    try {
      const st = await stat(projectDir);
      if (!st.isDirectory()) continue;
      entries = await readdir(projectDir);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (!name.endsWith(JSONL_SUFFIX)) continue;
      const sessionId = name.slice(0, -JSONL_SUFFIX.length);
      if (!isSessionId(sessionId)) continue;
      const transcriptPath = join(projectDir, name);
      const meta = await scanTranscriptMetadata(transcriptPath);
      yield { sessionId, transcriptPath, ...meta };
    }
  }
}

type TranscriptMetadata = {
  readonly cwd: string | null;
  readonly startedAt: string | null;
  readonly endedAt: string | null;
  readonly assistantCount: number;
};

async function scanTranscriptMetadata(path: string): Promise<TranscriptMetadata> {
  let cwd: string | null = null;
  let startedAt: string | null = null;
  let endedAt: string | null = null;
  let assistantCount = 0;
  let lineCount = 0;

  const stream = createReadStream(path, { encoding: "utf8" });
  const lines = createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY });
  try {
    for await (const line of lines) {
      lineCount++;
      if (lineCount > MAX_SCAN_LINES) break;
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        continue;
      }
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) continue;
      const obj = parsed as Record<string, unknown>;

      const lineCwd = typeof obj["cwd"] === "string" ? obj["cwd"] : null;
      if (cwd === null && lineCwd !== null && lineCwd.length > 0) cwd = lineCwd;

      const ts = typeof obj["timestamp"] === "string" ? obj["timestamp"] : null;
      if (ts !== null) {
        if (startedAt === null) startedAt = ts;
        endedAt = ts;
      }

      if (obj["type"] === ASSISTANT_TYPE) assistantCount++;
    }
  } finally {
    stream.close();
  }
  return { cwd, startedAt, endedAt, assistantCount };
}

export type BackfillOptions = {
  readonly projectsDir?: string;
  readonly sessionsDir?: string;
  /** Treat every discovered session as still-active (manifest's `ended_at: null`). Default: false — set `ended_at` from the last transcript timestamp. */
  readonly leaveOpen?: boolean;
};

/**
 * For every transcript under the projects directory, synthesize a
 * ParallelBurn manifest if one does not already exist.
 */
export async function backfillMissingManifests(
  options: BackfillOptions = {},
): Promise<BackfillResult> {
  const projectsDir = options.projectsDir ?? defaultClaudeProjectsDir();
  const sessionsDirRoot = options.sessionsDir ?? parallelBurnSessionsDir();
  const created: string[] = [];
  const skipped: string[] = [];
  const ignored: string[] = [];

  for await (const found of discoverTranscripts(projectsDir)) {
    const sessionId = makeSessionId(found.sessionId);
    const metaPath = join(sessionsDirRoot, `${sessionId}.meta.json`);

    const existing = await readManifestOptional(metaPath);
    if (existing !== null) {
      skipped.push(found.sessionId);
      continue;
    }

    if (
      found.cwd === null ||
      found.startedAt === null ||
      found.endedAt === null
    ) {
      ignored.push(found.sessionId);
      continue;
    }
    const projectName = projectNameFromCwd(found.cwd);
    if (projectName === null) {
      ignored.push(found.sessionId);
      continue;
    }

    await writeManifest(metaPath, {
      schema_version: SESSION_MANIFEST_SCHEMA_VERSION,
      session_id: sessionId,
      project: makeProjectId(projectName),
      cwd: found.cwd,
      transcript_path: claudeCodeTranscriptPath(found.cwd, sessionId),
      started_at: found.startedAt,
      last_seen_active: found.endedAt,
      ended_at: options.leaveOpen === true ? null : found.endedAt,
    });
    created.push(found.sessionId);
  }

  return { created, skipped, ignored };
}

/**
 * Best-effort project name extraction from a cwd. Returns the last
 * non-empty path segment, accepting either `\` or `/` as a separator.
 * Returns null when nothing usable is left after splitting.
 */
export function projectNameFromCwd(cwd: string): string | null {
  const parts = cwd.split(/[/\\]/).filter((s) => s.length > 0);
  const last = parts.length > 0 ? parts[parts.length - 1] : undefined;
  if (last === undefined || last.length === 0) return null;
  return last;
}

// Default re-export for the path helpers, useful so the CLI doesn't
// need to import from multiple modules.
export { parallelBurnSessionMetaPath };
