// Transcript reader.
//
// Per ADR-0003, Claude Code's per-session transcript JSONL files are the
// source of truth for token usage. Each line is a JSON object describing
// one event in the session — user messages, attachments, hook results, and
// (most importantly for us) `type: "assistant"` records with a `message`
// body containing a `usage` block.
//
// This module reads such a file line-by-line, skips malformed or
// uninteresting records, and projects each well-formed assistant entry
// into a typed `MessageEvent` matching SPEC.md §7.1.

import { createReadStream, type ReadStream } from "node:fs";
import { basename } from "node:path";
import { createInterface } from "node:readline";

import {
  MESSAGE_EVENT_SCHEMA_VERSION,
  type MessageEvent,
  type MessageEventUsage,
} from "./event.js";
import {
  isMessageId,
  isProjectId,
  isSessionId,
  makeMessageId,
  makeProjectId,
  makeSessionId,
} from "./ids.js";

const ASSISTANT_TYPE = "assistant";

/**
 * Parse all assistant entries from a transcript file at `path`. Malformed
 * lines and uninteresting record types are skipped silently. The order of
 * results matches the order on disk.
 */
export async function readTranscript(path: string): Promise<MessageEvent[]> {
  const stream = createReadStream(path, { encoding: "utf8" });
  return collectFromStream(stream);
}

/**
 * Same as `readTranscript`, but yields events as they're parsed. Useful for
 * very large transcripts where holding the whole array in memory would be
 * wasteful — though in practice transcripts are small enough that the
 * array form is fine.
 */
export async function* iterateTranscript(path: string): AsyncIterable<MessageEvent> {
  const stream = createReadStream(path, { encoding: "utf8" });
  const lines = createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY });
  try {
    for await (const line of lines) {
      const event = tryProjectLine(line);
      if (event !== null) yield event;
    }
  } finally {
    stream.close();
  }
}

async function collectFromStream(stream: ReadStream): Promise<MessageEvent[]> {
  const lines = createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY });
  const out: MessageEvent[] = [];
  for await (const line of lines) {
    const event = tryProjectLine(line);
    if (event !== null) out.push(event);
  }
  return out;
}

export function tryProjectLine(line: string): MessageEvent | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  return projectAssistantEntry(parsed);
}

function projectAssistantEntry(raw: unknown): MessageEvent | null {
  if (!isPlainObject(raw)) return null;
  if (raw["type"] !== ASSISTANT_TYPE) return null;

  const message = raw["message"];
  if (!isPlainObject(message)) return null;

  const usage = message["usage"];
  if (!isPlainObject(usage)) return null;

  const model = message["model"];
  const messageIdRaw = message["id"];
  const sessionIdRaw = raw["sessionId"];
  const cwd = raw["cwd"];
  const timestamp = raw["timestamp"];

  if (typeof model !== "string" || model.length === 0) return null;
  if (typeof timestamp !== "string") return null;
  if (typeof cwd !== "string" || cwd.length === 0) return null;
  if (!isMessageId(messageIdRaw)) return null;
  if (!isSessionId(sessionIdRaw)) return null;

  const projectName = basename(cwd);
  if (!isProjectId(projectName)) return null;

  const projectedUsage = projectUsage(usage);

  return {
    schema_version: MESSAGE_EVENT_SCHEMA_VERSION,
    message_id: makeMessageId(messageIdRaw),
    session_id: makeSessionId(sessionIdRaw),
    project: makeProjectId(projectName),
    timestamp,
    model,
    usage: projectedUsage,
  };
}

function projectUsage(usage: Record<string, unknown>): MessageEventUsage {
  const cacheCreation = isPlainObject(usage["cache_creation"]) ? usage["cache_creation"] : {};
  return {
    input_tokens: nonNegativeFiniteNumber(usage["input_tokens"]),
    output_tokens: nonNegativeFiniteNumber(usage["output_tokens"]),
    cache_creation_input_tokens: nonNegativeFiniteNumber(usage["cache_creation_input_tokens"]),
    cache_read_input_tokens: nonNegativeFiniteNumber(usage["cache_read_input_tokens"]),
    cache_creation: {
      ephemeral_5m_input_tokens: nonNegativeFiniteNumber(cacheCreation["ephemeral_5m_input_tokens"]),
      ephemeral_1h_input_tokens: nonNegativeFiniteNumber(cacheCreation["ephemeral_1h_input_tokens"]),
    },
  };
}

function nonNegativeFiniteNumber(x: unknown): number {
  return typeof x === "number" && Number.isFinite(x) && x >= 0 ? x : 0;
}

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}
