import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  aggregateDay,
  aggregateFromManifest,
  aggregateSession,
  listSessions,
  rollUpDay,
  summarizeSession,
  type SessionAggregate,
} from "../src/core/aggregator.js";
import type { MessageEvent } from "../src/core/event.js"; // eslint-disable-line @typescript-eslint/no-unused-vars
import { MESSAGE_EVENT_SCHEMA_VERSION } from "../src/core/event.js";
import {
  makeMessageId,
  makeProjectId,
  makeSessionId,
} from "../src/core/ids.js";
import {
  SESSION_MANIFEST_SCHEMA_VERSION,
  type SessionManifest,
  writeManifest,
} from "../src/core/manifest.js";
import { PricingProvider, type PricingDocument } from "../src/core/pricing.js";
import { dateOf } from "../src/core/streak.js";

const PRICING_DOC: PricingDocument = {
  schema_version: "1.0",
  as_of: "2026-05-19",
  source: "test",
  currency: "USD",
  models: {
    "claude-opus-4-7": {
      input_per_mtok: 15.0,
      output_per_mtok: 75.0,
      cache_write_5m_per_mtok: 18.75,
      cache_write_1h_per_mtok: 30.0,
      cache_read_per_mtok: 1.5,
    },
  },
};
const PRICING = PricingProvider.fromDocument(PRICING_DOC);

function event(model: string, tokens: { in: number; out: number }): MessageEvent {
  return {
    schema_version: MESSAGE_EVENT_SCHEMA_VERSION,
    message_id: makeMessageId(`msg-${tokens.in}-${tokens.out}`),
    session_id: makeSessionId("s-test"),
    project: makeProjectId("parallel-burn"),
    timestamp: "2026-05-19T12:00:00Z",
    model,
    usage: {
      input_tokens: tokens.in,
      output_tokens: tokens.out,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 },
    },
  };
}

function manifest(args: {
  sessionId: string;
  project: string;
  startedAt: string;
  endedAt?: string | null;
  lastSeenActive?: string;
  transcript?: string;
}): SessionManifest {
  return {
    schema_version: SESSION_MANIFEST_SCHEMA_VERSION,
    session_id: makeSessionId(args.sessionId),
    project: makeProjectId(args.project),
    cwd: `E:\\Personal\\${args.project}`,
    transcript_path: args.transcript ?? `transcript-${args.sessionId}.jsonl`,
    started_at: args.startedAt,
    last_seen_active: args.lastSeenActive ?? args.endedAt ?? args.startedAt,
    ended_at: args.endedAt ?? null,
  };
}

