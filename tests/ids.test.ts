import { describe, expect, it } from "vitest";

import {
  InvalidIdError,
  isMessageId,
  isProjectId,
  isSessionId,
  makeMessageId,
  makeProjectId,
  makeSessionId,
  type MessageId,
  type ProjectId,
  type SessionId,
} from "../src/core/ids.js";

describe("makeSessionId / makeProjectId / makeMessageId", () => {
  it("accepts a normal UUID-like string", () => {
    const s = makeSessionId("01234567-89ab-cdef-0123-456789abcdef");
    expect(s).toBe("01234567-89ab-cdef-0123-456789abcdef");
  });

  it("accepts a normal project path basename", () => {
    const p = makeProjectId("parallel-burn");
    expect(p).toBe("parallel-burn");
  });

  it("accepts a normal message id", () => {
    const m = makeMessageId("msg_01ABCDEFGHIJKLMNOPQRSTUVWX");
    expect(m).toBe("msg_01ABCDEFGHIJKLMNOPQRSTUVWX");
  });

  it("accepts a 256-char ID (boundary)", () => {
    const longId = "a".repeat(256);
    expect(() => makeSessionId(longId)).not.toThrow();
  });

  it("rejects empty string", () => {
    expect(() => makeSessionId("")).toThrow(InvalidIdError);
    expect(() => makeSessionId("")).toThrow(/must not be empty/);
  });

  it("rejects whitespace on the edges", () => {
    expect(() => makeSessionId(" abc ")).toThrow(/leading\/trailing whitespace/);
    expect(() => makeSessionId("abc ")).toThrow(/leading\/trailing whitespace/);
    expect(() => makeSessionId(" abc")).toThrow(/leading\/trailing whitespace/);
  });

  it("rejects embedded newlines (JSONL-incompatible)", () => {
    expect(() => makeMessageId("abc\ndef")).toThrow(/must not contain newlines/);
    expect(() => makeMessageId("abc\rdef")).toThrow(/must not contain newlines/);
  });

  it("rejects strings longer than 256 chars", () => {
    expect(() => makeProjectId("a".repeat(257))).toThrow(/at most 256/);
  });

  it("rejects non-string values via TypeScript escape hatch", () => {
    // Simulate a JSON.parse'd value where the caller hasn't validated yet.
    const raw: unknown = 42;
    expect(() => makeSessionId(raw as string)).toThrow(InvalidIdError);
    expect(() => makeSessionId(raw as string)).toThrow(/expected string/);
  });

  it("InvalidIdError carries the kind in its message", () => {
    try {
      makeProjectId("");
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidIdError);
      expect((e as Error).message).toContain("ProjectId");
      return;
    }
    throw new Error("expected throw");
  });
});

describe("isSessionId / isProjectId / isMessageId", () => {
  it("narrows valid strings to the typed ID", () => {
    const raw: unknown = "session-abc";
    expect(isSessionId(raw)).toBe(true);
    if (isSessionId(raw)) {
      // Type-level: `raw` is now `SessionId`. Compile-time check.
      const s: SessionId = raw;
      expect(s).toBe("session-abc");
    }
  });

  it("returns false for invalid candidates", () => {
    expect(isSessionId("")).toBe(false);
    expect(isProjectId(undefined)).toBe(false);
    expect(isMessageId(null)).toBe(false);
    expect(isProjectId(42)).toBe(false);
    expect(isMessageId(" leading-space")).toBe(false);
    expect(isSessionId("with\nnewline")).toBe(false);
  });

  it("returns true for boundary-valid IDs", () => {
    expect(isSessionId("a")).toBe(true);
    expect(isProjectId("a".repeat(256))).toBe(true);
  });
});

describe("brand discipline (compile-time)", () => {
  // These assertions exercise that the brands prevent cross-assignment at the
  // type level. The runtime values are all strings, so the assertions below
  // only confirm the runtime values agree; the meaningful check is that the
  // file type-checks under `tsc --noEmit`.
  it("a SessionId cannot be passed where a MessageId is expected", () => {
    const s: SessionId = makeSessionId("s1");
    const m: MessageId = makeMessageId("m1");
    expect(s).not.toBe(m);

    // The following would be a compile error if uncommented:
    // const wrong: MessageId = s;  // ts(2322)
    // accept(s satisfies MessageId);  // also a compile error
  });

  it("a raw string cannot be passed where a ProjectId is expected", () => {
    const p: ProjectId = makeProjectId("parallel-burn");
    expect(p).toBe("parallel-burn");

    // The following would be a compile error if uncommented:
    // const wrong: ProjectId = "parallel-burn";  // ts(2322)
  });
});
