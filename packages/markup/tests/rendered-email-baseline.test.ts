import { readFile, readdir } from "node:fs/promises";

import { describe, expect, it } from "@effect/vitest";

import { compileTemplate } from "../src/compiler";
import * as emailComponents from "../src/email";
import { brandComponents } from "../src/email/brand";
import { render } from "../src/render-template";
import manifest from "./fixtures/rendered-email-baseline/manifest.json";
import starterFiles from "./fixtures/rendered-email-baseline/starter-project.json";
import {
  BASELINE_DIRECTORY,
  BASELINE_HEAD,
  BUILTIN_BASELINES,
  starterProject,
} from "./support/rendered-email-baseline";

const projects = [
  ...BUILTIN_BASELINES,
  ...manifest.starterEntries.map((entry) => ({
    name: `starter-${entry.slice("templates/".length, -4)}`,
    options: {
      files: starterFiles,
      entry,
      assetBase: "https://assets.example.test/baseline",
      tailwind: { css: starterFiles["theme.css"], cssPath: "theme.css" },
    },
  })),
];

// These are full outputs captured before compiler/renderer changes. This test deliberately has
// no update path: a mismatch must be reviewed against the captured bytes, including whitespace.
describe("rendered email baseline", () => {
  it("covers the built-in components and every starter entry and fixture", async () => {
    expect(manifest.head).toBe(BASELINE_HEAD);
    expect(manifest.components.toSorted()).toEqual(
      [
        ...Object.entries(emailComponents)
          // IssueContent is a compile-time directive; it has no standalone rendered output.
          .filter(
            ([name, value]) =>
              name !== "IssueContent" && /^[A-Z]/.test(name) && typeof value === "function",
          )
          .map(([name]) => name),
        ...Object.keys(brandComponents({ slug: "bare", css: "" })),
      ].sort(),
    );
    expect(projects.map(({ name }) => name)).toEqual(manifest.projects.map(({ name }) => name));

    const currentStarter = await starterProject();
    expect(currentStarter).toEqual(starterFiles);
    expect(
      Object.entries(currentStarter)
        .filter(
          ([path, source]) =>
            path.endsWith(".tsx") && /export\s+default\s+defineTemplate\s*\(/.test(source),
        )
        .map(([path]) => path),
    ).toEqual(manifest.starterEntries);

    const expectedFiles = ["README.md", "manifest.json", "starter-project.json"];
    for (const project of manifest.projects) {
      for (const fixture of project.fixtures) {
        for (const field of [
          "subject",
          "html",
          "text",
          ...(fixture.preheader ? ["preheader"] : []),
        ]) {
          expectedFiles.push(`${project.name}.${fixture.name}.${field}.golden`);
        }
      }
    }
    expect((await readdir(BASELINE_DIRECTORY)).sort()).toEqual(expectedFiles.sort());
  });

  for (const baseline of manifest.projects) {
    describe(baseline.name, () => {
      for (const fixture of baseline.fixtures) {
        it(`preserves ${fixture.name} subject, preheader, HTML and text byte-for-byte`, async () => {
          const project = projects.find(({ name }) => name === baseline.name);
          expect(project).toBeDefined();
          if (project === undefined) return;
          const compiled = await compileTemplate(project.options);
          expect(compiled.diagnostics.map(({ code, severity }) => ({ code, severity }))).toEqual(
            baseline.diagnostics,
          );
          expect(Object.keys(compiled.fixtures)).toEqual(baseline.fixtures.map(({ name }) => name));
          expect(compiled.template).toBeDefined();
          if (compiled.template === undefined) return;

          const rendered = render(compiled.template, compiled.fixtures[fixture.name], {
            target: "email",
            locale: "en-US",
            timeZone: "UTC",
          });
          expect(Object.keys(rendered).sort()).toEqual(["html", "preheader", "subject", "text"]);
          for (const field of ["subject", "preheader", "html", "text"] as const) {
            if (field === "preheader" && !fixture.preheader) {
              expect(rendered.preheader).toBeUndefined();
              continue;
            }
            const expected = await readFile(
              new URL(`${baseline.name}.${fixture.name}.${field}.golden`, BASELINE_DIRECTORY),
              "utf8",
            );
            expect(rendered[field], `${baseline.name}/${fixture.name}/${field}`).toBe(expected);
          }
        });
      }
    });
  }
});