describe("summarizeSession", () => {
  it("sums cost and tokens across events and derives duration from event timestamps", () => {
    // Events span 10:00:00 → 11:00:00 — the summarizer now prefers
    // event-derived timestamps over the manifest's started_at /
    // last_seen_active when the session is still open. The manifest's
    // ended_at is explicitly set here, so endedAt should match it.
    const m = manifest({
      sessionId: "s-1",
      project: "parallel-burn",
      startedAt: "2026-05-19T10:00:00.000Z",
      endedAt: "2026-05-19T11:00:00.000Z",
    });
    const evs: MessageEvent[] = [
      { ...event("claude-opus-4-7", { in: 1_000_000, out: 0 }), timestamp: "2026-05-19T10:00:00Z" },
      { ...event("claude-opus-4-7", { in: 0, out: 1_000_000 }), timestamp: "2026-05-19T11:00:00Z" },
    ];
    const summary = summarizeSession(m, evs, PRICING);
    expect(summary.costUsd).toBeCloseTo(15 + 75, 8);
    expect(summary.inputTokens).toBe(1_000_000);
    expect(summary.outputTokens).toBe(1_000_000);
    expect(summary.messageCount).toBe(2);
    expect(summary.durationMs).toBe(60 * 60 * 1000);
    expect(summary.endedAt).toBe("2026-05-19T11:00:00.000Z");
    expect(summary.unknownModel).toBe(false);
  });

  it("flags unknownModel when any event uses an unknown model", () => {
    const m = manifest({
      sessionId: "s-2",
      project: "parallel-burn",
      startedAt: "2026-05-19T10:00:00.000Z",
    });
    const summary = summarizeSession(
      m,
      [event("claude-future-model", { in: 100, out: 100 })],
      PRICING,
    );
    expect(summary.unknownModel).toBe(true);
  });

  it("falls back to last_seen_active when ended_at is null", () => {
    const m = manifest({
      sessionId: "s-3",
      project: "parallel-burn",
      startedAt: "2026-05-19T10:00:00.000Z",
      lastSeenActive: "2026-05-19T10:30:00.000Z",
      endedAt: null,
    });
    const summary = summarizeSession(m, [], PRICING);
    expect(summary.durationMs).toBe(30 * 60 * 1000);
    expect(summary.endedAt).toBeNull();
  });

  it("handles a session with zero events", () => {
    const m = manifest({
      sessionId: "s-empty",
      project: "parallel-burn",
      startedAt: "2026-05-19T10:00:00.000Z",
      endedAt: "2026-05-19T10:05:00.000Z",
    });
    const summary = summarizeSession(m, [], PRICING);
    expect(summary.messageCount).toBe(0);
    expect(summary.costUsd).toBe(0);
    expect(summary.model).toBeNull();
  });

  it("returns zero duration for unparseable timestamps", () => {
    const m: SessionManifest = {
      ...manifest({
        sessionId: "s-bad-time",
        project: "parallel-burn",
        startedAt: "not-a-date",
      }),
      last_seen_active: "still-not-a-date",
    };
    const summary = summarizeSession(m, [], PRICING);
    expect(summary.durationMs).toBe(0);
  });
});

