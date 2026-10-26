import { describe, expect, it } from "@effect/vitest";

import { compileIssue } from "../src/issue";
import { parseIssue } from "../src/markdown";
import { render } from "../src/render";
import {
  applySourceReplacements,
  inspectMarkdownNode,
  literalReplacement,
} from "../src/source-edit";

const file = "issues/news.md";
const metadata = "---\ntitle: News\nslug: news\ntopic: product\n---\n";
const origin = { fileName: file, lineNumber: 6, columnNumber: 1 };

const layout = `import {defineTemplate} from "@samva/markup";
import {jsonSchema} from "@samva/markup/input-schema";
import {Email,IssueContent} from "@samva/markup/email";
export default defineTemplate({id:"layout",schema:jsonSchema({type:"object",properties:{}}),fixtures:{default:{}},email:{subject:()=>"News",body:()=> <Email><IssueContent /></Email>}});`;

describe("Markdown origins shared by authored elements", () => {
  it("prefers editable leading links over their mixed-content paragraph", () => {
    const source = metadata + "[Read](https://example.com) more";
    const selected = inspectMarkdownNode(source, file, origin)!;
    expect(selected.tag).toBe("a");
    const field = selected.properties.find((property) => property.name === "href")!;
    expect(source.slice(field.start, field.end)).toBe("https://example.com");
    const changed = applySourceReplacements(
      source,
      [literalReplacement(source, field, "https://example.com/next")!],
      { markdown: { file } },
    );
    expect(changed.ok).toBe(true);
    if (changed.ok) {
      const issue = parseIssue(changed.source, file);
      expect(issue.diagnostics).toEqual([]);
      expect(issue.nodes).toMatchObject([{ tag: "p", children: [{ tag: "a" }, " more"] }]);
      expect(
        inspectMarkdownNode(changed.source, file, origin)?.properties.find(
          (property) => property.name === "href",
        )?.value,
      ).toBe("https://example.com/next");
    }
  });

  it("resolves each rendered intrinsic sharing the same origin using its tag", async () => {
    const source = metadata + "[Read](https://example.com) more";
    const compiled = await compileIssue({
      files: { [file]: source, "layout.tsx": layout },
      entry: file,
      assetBase: "",
    });
    expect(compiled.diagnostics.filter((finding) => finding.severity === "error")).toEqual([]);
    const page = render(compiled.template!, {}, { target: "web" });
    const shared = page.positions.filter(
      (position) => position.src?.[0] === 6 && position.src[1] === 1 && position.src[2] === 1,
    );
    expect(shared.map((position) => position.tag).sort()).toEqual(["a", "p"]);
    for (const position of shared) {
      const selected = inspectMarkdownNode(source, file, origin, { tag: position.tag });
      expect(selected?.tag).toBe(position.tag);
      if (position.tag === "a")
        expect(selected?.properties.some((property) => property.name === "href")).toBe(true);
      else expect(selected?.properties).toEqual([]);
    }
    expect(inspectMarkdownNode(source, file, origin, { tag: "img" })).toBeNull();
  });

  it.each([
    ["![Alt](https://example.com/logo.png) trailing", "img", "src"],
    ["**Bold** trailing", "strong", "children"],
    ["Plain text", "p", "children"],
  ])("resolves editable %s without selecting a source-only text record", (body, tag, property) => {
    const selected = inspectMarkdownNode(metadata + body, file, origin);
    expect(selected?.tag).toBe(tag);
    expect(selected?.properties.some((field) => field.name === property)).toBe(true);
  });
});
