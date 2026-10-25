import { createHash } from "node:crypto";

import { describe, expect, it } from "@effect/vitest";

import { compileTemplate } from "../src/compiler";
import { render } from "../src/render";
import { EMAIL_REGRESSIONS } from "./support/semantic-email-regressions";

// Full subject/preheader/html/text captures from locked base 2b40779294e8b7986e6f0a851788d423d4d31927.
// The capture predates the context/depth fixes; these digests have no regeneration path.
const BASE_DIGESTS: Readonly<Record<string, string>> = {
  "deep-body": "b9684a4aa228f4f226c4cfb64e66ec6e8f03644e861c43b44bfb9f7a453ac5e2",
  "partial-static": "38316de492a196023d9fc23f5ea44d4f4499e1a24b8f5e972f8769c128c59b99",
  "partial-each": "333489307937c6fc0d4a71d94ee0be62128092e68339ed068b4e02dc3ec51770",
  "partial-per": "1c7990a653872e2686f159761047ec8fe7fca421c2bff743d68882c7d958386d",
  "mixed-static": "5632feae38843053d47c345a6946d3da6de6523ee1b1b428510507fad227d508",
  "direct-per": "4b3831b16958cd64c57fc2a95e1257b8dcf92369da5e6e193489250312d0144c",
};

describe("email depth and compile-resolved partial cell layout", () => {
  it.each(EMAIL_REGRESSIONS)(
    "preserves locked-base output for $name",
    async ({ name, options }) => {
      const compiled = await compileTemplate(options);
      expect(compiled.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
      expect(compiled.template).toBeDefined();
      const output = render(compiled.template!, compiled.fixtures.basic, { target: "email" });
      expect(createHash("sha256").update(JSON.stringify(output)).digest("hex")).toBe(
        BASE_DIGESTS[name],
      );
      if (name.startsWith("partial-")) {
        expect(output.html).not.toMatch(/<td[^>]*class="[^"]*\bsml-stack\b/);
        expect(output.html).not.toMatch(/<td[^>]*width=/);
      }
      if (name === "mixed-static") {
        expect(output.html).toContain('<td class="sml-stack">Direct</td><td>Partial</td>');
      }
      if (name === "direct-per") expect(output.html).toContain('width="50%"');
    },
  );
});
