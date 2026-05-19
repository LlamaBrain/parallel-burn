# ParallelBurn

A Claude Code plugin that surfaces the **parallel structure** of your work — not just the price tag.

Most Claude Code analytics tools answer "how much did I spend?" ParallelBurn answers "how much wall-clock time did I compress into session-context time?" Cost is a side effect of the answer, not the headline.

## What it shows

- **Compression ratio** — session-context-time ÷ wall-clock-window. If you ran four parallel sessions for an hour each across a one-hour wall-clock window, that's 4×. The number the overlay leads with.
- **Cache discipline** — `cache_read_tokens / cache_write_tokens`. Whether your prompt-caching is doing real work.
- **Streak** — consecutive calendar days at or above a configurable daily floor (default $50 retail).
- **Retail cost** — line-item-priced against Anthropic's published rates. This is *not* what you actually pay if you're on a subscription; it's the value of the work at retail.
- **Per-project breakdown** — duration, cost, and session count grouped by working directory.

## Install

```bash
# Once the plugin marketplace listing is live (Phase 8):
claude plugin install @llamabrain/parallel-burn
```

## Use

```
/parallel-burn       Live stats for the current session and today's aggregate.
/streak              Streak count and 30-day daily averages.
```

At session end, ParallelBurn writes a narrative-style summary to `~/.parallel-burn/summaries/YYYY-MM-DD-HHMM.md`.

For livestreaming, point an OBS browser source at `http://localhost:37337/overlay` for a dark, monospace card showing parallelism · burn · streak.

## Status

This repository is being implemented in phases against `SPEC.md`. See `CHANGELOG.md` for what's currently shipped.

## Privacy

ParallelBurn runs entirely on your local machine. The only network egress is an optional daily refresh of `pricing.json` from a URL you control (default: a public LlamaBrain endpoint). Set the URL to an empty string in `~/.parallel-burn/config.json` to disable network access entirely.

No telemetry. No phone-home. No cloud.

## License

Apache 2.0. Copyright © 2026 LlamaBrain Labs LLC. Authored by Michael Tiller.
