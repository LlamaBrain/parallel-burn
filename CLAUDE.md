# CLAUDE.md — In-Session Context for ParallelBurn

You are working on ParallelBurn, a Claude Code plugin. This file is the *ongoing context* for sessions in this repo.

**Read [SPEC.md](./SPEC.md) first if you have not.** It is the source of truth for the design. This file (CLAUDE.md) is the shorter, working-context reminder; SPEC.md is the full specification.

## Current phase

Phase 0 (skeleton) — **complete** at `v0.0.1`.
Phase 1 (typed IDs + pricing infrastructure) — **complete** at `v0.0.2`.
Phase 2 (cost calculator) — **complete** at `v0.0.3`.

Phase 3 (hook scripts + transcript-derived data plane, per ADR-0003) — **next**.

### Begin Phase 2 by

1. Re-reading SPEC.md §10 Phase 2 and §11 (discipline mechanics).
2. Implementing `src/core/cost.ts`. Given a `MessageEvent` and `PricingProvider`, return retail cost in USD. Handle the cache-creation rates correctly: ephemeral-5m at the `cache_write_5m_per_mtok` rate, ephemeral-1h at `cache_write_1h_per_mtok`, cache reads at `cache_read_per_mtok`. (Note: pricing.json already encodes the precomputed multipliers — do *not* multiply input × 1.25 in code; read the per-model rate directly.)
3. Verifying the calculator against a known Anthropic console line item to the cent (manually, against a real session) before declaring this phase done.
4. Table-driven Vitest tests including unknown-model, zero-token, and large-number cases. 100 % coverage on `src/core/cost.ts`.
5. Updating CHANGELOG.md, `package.json`, and `plugin.json` to `0.0.3`. CHANGELOG entries must describe exactly what's in the staged diff — no aspirational entries (user-stated requirement).
6. Tagging `0.0.3` with the commit message `feat(0.0.3): cost calculator`.

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
