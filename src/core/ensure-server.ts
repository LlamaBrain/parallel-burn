// Idempotent localhost-server bootstrap for the SessionStart hook.
//
// `isPortListening` does a short TCP probe against 127.0.0.1:port. If
// something is already listening we assume it's our server (or another
// service that owns the port) and skip the spawn. If the probe fails we
// fork `dist/cli/serve.js` as a detached, unref'd child so the server
// outlives the hook process. Server stdio goes to a log file so a crash
// is debuggable; the hook itself never blocks on the spawn.
//
// SessionEnd intentionally does *not* call into here — the server is a
// per-machine resource, not a per-session one. See ROADMAP.md.

import { spawn } from "node:child_process";
import { openSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { connect, type Socket } from "node:net";
import { dirname, join } from "node:path";
import process from "node:process";

import { parallelBurnRoot } from "./paths.js";

const PROBE_HOST = "127.0.0.1";
const PROBE_TIMEOUT_MS = 250;

export async function isPortListening(
  port: number,
  host: string = PROBE_HOST,
  timeoutMs: number = PROBE_TIMEOUT_MS,
): Promise<boolean> {
  return new Promise((resolve) => {
    const socket: Socket = connect({ port, host });
    let settled = false;
    const finalize = (alive: boolean): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(alive);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finalize(true));
    socket.once("timeout", () => finalize(false));
    socket.once("error", () => finalize(false));
  });
}

export type EnsureServerOptions = {
  readonly port: number;
  readonly serveScriptPath: string;
  readonly pluginRoot: string;
  readonly logFilePath?: string;
};

export type EnsureServerResult = "already-running" | "spawned";

type Probe = (port: number) => Promise<boolean>;
type Spawner = (script: string, logFd: number, cwd: string) => void;

const defaultSpawn: Spawner = (script, logFd, cwd) => {
  const child = spawn(process.execPath, [script], {
    cwd,
    detached: true,
    stdio: ["ignore", logFd, logFd],
    windowsHide: true,
  });
  child.unref();
};

export type EnsureServerDeps = {
  readonly probe?: Probe;
  readonly spawnFn?: Spawner;
};

export async function ensureServerRunning(
  opts: EnsureServerOptions,
  deps: EnsureServerDeps = {},
): Promise<EnsureServerResult> {
  const probe = deps.probe ?? isPortListening;
  const spawner = deps.spawnFn ?? defaultSpawn;
  if (await probe(opts.port)) return "already-running";
  const logPath = opts.logFilePath ?? join(parallelBurnRoot(), "logs", "server.log");
  await mkdir(dirname(logPath), { recursive: true });
  const fd = openSync(logPath, "a");
  spawner(opts.serveScriptPath, fd, opts.pluginRoot);
  return "spawned";
}
