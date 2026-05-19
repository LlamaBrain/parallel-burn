// `parallel-burn-backfill` — scan ~/.claude/projects/ and synthesize a
// SessionManifest for every transcript that doesn't have one yet.
//
// Useful right after installing ParallelBurn (so all prior sessions are
// visible) and for the active session (whose SessionStart hook can't
// fire retroactively). Flags:
//
//   --leave-open   Leave ended_at: null on every synthesized manifest
//                  (treat all discovered sessions as still-active).
//                  Default: set ended_at from the last transcript
//                  timestamp.
//   --quiet        Skip the per-session log lines.

import process from "node:process";

import { backfillMissingManifests } from "../core/backfill.js";

export type BackfillCliOptions = {
  readonly leaveOpen: boolean;
  readonly quiet: boolean;
};

export function parseCliArgs(argv: readonly string[]): BackfillCliOptions {
  return {
    leaveOpen: argv.includes("--leave-open"),
    quiet: argv.includes("--quiet") || argv.includes("-q"),
  };
}

export function renderBackfillReport(
  result: { created: readonly string[]; skipped: readonly string[]; ignored: readonly string[] },
  options: { quiet: boolean },
): string {
  const lines: string[] = [];
  lines.push("● parallel-burn backfill");
  lines.push("");
  lines.push(`  created: ${String(result.created.length)} new manifest${result.created.length === 1 ? "" : "s"}`);
  lines.push(`  skipped: ${String(result.skipped.length)} already-tracked session${result.skipped.length === 1 ? "" : "s"}`);
  lines.push(`  ignored: ${String(result.ignored.length)} transcript${result.ignored.length === 1 ? "" : "s"} (no cwd / no timestamps)`);

  if (!options.quiet && result.created.length > 0) {
    lines.push("");
    lines.push("  Newly tracked sessions:");
    for (const id of result.created) lines.push(`  - ${id}`);
  }
  if (!options.quiet && result.ignored.length > 0) {
    lines.push("");
    lines.push("  Ignored (no usable metadata):");
    for (const id of result.ignored) lines.push(`  - ${id}`);
  }
  return lines.join("\n");
}

/* v8 ignore start -- runtime-only entry point. */
async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  const result = await backfillMissingManifests({ leaveOpen: args.leaveOpen });
  process.stdout.write(`${renderBackfillReport(result, { quiet: args.quiet })}\n`);
}

import { pathToFileURL } from "node:url";
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err: unknown) => {
    process.stderr.write(`[parallel-burn-backfill] ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
/* v8 ignore stop */
