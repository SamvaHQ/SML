#!/usr/bin/env bun

/**
 * Build the public packages once, pack them into `dist/local`, and print each package's `file:`
 * specifier as JSON (`{ "tarballs": { name: specifier } }`). A consuming project uses each
 * specifier wherever its root `package.json` declares that package (a dependency or a catalog
 * entry) and again under `overrides`. The overrides matter: `@samva/vite` depends on
 * `@samva/markup` by range, so without them the consumer resolves that copy from npm.
 *
 * The tarballs carry the version in each `package.json`, so the consumer's lockfile records the
 * local file and its integrity; repacking changes the bytes and the next install picks them up.
 */

import { mkdir, rm } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dir, "..");
const packRoot = join(repositoryRoot, "dist", "local");
/** Build order: the Vite build embeds the editor app, which imports markup. */
const roots = ["packages/markup", "packages/editor", "packages/vite"] as const;

const run = (command: ReadonlyArray<string>, cwd = repositoryRoot): string => {
  const result = Bun.spawnSync({ cmd: [...command], cwd, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) {
    throw new Error(
      `${command.join(" ")} failed\n${result.stdout.toString()}${result.stderr.toString()}`,
    );
  }
  return result.stdout.toString();
};

await rm(packRoot, { recursive: true, force: true });
await mkdir(packRoot, { recursive: true });
// Packing skips lifecycle scripts, so build here, in dependency order.
run(["bun", "run", "build"]);

const tarballs: Record<string, string> = {};
for (const root of roots) {
  const { name } = (await Bun.file(join(repositoryRoot, root, "package.json")).json()) as {
    readonly name: string;
  };
  const output = run(
    ["bun", "pm", "pack", "--ignore-scripts", "--destination", packRoot, "--quiet"],
    join(repositoryRoot, root),
  )
    .trim()
    .split("\n")
    .at(-1);
  if (!output) throw new Error(`bun pm pack produced no tarball for ${root}`);
  tarballs[name] = `file:${join(packRoot, basename(output))}`;
}

const head = run(["git", "rev-parse", "--short=12", "HEAD"]).trim();
const dirty = run(["git", "status", "--porcelain"]).trim() !== "";
console.error(
  `Packed ${Object.keys(tarballs).length} tarballs from ${head}${dirty ? " (dirty)" : ""}.`,
);
console.error(
  "In the consumer's root package.json, use each specifier where the package is declared and under overrides, then install:",
);
console.log(JSON.stringify({ tarballs }, null, 2));
