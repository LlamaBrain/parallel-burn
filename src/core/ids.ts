// Branded primitive IDs.
//
// Each ID kind is a `string` intersected with a private brand symbol, so the
// type system rejects passing a raw `string` where a `SessionId` is expected
// and rejects accidentally swapping a `MessageId` for a `SessionId`. The
// brands are declared with `unique symbol` and never exported — consumers
// of this module cannot construct an `Id` value except via the `makeXxx`
// constructors here, which validate the underlying string.
//
// See SPEC.md §11: "Typed IDs everywhere. No stringly-typed code."

declare const sessionIdBrand: unique symbol;
declare const projectIdBrand: unique symbol;
declare const messageIdBrand: unique symbol;

export type SessionId = string & { readonly [sessionIdBrand]: void };
export type ProjectId = string & { readonly [projectIdBrand]: void };
export type MessageId = string & { readonly [messageIdBrand]: void };

const MAX_ID_LENGTH = 256;
const NEWLINE_PATTERN = /[\r\n]/;

export class InvalidIdError extends Error {
  constructor(kind: string, raw: unknown, reason: string) {
    const displayed =
      typeof raw === "string" ? JSON.stringify(raw) : String(raw);
    super(`${kind}: invalid value ${displayed} — ${reason}`);
    this.name = "InvalidIdError";
  }
}

function validateRawId(kind: string, raw: unknown): asserts raw is string {
  if (typeof raw !== "string") {
    throw new InvalidIdError(kind, raw, `expected string, got ${typeof raw}`);
  }
  if (raw.length === 0) {
    throw new InvalidIdError(kind, raw, "must not be empty");
  }
  if (raw.length > MAX_ID_LENGTH) {
    throw new InvalidIdError(
      kind,
      raw,
      `must be at most ${String(MAX_ID_LENGTH)} chars (got ${String(raw.length)})`,
    );
  }
  if (raw !== raw.trim()) {
    throw new InvalidIdError(kind, raw, "must not have leading/trailing whitespace");
  }
  if (NEWLINE_PATTERN.test(raw)) {
    throw new InvalidIdError(kind, raw, "must not contain newlines");
  }
}

function isValidIdString(raw: unknown): raw is string {
  try {
    validateRawId("Id", raw);
    return true;
  } catch {
    return false;
  }
}

export function makeSessionId(raw: string): SessionId {
  validateRawId("SessionId", raw);
  return raw as SessionId;
}

export function makeProjectId(raw: string): ProjectId {
  validateRawId("ProjectId", raw);
  return raw as ProjectId;
}

export function makeMessageId(raw: string): MessageId {
  validateRawId("MessageId", raw);
  return raw as MessageId;
}

// Runtime type guards. Note: at runtime, branded IDs are just strings, so a
// guard cannot distinguish between SessionId and MessageId — both are simply
// "valid ID strings". The brand is purely a compile-time discipline. These
// guards exist to safely narrow `unknown` (e.g. from JSON.parse) to a typed
// ID, paired with the implicit contract that the caller knows which kind
// they are reading.

export function isSessionId(x: unknown): x is SessionId {
  return isValidIdString(x);
}

export function isProjectId(x: unknown): x is ProjectId {
  return isValidIdString(x);
}

export function isMessageId(x: unknown): x is MessageId {
  return isValidIdString(x);
}
