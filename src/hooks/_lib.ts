// Shared helpers for the three hook entrypoints in this directory.
//
// SPEC.md §10 Phase 3: "Hook scripts must be idempotent and crash-resistant
// — a corrupt JSONL line should not prevent the next message from being
// recorded." We extend that to all hook failure modes: a misbehaving hook
// must never disturb Claude Code's own execution. Every hook script wraps
// its body in `runHook`, which catches all errors and exits 0.

import process from "node:process";
import { pathToFileURL } from "node:url";

/**
 * True when `moduleUrl` (the caller's `import.meta.url`) names the file
 * Node was invoked with — i.e. the module is running as the script entry
 * point rather than being imported from a test or another module.
 */
export function isEntryPoint(moduleUrl: string): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  return moduleUrl === pathToFileURL(entry).href;
}

const HOOK_SUCCESS_PAYLOAD = { continue: true, suppressOutput: true } as const;

/**
 * Read a single JSON object from stdin. Returns null if stdin is a TTY,
 * empty, or contains anything other than a top-level JSON object. Never
 * throws.
 */
export async function readStdinJson(): Promise<Record<string, unknown> | null> {
  if (process.stdin.isTTY) return null;
  let text = "";
  for await (const chunk of process.stdin) {
    text += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
  }
  if (text.trim().length === 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  return parsed as Record<string, unknown>;
}

/**
 * Run a hook body, swallowing any error so Claude Code never sees a
 * non-zero exit. The standard `{ continue: true, suppressOutput: true }`
 * response is printed to stdout on success or failure.
 */
export function runHook(name: string, body: () => Promise<void>): void {
  body()
    .then(() => {
      process.stdout.write(`${JSON.stringify(HOOK_SUCCESS_PAYLOAD)}\n`);
    })
    .catch((err: unknown) => {
      process.stderr.write(`[parallel-burn ${name}] ${formatError(err)}\n`);
      process.stdout.write(`${JSON.stringify(HOOK_SUCCESS_PAYLOAD)}\n`);
    });
}

function formatError(err: unknown): string {
  if (err instanceof Error) return err.stack ?? err.message;
  return String(err);
}

export function readString(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}