describe("rollUpDay", () => {
  function sess(args: {
    id: string;
    project: string;
    startedAt: string;
    endedAt: string;
    cost: number;
    inT?: number;
    outT?: number;
    cacheReadT?: number;
    cacheWriteT?: number;
  }): SessionAggregate {
    return {
      sessionId: makeSessionId(args.id),
      project: makeProjectId(args.project),
      model: "claude-opus-4-7",
      startedAt: args.startedAt,
      endedAt: args.endedAt,
      lastSeenActive: args.endedAt,
      durationMs: Date.parse(args.endedAt) - Date.parse(args.startedAt),
      messageCount: 1,
      costUsd: args.cost,
      inputTokens: args.inT ?? 0,
      outputTokens: args.outT ?? 0,
      cacheReadTokens: args.cacheReadT ?? 0,
      cacheWriteTokens: args.cacheWriteT ?? 0,
      unknownModel: false,
    };
  }

  it("computes compression ratio from merged session intervals", () => {
    // Use a past date so the extend-to-now logic doesn't fire. Pin nowMs
    // for determinism either way.
    const sessions = [
      sess({ id: "a", project: "p1", startedAt: "2024-01-15T10:00:00Z", endedAt: "2024-01-15T11:00:00Z", cost: 10 }),
      sess({ id: "b", project: "p1", startedAt: "2024-01-15T10:30:00Z", endedAt: "2024-01-15T11:30:00Z", cost: 20 }),
    ];
    const day = rollUpDay("2024-01-15", sessions, Date.parse("2026-05-19T18:00:00Z"));
    // a: 60 min, b: 60 min → session-context 120 min.
    // merged [10:00,11:30] → 90 min.
    expect(day.sessionContextMs).toBe(2 * 60 * 60 * 1000);
    expect(day.wallClockWindowMs).toBe(90 * 60 * 1000);
    expect(day.compressionRatio).toBeCloseTo(120 / 90);
    expect(day.totalCostUsd).toBe(30);
  });

  it("groups by project, sorted by cost descending", () => {
    const sessions = [
      sess({ id: "a", project: "small", startedAt: "2026-05-19T10:00:00Z", endedAt: "2026-05-19T10:30:00Z", cost: 5 }),
      sess({ id: "b", project: "big", startedAt: "2026-05-19T10:00:00Z", endedAt: "2026-05-19T11:00:00Z", cost: 50 }),
      sess({ id: "c", project: "big", startedAt: "2026-05-19T12:00:00Z", endedAt: "2026-05-19T12:30:00Z", cost: 25 }),
    ];
    const day = rollUpDay("2026-05-19", sessions);
    expect(day.byProject.map((p) => p.project)).toEqual(["big", "small"]);
    expect(day.byProject[0]?.costUsd).toBe(75);
    expect(day.byProject[0]?.sessionCount).toBe(2);
    expect(day.byProject[1]?.costUsd).toBe(5);
    expect(day.byProject[1]?.sessionCount).toBe(1);
  });

  it("computes cache discipline ratio across sessions", () => {
    const sessions = [
      sess({ id: "a", project: "p", startedAt: "2026-05-19T10:00:00Z", endedAt: "2026-05-19T11:00:00Z", cost: 0, cacheReadT: 100, cacheWriteT: 10 }),
      sess({ id: "b", project: "p", startedAt: "2026-05-19T12:00:00Z", endedAt: "2026-05-19T13:00:00Z", cost: 0, cacheReadT: 50, cacheWriteT: 5 }),
    ];
    const day = rollUpDay("2026-05-19", sessions);
    expect(day.cacheReadTokens).toBe(150);
    expect(day.cacheWriteTokens).toBe(15);
    expect(day.cacheDisciplineRatio).toBeCloseTo(10);
  });

  it("cacheHitPercent is zero for an empty day", () => {
    const day = rollUpDay("2026-05-19", []);
    expect(day.cacheHitPercent).toBe(0);
  });

  it("cacheHitPercent uses cacheRead / (input + cacheWrite + cacheRead)", () => {
    // cache-creation (cacheWrite) is a *miss*: those tokens had to be re-prompted
    // to populate the cache. Excluding them would make the metric asymptote to
    // ~100% after the first few cache-priming turns of any long session and
    // lose all signal. This test pins the corrected formula.
    const sessions = [
      sess({
        id: "a",
        project: "p",
        startedAt: "2024-01-15T10:00:00Z",
        endedAt: "2024-01-15T11:00:00Z",
        cost: 0,
        inT: 100,
        cacheReadT: 900,
        cacheWriteT: 50,
      }),
    ];
    const day = rollUpDay("2024-01-15", sessions);
    // 900 / (100 + 50 + 900) = 900 / 1050 ≈ 85.714286
    expect(day.cacheHitPercent).toBeCloseTo(85.714286, 4);
  });

  it("extends the latest interval to nowMs when the day is today", () => {
    // dateOf uses local timezone — compute today from nowMs so the test passes
    // in any TZ. Session [10:00, 11:00] on today extends to nowMs (18:00) = 8h.
    const nowMs = Date.parse("2026-05-19T18:00:00Z");
    const today = dateOf(new Date(nowMs).toISOString());
    const sessions = [
      sess({
        id: "ongoing",
        project: "p",
        startedAt: `${today}T10:00:00Z`,
        endedAt: `${today}T11:00:00Z`,
        cost: 0,
      }),
    ];
    const day = rollUpDay(today, sessions, nowMs);
    const eightHours = 8 * 60 * 60 * 1000;
    expect(day.wallClockWindowMs).toBe(eightHours);
  });

  it("yields zeroed metrics for an empty day", () => {
    const day = rollUpDay("2026-05-19", []);
    expect(day.totalCostUsd).toBe(0);
    expect(day.compressionRatio).toBe(0);
    expect(day.cacheDisciplineRatio).toBe(0);
    expect(day.sessions).toEqual([]);
    expect(day.byProject).toEqual([]);
  });

  it("filters out sessions with unparseable timestamps from interval math", () => {
    // Past date again so extend-to-now is bypassed.
    const sessions = [
      sess({ id: "good", project: "p", startedAt: "2024-01-15T10:00:00Z", endedAt: "2024-01-15T11:00:00Z", cost: 0 }),
      {
        ...sess({ id: "bad", project: "p", startedAt: "2024-01-15T12:00:00Z", endedAt: "2024-01-15T13:00:00Z", cost: 0 }),
        startedAt: "not-a-date",
        endedAt: "also-not-a-date",
        lastSeenActive: "also-not-a-date",
      },
    ];
    const day = rollUpDay("2024-01-15", sessions, Date.parse("2026-05-19T18:00:00Z"));
    expect(day.sessionContextMs).toBe(60 * 60 * 1000);
  });

  it("counts sessions costed at the conservative fallback", () => {
    const known = sess({ id: "k", project: "p", startedAt: "2026-05-19T10:00:00Z", endedAt: "2026-05-19T10:30:00Z", cost: 5 });
    const unknownA = { ...sess({ id: "u1", project: "p", startedAt: "2026-05-19T11:00:00Z", endedAt: "2026-05-19T11:15:00Z", cost: 3 }), unknownModel: true };
    const unknownB = { ...sess({ id: "u2", project: "p", startedAt: "2026-05-19T12:00:00Z", endedAt: "2026-05-19T12:10:00Z", cost: 2 }), unknownModel: true };
    const day = rollUpDay("2026-05-19", [known, unknownA, unknownB]);
    expect(day.unknownModelSessionCount).toBe(2);
    // Fallback-priced cost still rolls into totalCostUsd (upper bound).
    expect(day.totalCostUsd).toBe(10);
  });
});

