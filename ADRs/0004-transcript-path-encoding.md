# ADR-0004: Claude Code Transcript Path Encoding

- **Status:** Accepted
- **Date:** 2026-05-19
- **Resolves:** open question in [ADR-0003](./0003-no-usage-data-in-posttooluse.md)

## Context

ADR-0003 commits ParallelBurn to reading Claude Code's transcript JSONLs as
the source of truth for token usage (since `PostToolUse` hooks do not carry
usage data). That requires resolving a session's transcript file path from
its `(cwd, session_id)` pair.

Claude Code persists transcripts under `~/.claude/projects/<encoded-cwd>/`,
where the directory name is derived from the working directory. The exact
encoding is undocumented in the public reference; this ADR pins it down by
direct observation on the operator's machine and freezes ParallelBurn's
contract against the rule we observed.

## Observed encoding

Replace each occurrence of `:`, `\`, `/`, or `.` in the absolute working
directory path with a single `-`. No other transformation.

Verified cases:

| Working directory                                              | Encoded directory name                                              |
| -------------------------------------------------------------- | ------------------------------------------------------------------- |
| `E:\Personal\parallel-burn`                                    | `E--Personal-parallel-burn`                                         |
| `C:\Users\metag\.claude-mem\observer\sessions`                 | `C--Users-metag--claude-mem-observer-sessions`                      |
| `E:\Personal\dirigible2D\Assets\.Dirigible-Media\Documentation\Plan` | `E--Personal-dirigible2D-Assets--Dirigible-Media-Documentation-Plan` |

The same rule applied to a POSIX path:

| Working directory                | Encoded directory name        |
| -------------------------------- | ----------------------------- |
| `/Users/metag/code/foo`          | `-Users-metag-code-foo`       |
| `/home/user/.config/app`         | `-home-user--config-app`      |

Inside that directory, each session's transcript is at
`<session-uuid>.jsonl`. ParallelBurn consumes only `<session-uuid>.jsonl`;
the sibling `<session-uuid>/` subdirectory and `memory/` directory observed
in the same parent are Claude Code's own state and not read.

## Decision

`src/core/paths.ts` ships:

```ts
export function encodeProjectDirName(cwd: string): string {
  return cwd.replace(/[:\\/.]/g, "-");
}

export function claudeCodeTranscriptPath(cwd: string, sessionId: SessionId): string {
  return join(homedir(), ".claude", "projects", encodeProjectDirName(cwd), `${sessionId}.jsonl`);
}
```

This is the **sole** assumption ParallelBurn makes about Claude Code's
on-disk layout. If Claude Code changes the encoding, the breakage will be
localized to `paths.ts` and the related tests, and we will issue a follow-up
ADR + a `paths.ts` fix.

## Consequences

- **One load-bearing dependency on an undocumented convention.** Acceptable
  given that the community has independently converged on this assumption
  (ccusage and similar tools encode the same way) and the spec already
  accepted a transcript-based data plane in ADR-0003.
- **No runtime probing.** We do not stat the transcript directory to confirm
  the encoding at install time. If a future Claude Code release changes the
  rule, ParallelBurn will silently produce empty results until updated. The
  `/parallel-burn` command's "no transcript found" path surfaces this to
  the user clearly enough for them to file a bug.
- **Cross-platform symmetry.** The same rule encodes Windows backslashes
  and POSIX forward slashes identically, so no per-OS branching is needed
  in the encoder.

## Alternatives considered

- **Recursive scan of `~/.claude/projects/*/<session-id>.jsonl`.** Works
  without knowing the encoding, but it's `O(N_projects)` per resolve and
  introduces a race against Claude Code's own writes. Rejected as
  unnecessary given the encoding rule is stable and inexpensive to encode.
- **Recording the resolved transcript path at SessionStart.** Avoids the
  encoding dependency at lookup time, but still requires the encoding rule
  to resolve at SessionStart. Defers the problem rather than solving it.
  Worth doing additionally — see Phase 3 — but not as a replacement.
