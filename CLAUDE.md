# CLAUDE.md — In-Session Context for ParallelBurn

You are working on ParallelBurn, a Claude Code plugin. This file is the *ongoing context* for sessions in this repo.

**Read [SPEC.md](./SPEC.md) first if you have not.** It is the source of truth for the design. This file (CLAUDE.md) is the shorter, working-context reminder; SPEC.md is the full specification.

## Current phase

Phase 0 (skeleton) — **complete**. The skeleton includes:

- Full top-level scaffold (`package.json`, `tsconfig.json`, `plugin.json`, `eslint.config.js`, `pricing.json`, `.gitignore`, `LICENSE`, `README.md`, `CHANGELOG.md`, `CLAUDE.md`, `SPEC.md`).
- ADRs/0001 (Architecture Overview), ADRs/0002 (Per-Session JSONL Storage), ADRs/0003 (PostToolUse delivers no usage; we read transcripts instead — a real correction to SPEC.md §9.1).

Phase 1 (typed IDs + pricing infrastructure) — **next**.

### Begin Phase 1 by

1. Re-reading SPEC.md section 11 (discipline mechanics).
2. Reading ADRs/0001, 0002, 0003. (0003 changes the Phase 3 data-plane plan but does not affect Phase 1.)
3. Implementing `src/core/ids.ts` (branded typed IDs: `SessionId`, `ProjectId`, `MessageId`).
4. Implementing `src/core/pricing.ts` (PricingProvider class: load from local `pricing.json`, optional remote refresh, staleness signal).
5. Writing tests in `tests/` for both before declaring Phase 1 done.
6. Tagging `0.0.2` with the commit message `feat(0.0.2): typed IDs + pricing infrastructure`.

## Working conventions

- **TypeScript `--strict`.** No `any`. No `@ts-ignore` without a one-line comment justifying it.
- **Typed IDs everywhere.** `SessionId`, `ProjectId`, `MessageId` are branded types. Stringly-typed IDs are bugs.
- **ADRs for any non-obvious architectural decision.** Status: Accepted (or Proposed if you want feedback before implementing). Reference SPEC.md sections where helpful. Place under `ADRs/NNNN-title-in-kebab.md`.
- **Tests for all code in `src/core/`.** Vitest. 100% coverage of metric computation. Other modules: pragmatic coverage.
- **Atomic file writes.** JSONL append uses O_APPEND + single `write(2)` call. Non-append writes use tmp-file-and-rename.
- **Commit message format:** `type(version): short description`. Examples:
  - `chore(0.0.1): project skeleton`
  - `feat(0.0.2): typed IDs + pricing infrastructure`
  - `fix(0.1.1): cache_read calculation off-by-one for ephemeral 1h`
- **Update CHANGELOG.md before tagging.** Move entries from `[Unreleased]` to the new version section. KAC format.

## What not to do

- **No database.** Per-session JSONL is the architectural decision; see ADR-0002.
- **No telemetry.** The plugin makes one optional network call (pricing.json refresh) to a user-configurable URL. Nothing else.
- **No phase skipping.** Finish the current phase's tests before starting the next phase's code. The phases in SPEC.md section 10 are ordered; respect the order.
- **No additive-only commits when a redundant primitive exists.** Retire-as-you-ship. Same commit that adds the replacement deletes the predecessor.
- **No framework dependencies for HTTP.** Built-in `node:http` is sufficient. No Express, no Fastify, no Koa.
- **No magic numbers.** All thresholds, multipliers, refresh intervals are named constants in config or top-of-file declarations.

## When you are stuck

- If the spec is ambiguous, write an ADR proposing the resolution and continue. Future-you (or future-other-agent) needs the rationale recorded.
- If a Claude Code primitive (plugin manifest, hook signature, slash command schema) is unclear, verify against current Claude Code documentation before guessing. Schemas evolve; the spec was written 2026-05-19.
- If a pricing rate is unclear, log a warning and use a conservative fallback. Do not silently zero-cost an unknown model.
- If you discover a real bug in the spec (not an ambiguity, an actual error), fix it in SPEC.md as part of your commit and reference the correction in the commit message.

## Hire-me note

The codebase is also a hire-me artifact. Code quality, comment quality, ADR quality, and test coverage are part of the product. A hiring manager reading this repo should see *governed, disciplined parallel agentic work* — typed IDs, ADRs, tests, atomic writes, retire-as-you-ship, no stringly-typed code, no telemetry. Embody the discipline the tool is *about*.
