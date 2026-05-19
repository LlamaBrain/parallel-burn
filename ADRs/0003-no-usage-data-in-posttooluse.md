# ADR-0003: PostToolUse Does Not Deliver Token Usage — Tail Transcripts Instead

- **Status:** Accepted
- **Date:** 2026-05-19
- **Spec impact:** [SPEC.md](../SPEC.md) §7.1, §9.1, §10 Phase 3
- **Supersedes:** the data-plane assumption in SPEC.md §9.1

## Context

SPEC.md §9.1 says:

> `PostToolUse` → `post-tool-use.ts`: appends a MessageEvent to the active
> session's JSONL.

with §7.1 specifying that each `MessageEvent` carries a `usage` block with
`input_tokens`, `output_tokens`, `cache_creation_input_tokens`,
`cache_read_input_tokens`, and ephemeral-5m/1h breakdowns.

Verification against the current Claude Code documentation
(<https://code.claude.com/docs/en/hooks.md>) shows that **the `PostToolUse`
hook payload does not include token usage**. Its stdin JSON delivers
`session_id`, `cwd`, `hook_event_name`, `tool_name`, `tool_input`,
`tool_use_id`, `tool_result`, and `tool_result_type` — and that's it. No
`usage` field is exposed on any hook event the documentation describes.

This invalidates the SPEC's data-plane assumption. The product cannot be
built by streaming events from `PostToolUse`.

## Decision

The data plane reads from **Claude Code's transcript JSONL files** instead.
Claude Code persists each session as a JSONL transcript at a stable path
under `~/.claude/projects/<project-hash>/<session-id>.jsonl` (the same files
that tools like ccusage rely on). Each assistant message in the transcript
includes the `usage` block we need.

Concretely, the architecture changes as follows:

1. **`SessionStart` hook** creates a sidecar manifest at
   `~/.parallel-burn/data/sessions/<session-id>.meta.json` recording start
   time, project name, and the path to the Claude Code transcript for this
   session. (Path resolution: use `CLAUDE_PROJECT_DIR` + `session_id` from
   the stdin payload to locate the transcript.)
2. **Periodic poll OR `SessionEnd` finalize.** ParallelBurn does not need
   to stream events live from `PostToolUse`. Instead:
   - The localhost server, when running, tails active transcripts using
     `fs.watch` (or polling fallback on platforms where `fs.watch` is
     unreliable, e.g. networked filesystems).
   - The aggregator and slash commands read transcripts directly on demand.
   - `SessionEnd` triggers a final read-through and writes the summary.
3. **`MessageEvent` shape is unchanged.** ParallelBurn's own JSONL in
   `~/.parallel-burn/data/sessions/<session-id>.jsonl` is now a **derived,
   parallel-burn-owned** projection of the transcript, not a stream of hook
   events. We may eventually drop this file in favor of reading transcripts
   directly — but for now, materializing it gives us a stable schema we
   control and a place to record fields Claude Code's transcripts don't
   carry (e.g., compression-window membership).

The `PostToolUse` hook is *not* removed from the plugin manifest — we still
declare it (with a no-op or a lightweight "touch the manifest's
last-seen-active timestamp" action) so we can know the session is alive
without polling the transcript. But it is no longer the source of usage
data.

## Consequences

- **Phase 3 scope changes.** Instead of "write events to JSONL on
  `PostToolUse`," Phase 3 is "read transcripts, project to our own JSONL or
  serve from transcripts directly." The phase boundary is otherwise the
  same — still tagged `0.1.0`, still the first feature release.
- **No live streaming from a hook.** The overlay's "live" feel is bounded
  by the file-watch latency. Transcripts are appended frequently by Claude
  Code (per assistant turn), so the perceived latency is on the order of
  one assistant turn. Good enough.
- **One dependency: knowing the transcript path.** We rely on the path
  convention `~/.claude/projects/<project-hash>/<session-id>.jsonl`. If
  Claude Code changes that convention, we will need to adapt. This is a
  load-bearing assumption documented in this ADR.
- **No private/undocumented APIs are used.** We read files that Claude Code
  writes for its own purposes; we do not patch its runtime or call internal
  modules. This is the same approach community tools (ccusage et al.) take.
- **Cross-platform path handling required.** `~/.claude/` resolves
  differently on Windows (`%USERPROFILE%\.claude\`). The path resolver lives
  in `src/core/paths.ts` (introduced in Phase 3, not Phase 1).

## Alternatives considered

- **Use a different hook event that *does* carry usage.** No such event
  exists in the documented hook surface. Confirmed against the current
  hooks reference.
- **Wait for Claude Code to expose usage in a hook payload.** This may
  happen, but ParallelBurn cannot block on it. If/when usage becomes
  available on a hook event, we revisit this ADR.
- **Use a Claude API key + parallel API-call telemetry.** Rejected: not all
  Claude Code users operate against the API directly (many use Max
  subscriptions where API keys aren't in play), and instrumenting parallel
  API requests would not capture subscription-driven sessions at all.

## Open questions (resolve in Phase 3)

- Exact path convention for the project-hash component of the transcript
  directory on each OS.
- Whether `fs.watch` is reliable enough on Windows for live tailing, or
  whether we fall back to polling.
- Whether to dedupe between transcript-derived events and any hook-derived
  events, or whether transcripts are the sole truth.
