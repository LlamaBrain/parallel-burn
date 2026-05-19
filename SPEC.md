# ParallelBurn — Claude Code Plugin Specification

**Project:** `parallel-burn`
**Org:** LlamaBrain
**Author:** Michael Tiller
**License:** Apache 2.0
**Repository:** `github.com/LlamaBrain/parallel-burn`
**npm:** `@llamabrain/parallel-burn`
**Spec version:** 1.0
**Spec date:** 2026-05-19

---

## 0. For the implementing agent

You are a fresh Claude Code instance starting in an empty directory. This document is your context. Read it end-to-end before writing any code.

You are implementing a Claude Code plugin called **ParallelBurn**. It captures and surfaces live token/cost/cache/parallelism metrics from Claude Code sessions, both for the operator (slash commands, daily summaries) and for downstream consumers (an OBS browser-source overlay for live streams).

The author of this spec is a Principal Engineer with ~30 years of systems-development scar tissue. The conventions in section 11 (discipline mechanics) are non-negotiable; they are how the codebase will stay coherent as you ship across multiple parallel sessions. Read section 11 before you write your first commit.

Your first deliverable is **Phase 0** in section 9 — except that section 0's project skeleton work has been pre-supplied: see the existing `README.md`, `CHANGELOG.md`, `CLAUDE.md`, `LICENSE`, `package.json`, `tsconfig.json`, `plugin.json`, `eslint.config.js`, `pricing.json`, and the `ADRs/` directory. Start with **Phase 1**.

---

## 1. What ParallelBurn is

A Claude Code plugin that:

1. Captures per-message usage data from every Claude Code session running on the operator's machine.
2. Computes cost (retail), cache discipline metrics, compression ratios, streak data, and per-project / per-session aggregates.
3. Surfaces these on demand via `/parallel-burn` and `/streak` slash commands.
4. Generates an end-of-session markdown summary in a specific narrative style (see section 6).
5. Exposes a localhost HTTP/WebSocket endpoint so an OBS browser-source overlay can render live metrics during livestreams.
6. Persists data per-session as append-only JSONL files (no shared SQLite, no locking concerns across parallel Claude Code instances).

## 2. What ParallelBurn is NOT

- **Not a billing replacement.** Retail-price math is the user-visible number; actual subscription billing is Anthropic's.
- **Not a productivity-shaming tool.** Numbers are receipts, not goals. Do not add nag-style "you should be doing more" features.
- **Not an autonomous agent orchestrator.** ParallelBurn observes; it does not control sessions.
- **Not a vibe-coding tool.** The codebase exemplifies what disciplined parallel agentic work looks like; it should not be implemented as a vibe-coding artifact.
- **Not a closed-source service.** It is a local, Apache-2.0-licensed plugin. No telemetry, no phone-home, no cloud dependency beyond an optional pricing.json refresh from a public URL.

## 3. The differentiation

The "Claude Code usage analytics" space is saturated: ccusage (4.8k stars), ccburn, codeburn, TokenTracker, Claude-Code-Usage-Monitor, MyTokenTracker, and others. They all track cost. ParallelBurn's distinct value is **surfacing the parallel structure of the work** — metrics that none of those tools compute:

- **Compression ratio**: session-context-time ÷ wall-clock-window. How much parallelism is happening.
- **Cache discipline**: cache_reads ÷ cache_writes. Whether the cache is doing real work.
- **Streak**: durability of the daily cadence across consecutive calendar days.

Cost figures are surfaced as a side effect, not the centerpiece. The README, summary output, and overlay must all lead with parallelism, not with dollars.

## 4. Target audiences (in order)

1. **The author**, for livestream overlays and personal observability.
2. **Other Claude Code power users** who want quantified output and cost visibility.
3. **Engineers evaluating the author for hire** who will read the code as part of vetting.

Audience 3 is real. The codebase is a hire-me artifact. Code quality, comment quality, ADR quality, and test coverage are all part of the product.

## 5. Technical stack

- **Language:** TypeScript (Node 22+).
- **Runtime:** Node, invoked from Claude Code hook scripts (shell shebangs or compiled bins).
- **Storage:** Append-only JSONL files in `~/.parallel-burn/`. No SQLite, no shared DB. Per-session files mean parallel Claude Code instances never contend for the same handle. See ADR-0002.
- **HTTP:** Built-in `node:http` for the localhost server. No Express, no framework dependencies.
- **Tests:** Vitest. Coverage required for all metric computation logic.
- **Linting:** TypeScript `--strict`, eslint with `eslint:recommended` + `@typescript-eslint/recommended-type-checked` rulesets.
- **Build:** `tsc` for the library, `esbuild` for the binary outputs if size matters. No bundler complexity until proven necessary.

## 6. Directory layout

