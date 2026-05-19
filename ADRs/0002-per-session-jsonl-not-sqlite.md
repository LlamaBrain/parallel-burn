# ADR-0002: Per-Session JSONL, not SQLite

- **Status:** Accepted
- **Date:** 2026-05-19
- **Spec reference:** [SPEC.md](../SPEC.md) §5, §7

## Context

ParallelBurn must record one event per Claude Code tool use (or per assistant
turn — see Phase 3 for the final hook choice). Multiple Claude Code processes
can be running on the same machine at the same time; that's not an edge case,
it's the whole point of the product (the "compression ratio" headline metric
counts on it).

We need a storage layer that:

1. Survives crashes mid-write without corrupting prior events.
2. Tolerates many concurrent writers from independent OS processes.
3. Does not require a long-running coordinator.
4. Can be read by an aggregator without locking out writers.
5. Stays inspectable by hand (grep, `jq`, plain text editors).

## Decision

Every Claude Code session gets **its own append-only JSONL file** at:

```
~/.parallel-burn/data/sessions/<session-id>.jsonl
```

Plus a sidecar manifest:

```
~/.parallel-burn/data/sessions/<session-id>.meta.json
```

The manifest is written once at `SessionStart` (atomic tmp-file-and-rename)
and updated once at `SessionEnd` (same pattern). The JSONL is opened with
`O_APPEND`, one `write(2)` per event, then closed. No file is ever rewritten.

Aggregation is a directory walk: list `*.jsonl`, parse line-by-line, filter
by timestamp range, sum.

## Consequences

- **Zero write contention between sessions.** Each Claude Code process owns
  its own file. Two parallel hook invocations in the same session are still
  safe because POSIX `O_APPEND` guarantees atomicity for writes ≤ `PIPE_BUF`
  (4096 bytes on Linux, similar on macOS; Windows `FILE_APPEND_DATA` provides
  equivalent semantics). Every `MessageEvent` line is well under that limit.
- **Corruption blast radius is one line.** If a process is killed mid-write,
  at worst a single JSONL line is truncated. The aggregator skips malformed
  lines with a warning rather than aborting.
- **Storage is grep-friendly.** Power users can answer ad-hoc questions
  ("which sessions today used Opus?") with one-liners. This is part of the
  product's appeal to the audience.
- **Aggregation cost scales linearly.** At the expected scale (≤ ~10k events
  per day for the heaviest user), full re-aggregation is sub-second. If that
  ceases to be true, we add a derived index — but not until we have evidence.
- **No schema migration tooling required for v1.** Each event line includes
  `schema_version`. When v2 ships, the aggregator can either translate v1
  lines on the fly or refuse them with a clear message; the choice gets its
  own ADR.

## Alternatives considered

### SQLite with WAL

The standard "small structured storage" answer. Rejected for ParallelBurn:

- WAL mode handles single-process concurrent readers + one writer well. It does
  *not* handle many concurrent writers from independent OS processes elegantly.
  Each writer must acquire and release the WAL lock, which serializes hook
  invocations across sessions. With many parallel Claude Code instances, this
  is contention we shouldn't pay for.
- The alternative — a long-running ParallelBurn daemon that owns the DB and
  marshals writes from hooks via IPC — adds a whole class of failure modes
  (daemon crash, daemon-not-running, IPC misconfiguration). For a tool whose
  job is to be invisibly reliable, that's a poor trade.
- SQLite is inspectable, but less so than JSONL. `jq` works on JSONL; you need
  `sqlite3` to read SQLite.

### Single JSONL file with `O_APPEND` from all processes

Tempting because POSIX `O_APPEND` is atomic for small writes — multiple
processes could safely append to one file. Rejected because:

- Garbage collection (drop events older than N days) requires rewriting the
  whole file, which conflicts with concurrent appends.
- A single corrupt line affects every consumer.
- Per-session lifecycle (clean shutdown, summary generation) becomes
  awkward — the writer doesn't know when its session has "ended."

### A purpose-built binary log (e.g., Bitcask, RocksDB)

Massive overkill for ≤ ~10k events per day per user.

## Migration path

If we ever change the event schema or storage format, the cutover is:

1. Bump `schema_version` in `MessageEvent`.
2. Aggregator gains a translator (or a refusal with a clear error) for the old
   version.
3. Document the cutover in a new ADR.

No data migration tooling is shipped in v1. We expect schema stability through
v1.0.
