import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  iterateTranscript,
  readTranscript,
  tryProjectLine,
} from "../src/core/transcript.js";

let tmp: string;
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "parallel-burn-transcript-"));
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

const ASSISTANT_LINE = JSON.stringify({
  type: "assistant",
  sessionId: "01999999-aaaa-bbbb-cccc-deadbeefcafe",
  cwd: "E:\\Personal\\parallel-burn",
  timestamp: "2026-05-19T16:46:51.378Z",
  message: {
    id: "msg_01JBZSAFdvovi8i2sVs9WYDM",
    model: "claude-opus-4-7",
    usage: {
      input_tokens: 6,
      output_tokens: 526,
      cache_creation_input_tokens: 16778,
      cache_read_input_tokens: 21400,
      cache_creation: {
        ephemeral_5m_input_tokens: 0,
        ephemeral_1h_input_tokens: 16778,
      },
    },
  },
});

const ATTACHMENT_LINE = JSON.stringify({
  type: "attachment",
  sessionId: "ea18583d-d084-4a30-a186-c8c4c08bb739",
});

const USER_LINE = JSON.stringify({
  type: "user",
  sessionId: "ea18583d-d084-4a30-a186-c8c4c08bb739",
});

describe("tryProjectLine", () => {
  it("projects a well-formed assistant line into a MessageEvent", () => {
    const event = tryProjectLine(ASSISTANT_LINE);
    expect(event).not.toBeNull();
    expect(event?.model).toBe("claude-opus-4-7");
    expect(event?.session_id).toBe("01999999-aaaa-bbbb-cccc-deadbeefcafe");
    expect(event?.message_id).toBe("msg_01JBZSAFdvovi8i2sVs9WYDM");
    expect(event?.project).toBe("parallel-burn");
    expect(event?.usage.input_tokens).toBe(6);
    expect(event?.usage.output_tokens).toBe(526);
    expect(event?.usage.cache_read_input_tokens).toBe(21400);
    expect(event?.usage.cache_creation.ephemeral_1h_input_tokens).toBe(16778);
    expect(event?.usage.cache_creation.ephemeral_5m_input_tokens).toBe(0);
  });

  it("returns null for non-assistant record types", () => {
    expect(tryProjectLine(ATTACHMENT_LINE)).toBeNull();
    expect(tryProjectLine(USER_LINE)).toBeNull();
  });

  it("returns null for blank lines", () => {
    expect(tryProjectLine("")).toBeNull();
    expect(tryProjectLine("   ")).toBeNull();
  });

  it("returns null for malformed JSON (does not throw)", () => {
    expect(tryProjectLine("{not valid json")).toBeNull();
    expect(tryProjectLine("[]")).toBeNull(); // top-level array
  });

  it("returns null when the assistant message is missing a usage block", () => {
    const noUsage = JSON.stringify({
      type: "assistant",
      sessionId: "abc",
      cwd: "E:\\foo",
      timestamp: "2026-05-19T16:46:51.378Z",
      message: { id: "msg_x", model: "claude-opus-4-7" },
    });
    expect(tryProjectLine(noUsage)).toBeNull();
  });

  it("returns null when fields are missing or wrong-typed", () => {
    const base = {
      type: "assistant",
      sessionId: "s",
      cwd: "c",
      timestamp: "t",
      message: { id: "msg_x", model: "x", usage: {} },
    };
    const cases: unknown[] = [
      { type: "assistant" }, // no message
      { ...base, message: { id: "msg_x", model: "x" } }, // no usage
      { ...base, message: { id: 42, model: "x", usage: {} } }, // bad message_id
      { ...base, message: { id: "msg_x", model: "", usage: {} } }, // empty model
      { ...base, message: { id: "msg_x", model: 7, usage: {} } }, // non-string model
      { ...base, timestamp: 42 }, // non-string timestamp
      { ...base, cwd: "" }, // empty cwd
      { ...base, cwd: 42 }, // non-string cwd
      { ...base, sessionId: "" }, // empty session
      { ...base, sessionId: 42 }, // non-string session
      { ...base, message: { id: "", model: "x", usage: {} } }, // empty message id
      "primitive string", // top-level non-object
      42, // top-level number
    ];
    for (const c of cases) {
      expect(tryProjectLine(JSON.stringify(c))).toBeNull();
    }
  });

  it("returns null when basename(cwd) is invalid as a ProjectId", () => {
    // basename("/") on POSIX is "", which fails isProjectId.
    const bad = JSON.stringify({
      type: "assistant",
      sessionId: "s-x",
      cwd: "/",
      timestamp: "t",
      message: { id: "msg_x", model: "x", usage: {} },
    });
    expect(tryProjectLine(bad)).toBeNull();
  });

  it("defaults missing usage fields to 0, never NaN", () => {
    const partial = JSON.stringify({
      type: "assistant",
      sessionId: "s-x",
      cwd: "/tmp/foo",
      timestamp: "t",
      message: {
        id: "msg_x",
        model: "claude-haiku-4-5",
        usage: { input_tokens: 10 },
      },
    });
    const event = tryProjectLine(partial);
    expect(event).not.toBeNull();
    expect(event?.usage.input_tokens).toBe(10);
    expect(event?.usage.output_tokens).toBe(0);
    expect(event?.usage.cache_creation.ephemeral_5m_input_tokens).toBe(0);
  });

  it("rejects negative usage values silently (treats as 0)", () => {
    const negative = JSON.stringify({
      type: "assistant",
      sessionId: "s-x",
      cwd: "/tmp/foo",
      timestamp: "t",
      message: {
        id: "msg_x",
        model: "claude-haiku-4-5",
        usage: { input_tokens: -100, output_tokens: 50 },
      },
    });
    const event = tryProjectLine(negative);
    expect(event?.usage.input_tokens).toBe(0);
    expect(event?.usage.output_tokens).toBe(50);
  });
});

describe("readTranscript / iterateTranscript", () => {
  it("reads only assistant lines from a mixed-type transcript", async () => {
    const path = join(tmp, "session.jsonl");
    await writeFile(
      path,
      [
        USER_LINE,
        ATTACHMENT_LINE,
        ASSISTANT_LINE,
        "",
        "{garbage}",
        ASSISTANT_LINE,
      ].join("\n") + "\n",
      "utf8",
    );
    const events = await readTranscript(path);
    expect(events).toHaveLength(2);
    expect(events.every((e) => e.model === "claude-opus-4-7")).toBe(true);
  });

  it("iterateTranscript yields the same events as readTranscript", async () => {
    const path = join(tmp, "session.jsonl");
    await writeFile(path, [ASSISTANT_LINE, ASSISTANT_LINE, ASSISTANT_LINE].join("\n"), "utf8");
    const collected = [];
    for await (const e of iterateTranscript(path)) collected.push(e);
    const direct = await readTranscript(path);
    expect(collected).toEqual(direct);
    expect(collected).toHaveLength(3);
  });

  it("returns an empty array for an empty file", async () => {
    const path = join(tmp, "empty.jsonl");
    await writeFile(path, "", "utf8");
    expect(await readTranscript(path)).toEqual([]);
  });

  it("survives a transcript where the final line lacks a trailing newline", async () => {
    const path = join(tmp, "nofinalnl.jsonl");
    await writeFile(path, ASSISTANT_LINE, "utf8");
    expect(await readTranscript(path)).toHaveLength(1);
  });
});
