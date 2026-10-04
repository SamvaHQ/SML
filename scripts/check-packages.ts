#!/usr/bin/env bun

/**
 * Build every public package twice from clean output, pack each with `bun pm pack`, and audit the
 * tarballs a release would publish: reproducible bytes, required files, no source-only files, no
 * unresolved workspace or catalog range, no private package, and no path from the build checkout.
 */

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";

type Manifest = {
  readonly name: string;
  readonly version: string;
  readonly private?: boolean;
  readonly license?: string;
  readonly repository?: unknown;
  readonly exports?: Readonly<Record<string, unknown>>;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
};

const repositoryRoot = resolve(import.meta.dir, "..");
const packRoot = join(repositoryRoot, "dist", "packages");
const repositoryPaths = new Set([repositoryRoot, await realpath(repositoryRoot)]);
const roots = ["packages/markup", "packages/editor", "packages/vite"] as const;
/** Template authors install these, so an Effect runtime must never reach their projects. */
const effectFree = new Set(["@samva/markup", "@samva/vite"]);
const privatePackages = /@samva\/(?:api|cli-app|contracts|core|starters|ui)\b|@nucleo\//;

const run = (command: ReadonlyArray<string>, cwd = repositoryRoot): string => {
  const result = Bun.spawnSync({ cmd: [...command], cwd, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) {
    throw new Error(
      `${command.join(" ")} failed\n${result.stdout.toString()}${result.stderr.toString()}`,
    );
  }
  return result.stdout.toString();
};

const sha256 = async (path: string): Promise<string> => {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
};

const expected = new Map<string, Manifest>();
for (const root of roots) {
  const manifest = JSON.parse(
    await readFile(join(repositoryRoot, root, "package.json"), "utf8"),
  ) as Manifest;
  expected.set(manifest.name, manifest);
}

/** Build from clean output and pack every root; returns tarball name → sha256. */
const buildAndPack = async (): Promise<Map<string, string>> => {
  for (const root of roots)
    await rm(join(repositoryRoot, root, "dist"), { recursive: true, force: true });
  await rm(packRoot, { recursive: true, force: true });
  await mkdir(packRoot, { recursive: true });
  // Packing skips lifecycle scripts, so build here. The Vite build embeds the editor app.
  run(["bun", "run", "build"]);
  for (const root of roots) {
    const packed = run(
      ["bun", "pm", "pack", "--ignore-scripts", "--destination", packRoot, "--quiet"],
      join(repositoryRoot, root),
    );
    const output = packed.trim().split("\n").at(-1);
    if (!output) throw new Error(`bun pm pack produced no tarball for ${root}`);
    console.log(`${root}: ${isAbsolute(output) ? output : join(packRoot, basename(output))}`);
  }
  const tarballs = (await readdir(packRoot)).filter((name) => name.endsWith(".tgz")).sort();
  return new Map(
    await Promise.all(
      tarballs.map(async (name) => [name, await sha256(join(packRoot, name))] as const),
    ),
  );
};

const first = await buildAndPack();
const second = await buildAndPack();
if (first.size !== roots.length)
  throw new Error(`Expected ${roots.length} tarballs, found ${first.size}`);
for (const [name, digest] of first) {
  if (second.get(name) !== digest)
    throw new Error(`${name} is not reproducible across two clean builds`);
}

const seen = new Set<string>();
for (const tarball of first.keys()) {
  const tarballPath = join(packRoot, tarball);
  const contents = run(["tar", "-tzf", tarballPath]).trim().split("\n");
  for (const required of [
    "package/package.json",
    "package/README.md",
    "package/AGENTS.md",
    "package/LICENSE",
  ]) {
    if (!contents.includes(required)) throw new Error(`${tarball} is missing ${required}`);
  }
  const forbidden = contents.filter(
    (path) => path.endsWith(".map") || path.includes("/src/") || path.includes("/scripts/"),
  );
  if (forbidden.length > 0) {
    throw new Error(`${tarball} contains source-only files:\n${forbidden.join("\n")}`);
  }

  const manifestText = run(["tar", "-xOf", tarballPath, "package/package.json"]);
  if (/workspace:|catalog:/.test(manifestText)) {
    throw new Error(`${tarball} contains an unresolved workspace or catalog range`);
  }
  if (privatePackages.test(manifestText)) throw new Error(`${tarball} names a private package`);
  const manifest = JSON.parse(manifestText) as Manifest;
  const source = expected.get(manifest.name);
  if (source === undefined) throw new Error(`${tarball} has unexpected name ${manifest.name}`);
  if (seen.has(manifest.name)) throw new Error(`Duplicate tarball for ${manifest.name}`);
  seen.add(manifest.name);
  if (manifest.private === true) throw new Error(`${manifest.name} is private`);
  if (manifest.version !== source.version) {
    throw new Error(`${manifest.name} has unexpected version ${manifest.version}`);
  }
  if (manifest.license !== "MIT" || !manifest.repository) {
    throw new Error(`${manifest.name} is missing licence or repository metadata`);
  }
  if (
    effectFree.has(manifest.name) &&
    (manifest.dependencies?.effect !== undefined || manifest.peerDependencies?.effect !== undefined)
  ) {
    throw new Error(`${manifest.name} must not declare an Effect dependency`);
  }
  if (manifest.name === "@samva/markup") {
    const starters = contents.filter((path) => /(?:^|\/)starters(?:\/|\.|$)/.test(path));
    if (starters.length > 0)
      throw new Error(`@samva/markup packs starter paths:\n${starters.join("\n")}`);
  }
  // A sibling range must accept the version this release publishes.
  const markupVersion = expected.get("@samva/markup")?.version;
  const markupRange = manifest.dependencies?.["@samva/markup"];
  if (
    markupRange !== undefined &&
    (!markupVersion || !Bun.semver.satisfies(markupVersion, markupRange))
  ) {
    throw new Error(
      `${manifest.name} packed @samva/markup@${markupRange}, which excludes ${markupVersion}`,
    );
  }

  const temp = await mkdtemp(join(tmpdir(), "sml-package-"));
  try {
    run(["tar", "-xzf", tarballPath, "-C", temp]);
    for (const path of contents.filter((entry) => /\.(?:js|d\.ts|json|md|css)$/.test(entry))) {
      const text = await readFile(join(temp, path), "utf8");
      if ([...repositoryPaths].some((repositoryPath) => text.includes(repositoryPath))) {
        throw new Error(`${tarball} embeds the build checkout path in ${path}`);
      }
      if (privatePackages.test(text))
        throw new Error(`${tarball} names a private package in ${path}`);
    }
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

if (seen.size !== roots.length) throw new Error("Package set is incomplete");
console.log(`Package audit passed (${seen.size} reproducible Bun tarballs)`);