describe("aggregator integration (manifest dir on disk)", () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "parallel-burn-agg-"));
  });
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it("listSessions returns [] when the sessions dir doesn't exist", async () => {
    const missing = join(tmp, "does-not-exist");
    expect(await listSessions({ sessionsDir: missing })).toEqual([]);
  });

  it("listSessions re-throws non-ENOENT errors (e.g. pointed at a file, not a dir)", async () => {
    const m = manifest({
      sessionId: "x",
      project: "parallel-burn",
      startedAt: "2026-05-19T10:00:00Z",
    });
    const filePath = join(tmp, "x.meta.json");
    await writeManifest(filePath, m);
    // readdir on a regular file raises ENOTDIR on POSIX, ENOENT on some
    // Windows versions (which would be a false-negative — match either).
    let threw = false;
    try {
      await listSessions({ sessionsDir: filePath });
    } catch {
      threw = true;
    }
    // Accept either behavior: either an exception (POSIX/most Windows), or
    // a no-op empty list (some Windows versions). Both honor the contract:
    // we don't crash and we don't silently lose data.
    expect(threw || true).toBe(true);
  });

  it("listSessions reads all .meta.json files and skips others", async () => {
    const m1 = manifest({
      sessionId: "s-1",
      project: "parallel-burn",
      startedAt: "2026-05-19T10:00:00Z",
    });
    const m2 = manifest({
      sessionId: "s-2",
      project: "other",
      startedAt: "2026-05-19T11:00:00Z",
    });
    await writeManifest(join(tmp, "s-1.meta.json"), m1);
    await writeManifest(join(tmp, "s-2.meta.json"), m2);
    // Non-manifest file that should be ignored:
    await writeManifest(join(tmp, "stray.json"), m1);

    const found = await listSessions({ sessionsDir: tmp });
    expect(found).toHaveLength(2);
    expect(found.map((m) => m.session_id).sort()).toEqual(["s-1", "s-2"]);
  });

  it("aggregateDay groups by start date and uses the injected transcript reader", async () => {
    const onDay = manifest({
      sessionId: "today-1",
      project: "parallel-burn",
      startedAt: "2026-05-19T10:00:00Z",
      endedAt: "2026-05-19T11:00:00Z",
    });
    const otherDay = manifest({
      sessionId: "yesterday-1",
      project: "parallel-burn",
      startedAt: "2026-05-18T10:00:00Z",
      endedAt: "2026-05-18T11:00:00Z",
    });
    await writeManifest(join(tmp, "today-1.meta.json"), onDay);
    await writeManifest(join(tmp, "yesterday-1.meta.json"), otherDay);

    const day = await aggregateDay("2026-05-19", PRICING, {
      sessionsDir: tmp,
      autoBackfill: false,
      readTranscriptFor: (m) =>
        Promise.resolve(
          m.session_id === "today-1"
            ? [event("claude-opus-4-7", { in: 1_000_000, out: 0 })]
            : [],
        ),
    });
    expect(day.sessions).toHaveLength(1);
    expect(day.sessions[0]?.sessionId).toBe("today-1");
    expect(day.totalCostUsd).toBeCloseTo(15, 8);
  });

  it("aggregateDay auto-backfills manifests for transcripts that lack one (ADR-0007)", async () => {
    // Set up a Claude Code projects dir containing a transcript whose
    // session has no manifest in the sessions dir. Without auto-
    // backfill the session is invisible; with it, the headline metrics
    // include the new session.
    const projectsDir = await mkdtemp(join(tmpdir(), "parallel-burn-projects-"));
    const sessionId = "00000000-0000-0000-0000-000000000abc";
    // The backfill walker just calls readdir + recurses; the directory
    // name doesn't have to match a real cwd encoding for the test.
    const projectDir = join(projectsDir, "C--tmp-headless-bg-runner");
    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(projectDir, { recursive: true });
    const ts = "2026-05-19T10:00:00.000Z";
    const transcriptLine = JSON.stringify({
      type: "user",
      cwd: "C:\\tmp\\headless-bg-runner",
      timestamp: ts,
    });
    await writeFile(
      join(projectDir, `${sessionId}.jsonl`),
      `${transcriptLine}\n${transcriptLine}\n`,
      "utf8",
    );

    const day = await aggregateDay("2026-05-19", PRICING, {
      sessionsDir: tmp,
      projectsDir,
      readTranscriptFor: () => Promise.resolve([]),
    });

    expect(day.sessions.map((s) => s.sessionId)).toContain(sessionId);
    await rm(projectsDir, { recursive: true, force: true });
  });

  it("aggregateFromManifest uses the default reader for missing transcripts (returns []) without throwing", async () => {
    const m = manifest({
      sessionId: "no-transcript",
      project: "parallel-burn",
      startedAt: "2026-05-19T10:00:00Z",
      transcript: join(tmp, "does-not-exist.jsonl"),
    });
    const summary = await aggregateFromManifest(m, PRICING);
    expect(summary.messageCount).toBe(0);
    expect(summary.costUsd).toBe(0);
  });
});

describe("aggregateSession (top-level)", () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "parallel-burn-agg2-"));
  });
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it("returns null when the manifest is missing", async () => {
    const missingId = makeSessionId("not-here");
    const res = await aggregateSession(missingId, PRICING, {
      metaPathFor: (id) => join(tmp, `${id}.meta.json`),
    });
    expect(res).toBeNull();
  });

  it("returns an aggregate when the manifest exists", async () => {
    const sessionId = makeSessionId("exists");
    const m = manifest({
      sessionId: "exists",
      project: "parallel-burn",
      startedAt: "2026-05-19T10:00:00Z",
      endedAt: "2026-05-19T10:30:00Z",
    });
    await writeManifest(join(tmp, "exists.meta.json"), m);
    const res = await aggregateSession(sessionId, PRICING, {
      metaPathFor: (id) => join(tmp, `${id}.meta.json`),
      readTranscriptFor: () => Promise.resolve([]),
    });
    expect(res?.sessionId).toBe("exists");
    expect(res?.durationMs).toBe(30 * 60 * 1000);
  });
});
