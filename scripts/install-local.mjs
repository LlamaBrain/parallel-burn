#!/usr/bin/env node
// install-local — copy the built repo into the operator's Claude Code
// plugin cache so the *next fresh session* runs against the source tree
// being iterated on.
//
// Normally a plugin update goes through a marketplace round-trip. When
// iterating locally that round-trip is annoying enough to skip, which
// historically meant editing the wrong rc directory or running ad-hoc
// `cp -r` invocations that diverge across operators. This script
// centralizes the same set of paths that any prior commit copied and
// pins the destination to `~/.claude/plugins/cache/<author>/<name>/
// <version>/` derived from package.json.
//
// Caveats:
// - This does not register a new version with the marketplace, so
//   `/plugin update parallel-burn` in Claude Code may not pick it up
//   automatically. The wrapper in ~/.claude/scripts/statusline-combined.js
//   does pick up the highest-semver cache directory, but the hook
//   loader's discovery rules are opaque. If a fresh session still binds
//   to an older version, run `/plugin update parallel-burn` after this.
// - Destructive in the sense that the destination directory is
//   overwritten. Nothing outside that directory is touched.

import { cpSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import process from "node:process";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));

const version = pkg.version;
const author = "llamabrain";
const name = "parallel-burn";

if (typeof version !== "string" || version.length === 0) {
  process.stderr.write("install-local: package.json missing version\n");
  process.exit(1);
}

const dest = join(homedir(), ".claude", "plugins", "cache", author, name, version);

// Same payload as the per-commit sync that used to be a manual one-liner.
// `dist/` is the only thing that has to be freshly built; the others are
// source-tracked and copied as-is so the cache directory looks like a
// proper plugin install.
const PAYLOAD = [
  "dist",
  "commands",
  "ADRs",
  ".claude-plugin",
  "hooks",
  "verification",
  "pricing.json",
  "package.json",
  "README.md",
  "LICENSE",
  "CHANGELOG.md",
  "SPEC.md",
];

if (!existsSync(join(repoRoot, "dist"))) {
  process.stderr.write(
    "install-local: dist/ is missing. Run `npm run build` first or use " +
      "`npm run install:local` which chains build + this script.\n",
  );
  process.exit(1);
}

mkdirSync(dest, { recursive: true });

let copied = 0;
let skipped = 0;
for (const entry of PAYLOAD) {
  const src = join(repoRoot, entry);
  if (!existsSync(src)) {
    skipped++;
    continue;
  }
  cpSync(src, join(dest, entry), { recursive: true, force: true });
  copied++;
}

process.stdout.write(
  `install-local: synced ${String(copied)} entries (${String(skipped)} skipped) -> ${dest}\n`,
);
