---
description: Scan ~/.claude/projects/ and synthesize a ParallelBurn manifest for every Claude Code transcript that doesn't have one yet. Useful right after installing the plugin, or for the active session.
allowed-tools: Bash
---

Run the ParallelBurn backfill command and show the user the output verbatim — do not summarize or interpret unless asked:

!`node "${CLAUDE_PLUGIN_ROOT}/dist/cli/backfill.js"`