```
parallel-burn/
├── README.md
├── CHANGELOG.md
├── CLAUDE.md
├── SPEC.md
├── LICENSE
├── .gitignore
├── package.json
├── tsconfig.json
├── plugin.json
├── eslint.config.js
├── pricing.json
├── ADRs/
│   ├── 0001-architecture-overview.md
│   ├── 0002-per-session-jsonl-not-sqlite.md
│   └── ...
├── src/
│   ├── hooks/
│   │   ├── post-tool-use.ts     # Captures per-message usage
│   │   ├── session-start.ts     # Marks session boundary
│   │   └── session-end.ts       # Triggers summary generation
│   ├── commands/
│   │   ├── parallel-burn.ts     # /parallel-burn implementation
│   │   └── streak.ts            # /streak implementation
│   ├── core/
│   │   ├── ids.ts               # Typed IDs (SessionId, ProjectId, MessageId)
│   │   ├── pricing.ts           # PricingProvider
│   │   ├── cost.ts              # Cost calculator
│   │   ├── aggregator.ts        # Walks JSONL files, computes metrics
│   │   ├── compression.ts       # Compression-ratio math
│   │   ├── streak.ts            # Streak detection
│   │   └── summary.ts           # End-of-session markdown generation
│   ├── server/
│   │   └── localhost.ts         # HTTP/WebSocket broadcaster
│   └── cli/
│       └── parallel-burn.ts     # Manual CLI entrypoint (for testing)
└── tests/
    ├── cost.test.ts
    ├── aggregator.test.ts
    └── ...
```

## 7. Data schemas

### 7.1 Per-message event (appended to per-session JSONL)

```typescript
type MessageEvent = {
  schema_version: "1.0";
  message_id: string;
  session_id: string;
  project: string;              // Repo or working-directory name
  timestamp: string;            // ISO 8601
  model: string;                // e.g. "claude-opus-4-7"
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens: number;
    cache_read_input_tokens: number;
    cache_creation: {
      ephemeral_5m_input_tokens: number;
      ephemeral_1h_input_tokens: number;
    };
  };
  tool_name?: string;
  duration_ms?: number;
};
```

### 7.2 pricing.json

See the supplied `pricing.json` file. The PricingProvider attempts a daily refresh from a configurable URL (default: a public llamabrain.org URL). Falls back to local on failure. Surfaces a staleness signal when `as_of` is more than 30 days old.

### 7.3 End-of-session summary (markdown output)

Mimic the narrative style of the author's reference tooling. Example shape:

```
● Session Summary for YYYY-MM-DD

  [N] hours [M] minutes of session-context squeezed into [X]h [Y]m of wall — a [Z]× parallelism multiplier. $[COST] list-price across [N_SESSIONS] sessions, roughly [SUBSIDY]× the Max-prorated daily. Cache reads cleared [N], with [M] writes carrying [token mix].

  [Table: Duration | Cost | Size | Project | Session]

  By Project
  - project_a: [duration] · $[cost] ([n] sessions)
  - project_b: ...

  [One-line interpretation sentence at the bottom.]
```

The summary format is part of the product. It is the artifact users screenshot and share. Take it seriously.

## 8. Metrics

| Metric | Definition |
|---|---|
| **Session-context time** | Sum of per-message wall durations across all sessions on a given day |
| **Wall-clock window** | First-to-last span, merged across overlapping intervals (not naive max-min) |
| **Compression ratio** | session-context-time ÷ wall-clock-window |
| **Cache discipline ratio** | total cache_read_tokens ÷ total cache_write_tokens |
| **Subsidy multiplier** | retail_cost ÷ prorated_daily_subscription_cost |
| **Streak** | Consecutive calendar days with at least one session above a configurable minimum (default $50 retail) |
| **Per-project breakdown** | duration, cost, session-count by project name |

Compute these in `src/core/` modules, each independently testable.

## 9. Claude Code integration points

### 9.1 Hooks (declared in plugin.json)

- `PostToolUse` → `post-tool-use.ts`: appends a MessageEvent to the active session's JSONL.
- `SessionStart` → `session-start.ts`: creates a new JSONL file for the session, records start timestamp and project.
- `SessionEnd` → `session-end.ts`: triggers summary generation, optionally writes to `~/.parallel-burn/summaries/YYYY-MM-DD-HHMM.md`.

### 9.2 Slash commands

- `/parallel-burn` — live stats for current session and today's aggregate.
- `/streak` — current streak count and daily averages over last 30 days.

### 9.3 Localhost server

Single Node process spawned lazily on first hook invocation, terminates when no Claude Code sessions are active for >10 minutes. Endpoints:

- `GET /api/current` — current session live state.
- `GET /api/today` — today's aggregate.
- `WS /ws` — push-on-change subscription for overlay consumers.
- `GET /overlay` — serves the bundled HTML/JS browser source (so OBS points at one URL).

Default port 37337 (configurable via `~/.parallel-burn/config.json`). Localhost-only binding. No auth (the threat model is "single-user local machine").

## 10. Phased delivery

Each phase is its own commit (or commit series). Each phase ends with passing tests. No phase begins until the previous is green.

**Phase 0 — Project skeleton.** Pre-supplied in this repo. See CHANGELOG entry for 0.0.1.

**Phase 1 — Typed IDs and pricing infrastructure.** `src/core/ids.ts` (branded types for SessionId, ProjectId, MessageId — no stringly-typed code anywhere downstream). `src/core/pricing.ts` (PricingProvider class, load from local pricing.json, optional remote refresh, staleness signal). Tests for both. Tag: `0.0.2`.

