# Changelog

All notable changes to ParallelBurn will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.0.3] — 2026-05-19

### Added

- `src/core/event.ts` — `MessageEvent` and `MessageEventUsage` types matching
  SPEC.md §7.1, with branded IDs from `src/core/ids.ts`. Type only; parsing
  lands in Phase 3.
- `src/core/cost.ts` — `computeCost(event, pricing) → CostBreakdown`, the
  retail-USD calculator. Reads precomputed per-model rates straight from the
  rate card (no `× 1.25` in code). Splits the breakdown into input / output /
  5m-cache-write / 1h-cache-write / cache-read. Reconciles legacy
  `cache_creation_input_tokens` against the granular 5m/1h breakdown:
  granular fields win when present, any remaining legacy total bills at the
  5m rate (the original ephemeral cache flavor).
- Unknown-model handling per CLAUDE.md "do not silently zero-cost":
  `CostBreakdown.unknownModel` flags the case and the cost is billed against
  the most-expensive known model's rates (`conservativeFallbackModel` carries
  the name). Errs toward overestimating, never underestimating.
- `EmptyPricingError` thrown when the `PricingProvider` exposes no models —
  callers can never end up with a zero-cost false negative for an unknown
  model.
- `PricingProvider.entries()` — new iteration helper yielding `[name, rates]`
  pairs. Used by the unknown-model fallback to avoid a TypeScript-mandated
  but dynamically-unreachable defensive branch.
- 13 new Vitest tests in `tests/cost.test.ts` plus an `entries()` test in
  `tests/pricing.test.ts`. 53 tests total. 100 % statement / branch /
  function / line coverage on all four `src/core/` modules.

### Changed

- `package.json` and `plugin.json` version → `0.0.3`.

### Verification status

- `tsc --strict` clean.
- `eslint --quiet` clean.
- All tests pass; `src/core/` at 100 % coverage on every metric.
- **Manual verification against an Anthropic console line item is still
  required before this rate card can be considered production-trusted.**
  The math matches the published rates by construction (rates × tokens /
  1 000 000) and round-trips against unit-rate cases (1 M tokens × $15/MTok
  = $15.00). A real-session cross-check is queued and will be noted in the
  CHANGELOG when complete.

[0.0.3]: https://github.com/LlamaBrain/parallel-burn/releases/tag/v0.0.3

## [0.0.2] — 2026-05-19

### Added

- `src/core/ids.ts` — branded typed IDs (`SessionId`, `ProjectId`, `MessageId`)
  with a private `unique symbol` brand, a `makeXxxId` constructor that
  validates non-empty/whitespace-trimmed/no-newline/≤256-char strings, runtime
  type guards, and a structured `InvalidIdError`.
- `src/core/pricing.ts` — `PricingProvider` class with
  `fromDocument` / `fromFile` / `fromRemoteWithFallback` factories,
  per-model rate lookup, schema-version gate (`"1.0"` only), and a
  30-day staleness signal (`isStale`, `ageDays`). Remote fetch silently
  falls back to the local file on any failure — the "no telemetry,
  no phone-home" contract from SPEC.md §11.
- Vitest test suite for both modules. 40 tests, 100 % statement / branch /
  function / line coverage on `src/core/`.
- `tsconfig.eslint.json` — separate include set so the typed ESLint rules
  can lint `tests/` and `eslint.config.js` (typescript-eslint v8 typed-rules
  scope is governed by the project's `include`).

### Changed

- `package.json` and `plugin.json` version → `0.0.2`.

[0.0.2]: https://github.com/LlamaBrain/parallel-burn/releases/tag/v0.0.2

## [0.0.1] — 2026-05-19

### Added

- Initial project skeleton.
- TypeScript (`--strict`) configuration with Node 22+ target.
- Vitest test runner with v8 coverage reporter.
- ESLint flat-config setup with `@typescript-eslint/recommended-type-checked`.
- Apache 2.0 `LICENSE`.
- `SPEC.md` — full design specification (14 sections, ~600 lines).
- `CLAUDE.md` — in-session agent context for contributors.
- `README.md` — public-facing project description, audience-aware.
- `pricing.json` — current Claude rate card (Opus 4.7, Sonnet 4.6, Haiku 4.5) with `as_of: 2026-05-19`.
- `plugin.json` — Claude Code plugin manifest scaffold (to be verified against current plugin schema before publishing).
- `ADRs/0001-architecture-overview.md` — captures the high-level architectural decisions.
- `ADRs/0002-per-session-jsonl-not-sqlite.md` — documents the storage choice and alternatives considered.
- `ADRs/0003-no-usage-data-in-posttooluse.md` — corrects the spec's data-plane
  assumption after verifying the live Claude Code hooks reference: PostToolUse
  payloads do not include token usage, so the data plane reads from Claude
  Code's transcript JSONLs.

### Not yet implemented

- All `src/` modules. Phase 1 (typed IDs and pricing infrastructure) begins next; see SPEC.md section 10.

[Unreleased]: https://github.com/LlamaBrain/parallel-burn/compare/v0.0.3...HEAD
[0.0.1]: https://github.com/LlamaBrain/parallel-burn/releases/tag/v0.0.1
