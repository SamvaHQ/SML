import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "@effect/vitest";
import { render } from "@samva/markup/render";

import { buildTemplates } from "../src/build";
import { exportProject, loadProject } from "../src/project";
import { renderTemplate } from "../src/render";
import { cleanupProjects, tempProject } from "./support/project";

afterEach(cleanupProjects);

const layout = `
import { defineTemplate } from "@samva/markup";
import { jsonSchema } from "@samva/markup/input-schema";
import { Email, Section, IssueContent } from "@samva/markup/email";
export default defineTemplate({ id: "newsletter-layout", schema: jsonSchema({ type: "object", properties: {}, additionalProperties: false }), fixtures: { default: {} }, email: { subject: () => "Layout", body: () => <Email><Section><IssueContent /></Section></Email> } });
`;
const issue = (slug: string, prose: string) =>
  `---\ntitle: ${slug} news\nslug: ${slug}\ntopic: product\n---\n# ${slug}\n\n${prose}\n`;

describe("Markdown issue projects", () => {
  it("discovers issues by path separately from registered templates, using a configured layout", async () => {
    const root = await tempProject({
      "shell/newsletter.tsx": layout,
      "issues/first.md": issue("first", "First story"),
      "issues/second.md": issue("second", "Second story"),
      "issues/broken.md": issue("broken", "<Script />"),
      "ignored.md": issue("ignored", "Ignored"),
      "issues/.hidden.md": issue("hidden", "Hidden"),
    });
    const project = await loadProject({ root, issueLayout: "shell/newsletter.tsx" });
    expect(project.catalog.templates).toEqual([]);
    expect(project.catalog.issues.map((entry) => entry.entryPath)).toEqual([
      "issues/first.md",
      "issues/second.md",
    ]);
    expect(project.catalog.failures.map((entry) => entry.entryPath)).toEqual(["issues/broken.md"]);
    expect(project.files["issues/first.md"]).toContain("First story");
    const first = project.catalog.issues[0]!;
    expect(render(first.compiled, first.fixtures.default, { target: "web" }).html).toContain(
      "First story",
    );
    expect(first.frontmatter.topic).toBe("product");
  });

  it("renders, builds and exports a Markdown issue through the normal project boundaries", async () => {
    const root = await tempProject({
      "layout.tsx": layout,
      "issues/first.md": issue("first", "First story"),
    });
    const result = await renderTemplate({ root, template: "issues/first.md", fixture: "default" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.subject).toBe("first news");
      expect(result.html).toContain("First story");
    }
    const build = await buildTemplates({ root });
    expect(build.files.map(({ id, kind }) => ({ id, kind }))).toEqual([
      { id: "issues/first.md", kind: "md" },
    ]);
    expect(build.files[0]?.template?.fixtures[0]?.email?.html).toContain("First story");
    const exported = await exportProject({ root, out: join(root, "export") });
    expect(exported.templates[0]?.fixtures[0]?.html).toBe("issues/first/default.html");
    expect(await readFile(join(root, "export/issues/first/default.html"), "utf8")).toContain(
      "First story",
    );
  });

  it("keeps issue slug conflicts separate from template identity", async () => {
    const ordinary = layout
      .replace('id: "newsletter-layout"', 'id: "same"')
      .replace("<IssueContent />", "<p>Ordinary template</p>");
    const root = await tempProject({
      "layout.tsx": layout,
      "templates/same.tsx": ordinary,
      "issues/first.md": issue("same", "First"),
      "issues/second.md": issue("same", "Second"),
    });
    const result = await renderTemplate({ root, template: "same", fixture: "default" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.html).toContain("Ordinary template");
  });

  it("rejects duplicate slugs and reports a missing layout against the issue", async () => {
    const root = await tempProject({
      "layout.tsx": layout,
      "issues/first.md": issue("same", "First"),
      "issues/second.md": issue("same", "Second"),
    });
    expect(
      (await loadProject({ root })).diagnostics.some(
        (item) => item.code === "duplicate-issue-slug",
      ),
    ).toBe(true);
    const rendered = await renderTemplate({ root, template: "same", fixture: "default" });
    expect(rendered.ok).toBe(false);
    const noLayout = await tempProject({ "issues/first.md": issue("first", "First") });
    expect((await loadProject({ root: noLayout })).catalog.failures[0]?.diagnostics[0]?.code).toBe(
      "issue-layout",
    );
  });
});
