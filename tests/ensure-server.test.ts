import { createServer, type Server } from "node:net";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ensureServerRunning, isPortListening } from "../src/core/ensure-server.js";

type SpawnCall = { script: string; logFd: number; cwd: string };

describe("isPortListening", () => {
  let server: Server | null = null;
  let port = 0;

  beforeEach(async () => {
    await new Promise<void>((resolve) => {
      server = createServer();
      server.listen(0, "127.0.0.1", () => {
        const addr = server!.address();
        if (addr && typeof addr === "object") port = addr.port;
        resolve();
      });
    });
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      if (server) server.close(() => resolve());
      else resolve();
    });
    server = null;
  });

  it("returns true for a port with a live listener", async () => {
    expect(await isPortListening(port)).toBe(true);
  });

  it("returns false after the listener closes", async () => {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = null;
    expect(await isPortListening(port)).toBe(false);
  });

  it("returns false for an almost-certainly-unbound port", async () => {
    // Port 1 is privileged and effectively never listening for a user.
    expect(await isPortListening(1, "127.0.0.1", 100)).toBe(false);
  });
});

describe("ensureServerRunning", () => {
  let tempDir: string;
  let logPath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pb-ensure-server-"));
    logPath = join(tempDir, "server.log");
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("returns 'already-running' and does not spawn when probe says alive", async () => {
    const calls: SpawnCall[] = [];
    const result = await ensureServerRunning(
      {
        port: 37337,
        serveScriptPath: "/fake/serve.js",
        pluginRoot: "/fake/root",
        logFilePath: logPath,
      },
      {
        probe: () => Promise.resolve(true),
        spawnFn: (script, logFd, cwd) => calls.push({ script, logFd, cwd }),
      },
    );
    expect(result).toBe("already-running");
    expect(calls).toHaveLength(0);
  });

  it("spawns the serve script when probe says dead, opening the log file", async () => {
    const calls: SpawnCall[] = [];
    const result = await ensureServerRunning(
      {
        port: 37337,
        serveScriptPath: "/fake/serve.js",
        pluginRoot: "/fake/root",
        logFilePath: logPath,
      },
      {
        probe: () => Promise.resolve(false),
        spawnFn: (script, logFd, cwd) => calls.push({ script, logFd, cwd }),
      },
    );
    expect(result).toBe("spawned");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.script).toBe("/fake/serve.js");
    expect(calls[0]?.cwd).toBe("/fake/root");
    expect(typeof calls[0]?.logFd).toBe("number");
    // Log file was created (opening "a" creates an empty file).
    await expect(readFile(logPath, "utf8")).resolves.toBe("");
  });

  it("creates the log directory if it does not yet exist", async () => {
    const nested = join(tempDir, "nested", "deep", "server.log");
    const calls: SpawnCall[] = [];
    const result = await ensureServerRunning(
      {
        port: 37337,
        serveScriptPath: "/fake/serve.js",
        pluginRoot: "/fake/root",
        logFilePath: nested,
      },
      {
        probe: () => Promise.resolve(false),
        spawnFn: (script, logFd, cwd) => calls.push({ script, logFd, cwd }),
      },
    );
    expect(result).toBe("spawned");
    expect(calls).toHaveLength(1);
    await expect(readFile(nested, "utf8")).resolves.toBe("");
  });
});
