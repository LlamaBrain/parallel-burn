// Atomic, crash-resistant file I/O primitives.
//
// SPEC.md §11: "Atomic writes. Every file write either fully succeeds or
// doesn't change the file. Use tmp-file-and-rename for non-append cases.
// For JSONL appends, use O_APPEND + single write."
//
// This module is the single source of truth for both patterns.

import { constants as fsConstants } from "node:fs";
import {
  mkdir,
  open,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Write a JSON value to `path` atomically: serialize to a sibling temp file,
 * then `rename(2)` into place. POSIX rename is atomic within a filesystem;
 * NTFS provides equivalent ReplaceFile semantics. Either the file is the
 * old contents or the new contents — never partially-written.
 */
export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp.${String(process.pid)}.${String(Date.now())}`;
  try {
    await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(tmp, path);
  } catch (err) {
    await unlink(tmp).catch(() => undefined);
    throw err;
  }
}

/**
 * Read JSON from `path`, returning `null` if the file does not exist.
 * Any other error (permission, malformed JSON) propagates.
 */
export async function readJsonOptional(path: string): Promise<unknown> {
  try {
    const text = await readFile(path, "utf8");
    return JSON.parse(text) as unknown;
  } catch (err) {
    if (isFileNotFound(err)) return null;
    throw err;
  }
}

/**
 * Append a single JSONL line (object stringified + `\n`) to `path` via
 * `O_APPEND`. POSIX guarantees atomicity for writes ≤ PIPE_BUF (4096 bytes
 * on Linux). NTFS provides equivalent FILE_APPEND_DATA semantics: each
 * `write(2)` call appends as a single atomic operation. Lines longer than
 * 4 KiB lose this guarantee — callers are responsible for keeping events
 * small (in practice MessageEvent lines are well under 2 KiB).
 */
export async function appendJsonLine(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const line = `${JSON.stringify(value)}\n`;
  const fh = await open(
    path,
    // eslint-disable-next-line no-bitwise
    fsConstants.O_WRONLY | fsConstants.O_APPEND | fsConstants.O_CREAT,
    0o644,
  );
  try {
    await fh.write(line, null, "utf8");
  } finally {
    await fh.close();
  }
}

function isFileNotFound(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    err.code === "ENOENT"
  );
}
