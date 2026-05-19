# ParallelBurn

A Claude Code plugin that surfaces the **parallel structure** of your work —
not just the price tag. Most Claude Code analytics tools answer *"how much did
I spend?"* ParallelBurn answers *"how much wall-clock time did I compress into
session-context time?"* Cost is a side effect, not the headline.

```text
● ParallelBurn — 2026-05-19

  0h 54m of session-context squeezed into 0h 54m of wall — a 1.0×
  parallelism multiplier. $215.43 list-price across 1 session,
  roughly 32.3× the Max-prorated daily. Cache reads cleared
  61,892,693, with 1,412,459 writes (discipline 43.8×).
```

This output is from a real session — the 32.3× subsidy multiplier and 98%
cache-token share are exactly the kind of headline this plugin is built
to produce.

## What you get

| Surface                    | Where                                                       |
| -------------------------- | ----------------------------------------------------------- |
| `/parallel-burn`           | Live session + today's aggregate, rendered in chat          |
| `/streak`                  | Current streak count, last-30-day calendar                  |
| `/parallel-burn-backfill`  | One-shot scan of prior Claude Code sessions — run once after install |
| **Status bar**             | Single-line summary below Claude Code's input area          |
| **OBS browser source**     | `http://127.0.0.1:37337/overlay` — dark, monospace card     |
| **End-of-session summary** | `~/.parallel-burn/summaries/YYYY-MM-DD-HHMM.md` on close    |

The five core metrics, in priority order:

1. **Compression ratio** — `session-context-time ÷ wall-clock-window`. If you
   ran four parallel sessions for an hour each inside a one-hour wall-clock
   window, that's **4×**. Always ≥ 1. The headline number.
2. **Cache discipline** — `cache_read_tokens ÷ cache_write_tokens`. Whether
   your prompt-caching is doing real work. Above 5× is healthy; above 20× is
   excellent.
3. **Streak** — consecutive calendar days at or above a configurable retail
   threshold (default $50/day).
4. **Subsidy multiplier** — `retail_cost ÷ subscription_daily`. How much
   value you're getting against your plan.
5. **Per-project breakdown** — duration, cost, session count grouped by
   working directory.

## Install

### As a Claude Code plugin (recommended)

ParallelBurn is published as a Claude Code plugin. Once a marketplace
listing is in place:

```bash
claude plugin install @llamabrain/parallel-burn
```

The install registers the `SessionStart`, `PostToolUse`, and `SessionEnd`
hooks declared in `plugin.json`, and exposes `/parallel-burn` and `/streak`
as slash commands.

### From source (for now)

```bash
git clone https://github.com/LlamaBrain/parallel-burn
cd parallel-burn
npm install
npm run build
```

Then point Claude Code at the checkout — either by adding it to a local
plugin marketplace (preferred) or by symlinking it into
`~/.claude/plugins/`. The hooks declared in `plugin.json` will pick up
automatically once Claude Code sees the plugin.

### Wire the status-bar integration

ParallelBurn ships a `statusLine` script. To enable, add this to
`~/.claude/settings.json`:

```jsonc
{
  "statusLine": {
    "type": "command",
    "command": "node \"${CLAUDE_PLUGIN_ROOT}/dist/cli/statusline.js\"",
    "padding": 0
  }
}
```

You'll see something like:

```text
⊕ 4.0× parallel · $123.45 today · streak 7d
```

below the Claude Code input area.

### Wire the OBS browser source

```bash
node dist/cli/serve.js
# → parallel-burn overlay: http://127.0.0.1:37337/overlay
```

In OBS: add a **Browser Source**, set the URL to
`http://127.0.0.1:37337/overlay`. It's dark-themed, monospace, and updates
live via Server-Sent Events (no setup beyond the URL).

## Configure

ParallelBurn reads `~/.parallel-burn/config.json`. All fields are optional:

```jsonc
{
  "subscription_daily_usd": 6.67,        // default: $200/30 (Max plan prorated)
  "daily_streak_threshold_usd": 50,      // default: $50/day
  "server_port": 37337,                  // default: 37337
  "pricing_refresh_url": ""              // empty disables the refresh
}
```

The model rate card is in `pricing.json` at the repo root (and shipped
inside the installed plugin). If the `as_of` date is older than 30 days,
slash commands and the overlay surface a **STALE** warning.

## What makes this different

The "Claude Code usage analytics" space is crowded — `ccusage`, `ccburn`,
`codeburn`, `TokenTracker`, `Claude-Code-Usage-Monitor`, `MyTokenTracker`,
and others all track cost. ParallelBurn's distinct value is **surfacing
the parallel structure of the work** — metrics none of those tools
compute:

