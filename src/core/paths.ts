// Filesystem path resolution for ParallelBurn.
//
// Two roots:
//
// 1. `~/.parallel-burn/` — our own data directory. Manifest sidecars,
//    materialized JSONL projections, summaries, and the local config live
//    here.
// 2. `~/.claude/projects/<encoded-cwd>/<session-uuid>.jsonl` — Claude
//    Code's transcript file. The encoding is pinned in ADR-0004.

import { homedir } from "node:os";
import { join } from "node:path";

import type { SessionId } from "./ids.js";

const PARALLEL_BURN_DIR = ".parallel-burn";
const DATA_SUBDIR = "data";
const SESSIONS_SUBDIR = "sessions";
const SUMMARIES_SUBDIR = "summaries";
const CLAUDE_DIR = ".claude";
const CLAUDE_PROJECTS_SUBDIR = "projects";

// See ADR-0004. Replace `:`, `\`, `/`, and `.` with a single `-`.
const PATH_CHARS_TO_REPLACE = /[:\\/.]/g;
const REPLACEMENT_CHAR = "-";

export function parallelBurnRoot(): string {
  return join(homedir(), PARALLEL_BURN_DIR);
}

export function parallelBurnSessionsDir(): string {
  return join(parallelBurnRoot(), DATA_SUBDIR, SESSIONS_SUBDIR);
}

export function parallelBurnSummariesDir(): string {
  return join(parallelBurnRoot(), SUMMARIES_SUBDIR);
}

export function parallelBurnSessionMetaPath(sessionId: SessionId): string {
  return join(parallelBurnSessionsDir(), `${sessionId}.meta.json`);
}

export function parallelBurnSessionEventsPath(sessionId: SessionId): string {
  return join(parallelBurnSessionsDir(), `${sessionId}.jsonl`);
}

export function encodeProjectDirName(cwd: string): string {
  return cwd.replace(PATH_CHARS_TO_REPLACE, REPLACEMENT_CHAR);
}

export function claudeCodeProjectDir(cwd: string): string {
  return join(homedir(), CLAUDE_DIR, CLAUDE_PROJECTS_SUBDIR, encodeProjectDirName(cwd));
}

export function claudeCodeTranscriptPath(cwd: string, sessionId: SessionId): string {
  return join(claudeCodeProjectDir(cwd), `${sessionId}.jsonl`);
}
