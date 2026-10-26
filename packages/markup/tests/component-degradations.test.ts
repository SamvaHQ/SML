import { describe, expect, it } from "@effect/vitest";

import { COMPONENT_DEGRADATIONS, templateEmailDegradations } from "../src/compatibility";
import { compileTemplate } from "../src/compiler";
import {
  checkCompatibility,
  degradationFindings,
  type ComponentEmailDegradation,
} from "../src/sml/compatibility";
import { BUILTIN_BASELINES } from "./support/rendered-email-baseline";

describe("component email degradation declarations", () => {
  it("declares content fidelity for every supported component without inventing losses", async () => {
    const components = new Set<string>();
    for (const baseline of BUILTIN_BASELINES) {
      const compiled = await compileTemplate(baseline.options);
      expect(compiled.template).toBeDefined();
      if (compiled.template === undefined) return;
      const declarations = templateEmailDegradations(compiled.template);
      for (const declaration of declarations) {
        components.add(declaration.component);
        expect(declaration.kind).toBe("same");
        expect(declaration.note.length).toBeGreaterThan(0);
        expect(declaration.origins[0]?.fileName).toBeDefined();
      }
      expect(degradationFindings(declarations)).toEqual([]);
    }
    expect([...components].sort()).toEqual(Object.keys(COMPONENT_DEGRADATIONS).sort());
  });

  it("keeps imported source locations and declarations from conditional content", async () => {
    const compiled = await compileTemplate({
      entry: "entry.tsx",
      assetBase: "https://assets.example.test/degradations",
      files: {
        "entry.tsx": `import { defineTemplate } from "@samva/markup";
import { Email, Button } from "@samva/markup/email";
import { jsonSchema } from "@samva/markup/input-schema";
import { Part } from "./part";
export default defineTemplate({
  id: "degradations", schema: jsonSchema({ type: "object", required: ["show"], properties: { show: { type: "boolean" } } }),
  fixtures: { hidden: { show: false } },
  email: { subject: () => "Content", body: (input) => <Email>{input.show ? <Part /> : <Button href="https://example.test">Read</Button>}</Email> },
});`,
        "part.tsx": `import { Section } from "@samva/markup/email";
export const Part = () => <Section><p>Conditional content</p></Section>;`,
      },
    });
    expect(compiled.diagnostics.filter((finding) => finding.severity === "error")).toEqual([]);
    const template = compiled.template!;
    const declarations = templateEmailDegradations(template);
    expect(declarations.map(({ component }) => component)).toEqual(["Email", "Section", "Button"]);
    expect(declarations[1]?.origins).toEqual([
      { fileName: "part.tsx", lineNumber: 2, columnNumber: 27 },
    ]);
    expect(
      checkCompatibility(template, compiled.fixtures).filter(
        (finding) => finding.code === "email-component-degradation",
      ),
    ).toEqual([]);
  });

  it("reports static and omitted content beside client findings with the authored origin", () => {
    const origins = [{ fileName: "issue.tsx", lineNumber: 4, columnNumber: 3 }];
    const declarations: ComponentEmailDegradation[] = [
      { component: "Email", kind: "same", note: "Content preserved.", origins },
      { component: "Button", kind: "static", note: "Readers receive a static link.", origins },
      { component: "Image", kind: "omitted", note: "Readers do not receive this image.", origins },
    ];
    const findings = degradationFindings(declarations);
    expect(findings).toHaveLength(2);
    expect(findings.map(({ message }) => message)).toEqual([
      "<Button>: Readers receive a static link.",
      "<Image>: Readers do not receive this image.",
    ]);
    for (const finding of findings) {
      expect(finding.code).toBe("email-component-degradation");
      expect(finding.severity).toBe("warning");
      expect(finding.origins).toEqual(origins);
      expect(finding.compatibility?.assessment).toBe("degradation");
    }
  });

  it("has no email declarations for an SMS template", () => {
    expect(
      templateEmailDegradations({ sml: 2, template: "sms", schema: {}, sms: { body: ["Hello"] } }),
    ).toEqual([]);
  });
});
