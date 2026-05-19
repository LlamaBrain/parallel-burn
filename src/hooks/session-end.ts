// SessionEnd hook entrypoint.
//
// Stamps `ended_at` on the manifest, then writes the SPEC §7.3
// end-of-session markdown summary to
// `~/.parallel-burn/summaries/YYYY-MM-DD-HHMM.md` (UTC).
//
// If the manifest is absent we do nothing — there's no in-flight state
// to finalize, and the missing SessionStart already meant we never had a
// running session to track. Summary generation failures are caught and
// logged to stderr but never block the manifest finalization.

import { join } from "node:path";

import { aggregateDay } from "../core/aggregator.js";
import { readConfig } from "../core/config.js";
import { makeSessionId } from "../core/ids.js";
import {
  readManifestOptional,
  type SessionManifest,
  writeManifest,
} from "../core/manifest.js";
import {
  parallelBurnSessionMetaPath,
  parallelBurnSummariesDir,
} from "../core/paths.js";
import { PricingProvider } from "../core/pricing.js";
import { dateOf } from "../core/streak.js";
import { renderSessionSummary, summaryFilename } from "../core/summary.js";
import { writeFile, mkdir } from "node:fs/promises";
import { isEntryPoint, readStdinJson, readString, runHook } from "./_lib.js";

/**
 * Pure decision function: returns the manifest to write, or `null` if
 * nothing should be persisted (no prior manifest, already finalized,
 * or malformed payload).
 */
export function buildEndManifest(
  payload: Record<string, unknown>,
  prior: SessionManifest | null,
  now: Date,
): SessionManifest | null {
  const sessionIdRaw = readString(payload, "session_id");
  if (sessionIdRaw === null) return null;
  if (prior === null) return null;
  if (prior.ended_at !== null) return null;
  return { ...prior, ended_at: now.toISOString() };
}

/**
 * Render today's summary markdown for the given manifest's date and write
 * it to `~/.parallel-burn/summaries/YYYY-MM-DD-HHMM.md`. Returns the
 * absolute path on success. Throws on I/O failure — callers in hook
 * entry-points should swallow that error so the manifest finalization
 * still succeeds.
 */
export async function writeEndOfSessionSummary(
  manifest: SessionManifest,
  pricingFile: string = "./pricing.json",
  now: Date = new Date(),
): Promise<string> {
  const date = dateOf(manifest.started_at);
  const pricing = await PricingProvider.fromFile(pricingFile);
  const aggregate = await aggregateDay(date, pricing);
  const config = await readConfig();
  const md = renderSessionSummary({
    date,
    aggregate,
    subscriptionDailyUsd: config.subscriptionDailyUsd,
  });
  const filename = summaryFilename(now);
  const path = join(parallelBurnSummariesDir(), filename);
  await mkdir(parallelBurnSummariesDir(), { recursive: true });
  await writeFile(path, md, "utf8");
  return path;
}

if (isEntryPoint(import.meta.url)) {
  runHook("session-end", async () => {
    const payload = await readStdinJson();
    if (payload === null) return;
    const sessionIdRaw = readString(payload, "session_id");
    if (sessionIdRaw === null) return;
    const sessionId = makeSessionId(sessionIdRaw);
    const metaPath = parallelBurnSessionMetaPath(sessionId);
    const prior = await readManifestOptional(metaPath);
    const manifest = buildEndManifest(payload, prior, new Date());
    if (manifest === null) return;
    await writeManifest(metaPath, manifest);

    try {
      await writeEndOfSessionSummary(manifest);
    } catch (err) {
      // Never block manifest finalization on summary generation.
      process.stderr.write(
        `[parallel-burn session-end] summary write failed: ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
  });
}
