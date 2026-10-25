import { checkCompatibility } from "@samva/markup/compatibility";
import { previewEmail } from "@samva/markup/edit";
import { compileIssue } from "@samva/markup/markdown";
import { describe, expect, it } from "vitest";

import { emailDifferences } from "../src/chrome/email-differences";

// Every component today declares its email render as "same" as its web render, so the compiler
// reports no degradation. The panel's row shape is covered by the synthetic Chart finding in
// dual-preview.test.tsx; this pins what a real fixture shows: nothing differs.

const LAYOUT = `import { defineTemplate } from "@samva/markup";
import { jsonSchema } from "@samva/markup/input-schema";
import { Email, IssueContent } from "@samva/markup/email";
export default defineTemplate({
  id: "layout",
  schema: jsonSchema({ type: "object", properties: {} }),
  fixtures: { reader: {} },
  email: { subject: () => "News", body: () => <Email><IssueContent /></Email> },
});
`;
const ISSUE = "---\ntitle: News\nslug: news\ntopic: product\n---\n\n# Hello\n\nSome words.\n";

describe("Email differences on a real fixture", () => {
  it("reports none when the compiler finds no degradation", async () => {
    const compiled = await compileIssue({
      files: { "layout.tsx": LAYOUT, "issues/news.md": ISSUE },
      entry: "issues/news.md",
      assetBase: "",
      tailwind: false,
    });
    expect(compiled.template).toBeDefined();
    const template = compiled.template!;
    const diagnostics = checkCompatibility(template, compiled.fixtures);
    const preview = previewEmail(template, compiled.fixtures.reader);
    const rows = emailDifferences(
      [{ id: "compatibility", severity: "info", label: "", detail: "", diagnostics }],
      preview.selections,
    );
    expect(rows).toEqual([]);
  });
});
