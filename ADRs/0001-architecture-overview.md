# ADR-0001: Architecture Overview

- **Status:** Accepted
- **Date:** 2026-05-19
- **Spec reference:** [SPEC.md](../SPEC.md) §5–§9

## Context

ParallelBurn is a Claude Code plugin that captures per-message usage data from
parallel Claude Code sessions on a single operator's machine, computes
parallelism/cache/cost metrics, and surfaces them via slash commands, an
end-of-session summary, and a localhost overlay for OBS.

The threat model is single-user, single-machine: no untrusted network, no
multi-tenant concerns, no shared state with other operators. The hardest
constraint is that **multiple Claude Code processes can be writing data
concurrently**, because the operator's whole pitch (and the headline
"compression ratio" metric) is parallel sessions.

## Decision

The architecture is organized around four layers:

1. **Hook scripts (`src/hooks/`).** Short, idempotent Node entrypoints invoked
   by Claude Code on `SessionStart`, `PostToolUse`, and `SessionEnd`. Each
   does the minimum work needed to record an event and exits. No long-running
   state.
2. **Pure core (`src/core/`).** Stateless, side-effect-free modules: typed IDs,
   `PricingProvider`, cost calculator, compression-ratio math, streak detection,
   summary rendering. 100 % test coverage required. These modules know nothing
   about Claude Code, hooks, or the filesystem layout.
3. **Aggregator (`src/core/aggregator.ts`).** Walks the on-disk JSONL session
   files, builds the daily aggregate, and feeds metrics to consumers.
4. **Presentation (`src/commands/`, `src/server/`).** Slash commands, the
   localhost HTTP/WebSocket broadcaster, and the bundled OBS browser-source
   overlay.

The runtime is **Node 22+ in TypeScript `--strict`**, with `verbatimModuleSyntax`
and `noUncheckedIndexedAccess` on. Tests are **Vitest**. Linting is
`@typescript-eslint/recommended-type-checked`. The HTTP server is built on the
**Node standard library only** (`node:http`, `node:ws` via a tiny WS shim or a
single dependency — TBD in Phase 7).

Storage is **append-only JSONL, one file per session**, under
`~/.parallel-burn/data/sessions/<session-id>.jsonl`. The rationale is
documented in [ADR-0002](./0002-per-session-jsonl-not-sqlite.md).

## Consequences

- **No long-running daemon required for correctness.** The localhost server
  exists only to serve overlay consumers; the data plane works without it.
- **Parallel sessions never contend.** Per-session files mean each Claude Code
  process owns its own file handle. No locking, no WAL, no transaction
  semantics needed.
- **Aggregator is `O(N)` in events per query.** Acceptable because the
  expected volume is a few thousand events per day, even for a power user
  running many parallel sessions.
- **Migration cost is non-zero.** If we ever want sub-second queries across
  months of history, we will need a derived index. That's deferred until
  there's evidence we need it. See SPEC.md §14.
- **Pure-core discipline.** Because `src/core/` is side-effect-free, every
  metric is independently testable with table-driven cases. This is also why
  the SPEC requires 100 % coverage there.

## Alternatives considered

- **A long-running daemon that owns all writes.** Rejected: introduces a new
  failure mode (daemon crash loses data) and a coordination problem (when do
  Claude Code processes start/stop the daemon). The whole product hinges on
  zero-friction observability — a daemon that can fail to start is the wrong
  default.
- **In-process aggregation, no on-disk persistence.** Rejected: would not
  survive a Claude Code restart, and would prevent the cross-session
  aggregates that drive the streak and daily-summary outputs.
- **A heavyweight framework (Express + better-sqlite3).** Rejected as
  unnecessary complexity for a single-machine, localhost-only plugin.