**Phase 2 — Cost calculator.** `src/core/cost.ts`. Given a MessageEvent and PricingProvider, return retail cost in USD. Handle all cache token rates correctly (cache_creation at 1.25× input, cache_read at 0.1× input). Verify against a known Anthropic console line item to the cent before declaring this phase done. Tests with table-driven cases including edge cases (unknown model, zero tokens, large numbers). Tag: `0.0.3`.

**Phase 3 — Hook scripts and JSONL data plane.** `src/hooks/*.ts`. Hook scripts must be idempotent and crash-resistant — a corrupt JSONL line should not prevent the next message from being recorded. Use atomic appends (open with O_APPEND, write in one syscall, never rewrite the file). Test against simulated PostToolUse payloads. Verify a real Claude Code session writes correctly to `~/.parallel-burn/data/sessions/<session-id>.jsonl`. Tag: `0.1.0` (first feature release).

**Phase 4 — Aggregator and metrics.** `src/core/aggregator.ts`, `src/core/compression.ts`, `src/core/streak.ts`. Walks all JSONL files in a date range, computes the metrics in section 8. Compression ratio uses merged-interval wall-clock-window, not naive first-to-last. Tests cover overlapping sessions, single-session days, gap-day handling for streaks. Tag: `0.2.0`.

**Phase 5 — Slash commands.** `/parallel-burn` and `/streak`. Output formatted for terminal display. Use cli-table3 or equivalent for the project breakdown table. Tag: `0.3.0`.

**Phase 6 — End-of-session summary.** `src/core/summary.ts`. Generates the markdown summary in the exact shape of section 7.3. The narrative-style opening line must read naturally; this is part of the product. Tag: `0.4.0`.

**Phase 7 — Localhost server and overlay.** `src/server/localhost.ts`, plus a minimal HTML/JS overlay served at `/overlay`. The overlay should render the headline number (compression ratio), today's burn, and streak count — in that order, parallelism first. LlamaBrain visual identity: dark background, monospace numerals, subtle accent color. No animation in v1; static updates on WebSocket events. Tag: `0.5.0`.

**Phase 8 — Distribution preparation.** README rewrite for the audience (Claude Code power users + hiring committees). Install instructions. Plugin marketplace submission. Tag: `1.0.0`.

## 11. Discipline mechanics — non-negotiable

These are how the codebase stays coherent across parallel sessions and stays defensible under hiring-committee review.

- **Typed IDs everywhere.** No stringly-typed code. `SessionId`, `ProjectId`, `MessageId` are branded types. If a function takes a `string` for an ID, that's a bug.
- **ADRs for every non-obvious architectural choice.** Per-session JSONL vs SQLite was a choice — documented in ADR-0002. Future architectural choices need their own ADRs.
- **Tests for all metric computation.** Cost calculation, compression ratio, streak detection, cache discipline ratio. Coverage requirement: 100% for `src/core/`. Other modules: pragmatic.
- **Atomic writes.** Every file write either fully succeeds or doesn't change the file. Use tmp-file-and-rename for non-append cases. For JSONL appends, use O_APPEND + single write.
- **Retire-as-you-ship.** If you replace a function, delete the old one in the same commit. If you replace a module, delete the old one in the same commit. Code coming out is as valuable as code going in.
- **Breaking changes get ADRs and migration paths.** Save data schema bumps follow `v1→v2` style — refuse old data with a clear message, document the cutover in an ADR.
- **Cache discipline in your own work.** When you work on this project, stay in one problem space until it's complete. Don't context-switch mid-phase. The codebase you're building is *about* this discipline; embody it.
- **No telemetry, no phone-home.** The plugin contacts the network only for the optional pricing.json refresh, to a URL the user can override. Document this prominently in README.
- **No magic numbers.** Pricing rates, refresh intervals, thresholds — all named constants in config files or top-of-file declarations.

## 12. Glossary

- **session-context time** — wall-clock time during which a Claude Code session was active. Sum across sessions is *not* the wall-clock day.
- **wall-clock window** — merged-interval duration of all active sessions on a calendar day.
- **compression ratio** — session-context ÷ wall-clock-window. Always ≥1.
- **cache discipline** — cache_reads ÷ cache_writes. Higher is better.
- **subsidy multiplier** — retail-cost ÷ prorated-subscription-daily.
- **streak** — consecutive calendar days at or above the daily threshold.
- **stream-session** — operator-marked time window for livestream purposes. Distinct from Claude Code session.

## 13. License and attribution

Apache 2.0. Copyright LlamaBrain Labs LLC. The README byline credits Michael Tiller / LlamaBrain prominently.

## 14. Future (out of scope for v1.0)

- ADR-touched-this-session metric (a uniquely strong signal for governed agentic work).
- Animation polish on the overlay.
- Plugin marketplace promotional copy.
- Discord/Twitch chat command integration for overlay events.
- Cross-machine aggregation (not yet; out of v1 scope by design).

---

**End of spec. Begin Phase 1.**
