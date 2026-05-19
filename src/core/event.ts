// The MessageEvent record — one row of the per-session JSONL data plane.
//
// Shape matches SPEC.md §7.1. The IDs use the branded types from
// `./ids.js`; downstream consumers must construct via the validating
// `makeXxxId` factories rather than passing raw strings.
//
// Validation (parsing untrusted JSONL lines into a typed MessageEvent)
// lands in Phase 3 alongside the data-plane code. Phase 2 only needs the
// type to compile against.

import type { MessageId, ProjectId, SessionId } from "./ids.js";

export const MESSAGE_EVENT_SCHEMA_VERSION = "1.0" as const;
export type MessageEventSchemaVersion = typeof MESSAGE_EVENT_SCHEMA_VERSION;

export type MessageEventUsage = {
  readonly input_tokens: number;
  readonly output_tokens: number;
  readonly cache_creation_input_tokens: number;
  readonly cache_read_input_tokens: number;
  readonly cache_creation: {
    readonly ephemeral_5m_input_tokens: number;
    readonly ephemeral_1h_input_tokens: number;
  };
};

export type MessageEvent = {
  readonly schema_version: MessageEventSchemaVersion;
  readonly message_id: MessageId;
  readonly session_id: SessionId;
  readonly project: ProjectId;
  readonly timestamp: string;
  readonly model: string;
  readonly usage: MessageEventUsage;
  readonly tool_name?: string;
  readonly duration_ms?: number;
};
