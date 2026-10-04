#!/usr/bin/env bun

/**
 * Pin `examples/email-starter` to the published authoring packages and refresh
 * what depends on those pins: its standalone `bun.lock`, resolved against the
 * registry, and `starter-manifest.json`, the digest every project-creation
 * path reproduces.
 *
 * The starter is not a workspace member. Its lock carries the integrity of the
 * published `@samva/markup` and `@samva/vite` tarballs, which exist only after
 * `tegami` publishes them, so this runs after a publish rather than inside the
 * Version Packages pull request. With `--pull-request` it commits the refresh
 * on its own branch and opens the pull request for review.
 */

import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dir, "..");
const starterRoot = join(repositoryRoot, "examples", "email-starter");
const manifestPath = join(starterRoot, "starter-manifest.json");
// `.samva` is the gitignored brand snapshot `samva brands pull` writes, never part of the payload.
const excluded = new Set([
  ".git",
  "node_modules",
  "dist",
  ".vite",
  ".samva",
  "starter-manifest.json",
]);
/** A just-published version can take minutes to replicate across the npm registry. */
const registryWaitMs = 10 * 60_000;
const registryInitialDelayMs = 5_000;
const registryMaxDelayMs = 60_000;

const readJson = async (path: string): Promise<Record<string, unknown>> =>
  JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;

const publishedVersion = async (packageDir: string): Promise<string> => {
  const manifest = await readJson(join(repositoryRoot, packageDir, "package.json"));
  if (typeof manifest.version !== "string") throw new Error(`${packageDir} has no version`);
  return manifest.version;
};

const run = async (cwd: string, ...command: readonly string[]): Promise<string> => {
  const child = Bun.spawn([...command], { cwd, stdout: "pipe", stderr: "pipe" });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (exitCode !== 0) throw new Error(`${command.join(" ")} failed:\n${stdout}\n${stderr}`);
  return stdout.trim();
};

/** The starter's committed payload, in the order `starter-manifest.test.js` walks it. */
const payloadFiles = async (): Promise<readonly string[]> => {
  const walk = async (directory: string, prefix: string): Promise<readonly string[]> => {
    const entries = await readdir(directory, { withFileTypes: true });
    const nested = await Promise.all(
      entries.map(async (entry) => {
        if (excluded.has(entry.name)) return [];
        const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
        return entry.isDirectory() ? walk(join(directory, entry.name), relative) : [relative];
      }),
    );
    return nested.flat();
  };
  return [...(await walk(starterRoot, ""))].sort();
};

const digest = async (files: readonly string[]): Promise<string> => {
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(file);
    hash.update("\0");
    hash.update(await readFile(join(starterRoot, file)));
    hash.update("\0");
  }
  return hash.digest("hex");
};

const pinAuthoring = async (markup: string, vite: string): Promise<void> => {
  const path = join(starterRoot, "package.json");
  const manifest = await readJson(path);
  const dependencies = manifest.dependencies as Record<string, string>;
  const devDependencies = manifest.devDependencies as Record<string, string>;
  dependencies["@samva/markup"] = markup;
  devDependencies["@samva/vite"] = vite;
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`);
};

const untilRegistryServes = async (name: string, version: string): Promise<void> => {
  const deadline = Date.now() + registryWaitMs;
  let delay = registryInitialDelayMs;
  for (;;) {
    try {
      const served = await run(repositoryRoot, "npm", "view", `${name}@${version}`, "version");
      if (served === version) return;
    } catch {
      // The registry has not replicated the version yet; keep waiting.
    }
    if (Date.now() + delay > deadline)
      throw new Error(`${name}@${version} not served by the registry after ${registryWaitMs}ms`);
    console.warn(`${name}@${version} not on the registry yet; retrying in ${delay}ms`);
    await Bun.sleep(delay);
    delay = Math.min(delay * 2, registryMaxDelayMs);
  }
};

const resolveLock = async (): Promise<void> => {
  const deadline = Date.now() + registryWaitMs;
  let delay = registryInitialDelayMs;
  for (;;) {
    try {
      await run(starterRoot, "bun", "install");
      return;
    } catch (failure) {
      if (Date.now() + delay > deadline) throw failure;
      console.warn(`starter lock resolution failed; retrying in ${delay}ms`);
      await Bun.sleep(delay);
      delay = Math.min(delay * 2, registryMaxDelayMs);
    }
  }
};

const writeManifest = async (): Promise<void> => {
  const files = await payloadFiles();
  const manifest = { version: 1, files, sha256: await digest(files) };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
};

const openPullRequest = async (markup: string, vite: string): Promise<void> => {
  const version = markup === vite ? markup : `markup-${markup}-vite-${vite}`;
  const branch = `starter/authoring-${version}`;
  const paths = ["examples/email-starter"];
  const changed = await run(repositoryRoot, "git", "status", "--porcelain", "--", ...paths);
  if (changed === "") {
    console.log("starter already consumes the published authoring packages; nothing to open");
    return;
  }
  await run(repositoryRoot, "git", "checkout", "-B", branch);
  await run(repositoryRoot, "git", "add", "--", ...paths);
  await run(
    repositoryRoot,
    "git",
    "-c",
    "user.name=github-actions[bot]",
    "-c",
    "user.email=41898282+github-actions[bot]@users.noreply.github.com",
    "commit",
    "-m",
    `chore(starter): consume authoring ${version}`,
    "-m",
    "Pins the starter to the packages this release published and resolves its standalone lock and tree manifest against them.",
  );
  await run(repositoryRoot, "git", "push", "--force-with-lease", "origin", branch);
  // A push made with the workflow token starts no workflow runs, so the pull request would never
  // get the required `check` status; a dispatch is the one trigger that token may start.
  await run(repositoryRoot, "gh", "workflow", "run", "check.yml", "--ref", branch);
  // A publish retry reaches here with the pull request already open from the
  // first attempt; the pushed branch updates it, so only a missing one is created.
  const existing = await run(
    repositoryRoot,
    "gh",
    "pr",
    "list",
    "--head",
    branch,
    "--base",
    "main",
    "--state",
    "open",
    "--json",
    "url",
    "--jq",
    ".[0].url // empty",
  );
  if (existing !== "") {
    console.log(`starter refresh pull request already open: ${existing}`);
    return;
  }
  await run(
    repositoryRoot,
    "gh",
    "pr",
    "create",
    "--base",
    "main",
    "--head",
    branch,
    "--title",
    `chore(starter): consume authoring ${version}`,
    "--body",
    [
      `Pins \`examples/email-starter\` to \`@samva/markup@${markup}\` and \`@samva/vite@${vite}\`, and resolves its standalone \`bun.lock\` and \`starter-manifest.json\` against the published tarballs.`,
      "",
      "Opened by `scripts/refresh-starter.ts` from the publish workflow. Proof: `bun run starter:check`.",
    ].join("\n"),
  );
};

const markup = await publishedVersion("packages/markup");
const vite = await publishedVersion("packages/vite");
await untilRegistryServes("@samva/markup", markup);
await untilRegistryServes("@samva/vite", vite);
await pinAuthoring(markup, vite);
await resolveLock();
await writeManifest();
console.log(`starter pinned to @samva/markup@${markup} and @samva/vite@${vite}`);
if (process.argv.includes("--pull-request")) await openPullRequest(markup, vite);
