#!/usr/bin/env bun

/**
 * Release config for the SML packages.
 *
 * Tegami owns versioning, dependency ordering, registry preflight, publishing, tags and GitHub
 * releases. The repository's own publish-time work is building and auditing the exact package
 * roots with `bun pm pack` before Tegami publishes, and refreshing the starter once the packages it
 * pins exist on the registry.
 */

import { tegami, type TegamiPlugin } from "tegami";
import { runCli } from "tegami/cli";
import { github } from "tegami/plugins/github";

const REPOSITORY = "SamvaHQ/SML";
const publicNames = new Set(["@samva/editor", "@samva/markup", "@samva/vite"]);
/** The packages the starter pins; a release of either refreshes it. */
const starterNames = new Set(["@samva/markup", "@samva/vite"]);

const releaseChecks = (): TegamiPlugin => ({
  name: "sml-release-checks",
  enforce: "pre",
  async afterPreflight({ plan }) {
    const shouldPublish = [...plan.packages.entries()].some(
      ([id, packagePlan]) =>
        publicNames.has(this.graph.get(id)?.name ?? "") &&
        packagePlan.preflight?.shouldPublish === true,
    );
    if (!shouldPublish) return;
    if (plan.options.dryRun) {
      console.log("[dry-run] would build and audit every public package root");
      return;
    }

    const child = Bun.spawn(["bun", "run", "scripts/check-packages.ts"], {
      cwd: this.cwd,
      stdout: "inherit",
      stderr: "inherit",
    });
    if ((await child.exited) !== 0) {
      throw new Error("Package build and audit failed");
    }
  },
  async afterPublishAll({ plan }) {
    // The starter is a standalone project pinned to the published packages, so its registry lock
    // can only be resolved once they exist.
    const publishedStarterPackage = plan
      .getPackagesToPublish()
      .some(
        (pkg) =>
          starterNames.has(pkg.name) &&
          plan.packages.get(pkg.id)?.publishResult?.type === "published",
      );
    if (!publishedStarterPackage) return;
    if (plan.options.dryRun) {
      console.log("[dry-run] would refresh examples/email-starter against the published packages");
      return;
    }
    const child = Bun.spawn(["bun", "run", "scripts/refresh-starter.ts", "--pull-request"], {
      cwd: this.cwd,
      stdout: "inherit",
      stderr: "inherit",
    });
    if ((await child.exited) !== 0) {
      throw new Error("Starter refresh after the publish failed");
    }
  },
});

const paper = tegami({
  ignore: ["sml", "@samva/vite-editor-app"],
  npm: {
    client: "bun",
    updateLockFile: true,
    trustedPublish: {
      provider: "github",
      workflow: "publish.yml",
    },
    bumpDep: ({ dependent, kind }) => {
      if (!publicNames.has(dependent.name)) return false;
      switch (kind) {
        case "dependencies":
        case "optionalDependencies":
          return "patch";
        default:
          return false;
      }
    },
  },
  groups: {
    authoring: { syncBump: true, syncGitTag: true },
  },
  packages: {
    "@samva/editor": { group: "authoring" },
    "@samva/markup": { group: "authoring" },
    "@samva/vite": { group: "authoring" },
  },
  plugins: [
    github({
      repo: REPOSITORY,
      pushTags: true,
      versionPr: {
        branch: "tegami/version-packages",
        base: "main",
        forceCreate: false,
        create() {
          return { title: "chore(release): prepare packages" };
        },
      },
      release: {
        create({ tag }) {
          return { title: tag };
        },
      },
    }),
    releaseChecks(),
  ],
});

await runCli(paper);