- **Compression ratio** uses *merged-interval* wall-clock-window, not
  naive `max(end) − min(start)`. The math is honest about gaps. See
  `src/core/compression.ts` and its tests.
- **Cache discipline** turns the usage block's cache_read / cache_write
  fields into a single number you can read across.
- **Subsidy multiplier** gives you a meaningful "value-vs-plan" number
  per day, configurable for any subscription tier.

The README, slash commands, summary, statusline, and overlay all lead
with parallelism. Dollars come second.

## Privacy

ParallelBurn runs entirely on your local machine. The **only** network
egress is an optional daily refresh of `pricing.json` from a URL you
configure. Set `pricing_refresh_url: ""` in `~/.parallel-burn/config.json`
to disable network access entirely (the bundled `pricing.json` is the
fallback).

The localhost HTTP server binds to `127.0.0.1` only.

No telemetry. No phone-home. No cloud.

## How it works

ParallelBurn doesn't intercept the model API. Per
[ADR-0003](./ADRs/0003-no-usage-data-in-posttooluse.md), token-usage data
is read straight from Claude Code's own per-session transcript JSONLs at
`~/.claude/projects/<encoded-cwd>/<session-uuid>.jsonl` (the same files
the `ccusage` family relies on). The hooks record session boundaries to
`~/.parallel-burn/data/sessions/<id>.meta.json`; the aggregator joins
those manifests with the transcripts on demand.

The data plane is append-only JSONL with `O_APPEND` semantics for parallel
writers — see [ADR-0002](./ADRs/0002-per-session-jsonl-not-sqlite.md) for
the rationale. The transcript path encoding rule is pinned in
[ADR-0004](./ADRs/0004-transcript-path-encoding.md). The push-on-change
protocol for the overlay is Server-Sent Events, not WebSocket — see
[ADR-0005](./ADRs/0005-sse-not-websocket.md).

## Reading this codebase

If you're evaluating the engineering rather than the metrics, the
high-signal entry points are:

- [`SPEC.md`](./SPEC.md) — the canonical product + implementation spec.
  14 sections, ~270 lines.
- [`ADRs/`](./ADRs) — five architectural decision records, one per
  non-obvious choice. ADR-0003 in particular is a real spec correction
  the implementation surfaced.
- [`src/core/`](./src/core) — pure, side-effect-free modules. Branded
  typed IDs (`SessionId`, `ProjectId`, `MessageId`), `PricingProvider`,
  `computeCost`, merged-interval `computeCompression`, `computeStreak`,
  the `aggregator`, the markdown `summary` renderer. **100 % statement /
  function / line coverage; ≥ 98 % branch.**
- [`tests/`](./tests) — Vitest. 225 tests across 16 files.
- [`CHANGELOG.md`](./CHANGELOG.md) — Keep a Changelog format, one entry
  per release. Each entry describes exactly what shipped in that commit.

The phasing model is in `SPEC.md` §10. Each phase ends with a Git tag
(`v0.0.1` through `v1.0.0`), and the corresponding commit message names
the phase.

## Development

```bash
npm install
npm run typecheck     # tsc --noEmit, strict mode
npm run lint          # eslint with @typescript-eslint/recommended-type-checked
npm test              # vitest run
npm run test:coverage # with v8 coverage report
npm run build         # tsc → dist/
```

Conventions:

- `tsc --strict` with `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
  `verbatimModuleSyntax`.
- Branded IDs everywhere — no stringly-typed code crossing module boundaries.
- 100% test coverage on `src/core/`; pragmatic on the rest.
- Atomic writes: tmp-file-and-rename or `O_APPEND` + single `write(2)`.
- Every non-obvious architectural choice gets an ADR.

## Release status

This is **`1.0.0-rc.1`**. All eight SPEC.md §10 phases are shipped and
every automated check is green (218 tests, 100 % core coverage,
`tsc --strict` and ESLint typed-rules clean). Stable `1.0.0` is held
back pending end-to-end human verification of the live integration
surfaces — slash commands firing in a real Claude Code session, the
OBS overlay rendering in OBS, hooks actually triggering from Claude
Code, and the statusline appearing below the input area. The CHANGELOG
has the full checklist.

## License

Apache 2.0. Copyright © 2026 LlamaBrain Labs LLC. Authored by Michael Tiller
(metagrue@gmail.com / github.com/LlamaBrain).
