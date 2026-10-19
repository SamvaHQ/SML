import { expect, it } from "@effect/vitest";

import { compileTemplate } from "../src/compiler";
import { render } from "../src/render-template";
import {
  PARITY_COMPILE_DIGEST,
  PARITY_COMPILE_OPTIONS,
  PARITY_DIGESTS,
  PARITY_ENTRY,
  PARITY_PROJECT,
  parityCompileText,
  parityDigest,
  parityDigests,
} from "./support/email-parity";

// The package half of the golden-digest parity check. Samva's hosted runtime asserts the same
// values from its own copy of the corpus, so a compiler change that alters published output fails
// here before a release carries it there.

it("compiles and renders the parity corpus to the golden digests", async () => {
  const compiled = await compileTemplate({
    files: PARITY_PROJECT,
    entry: PARITY_ENTRY,
    ...PARITY_COMPILE_OPTIONS,
  });
  expect(compiled.diagnostics).toEqual([]);
  expect(compiled.template).toBeDefined();
  if (compiled.template === undefined) return;
  expect(await parityDigest(parityCompileText(compiled))).toBe(PARITY_COMPILE_DIGEST);
  expect(
    await parityDigests(render(compiled.template, compiled.fixtures.basic, { channel: "email" })),
  ).toEqual(PARITY_DIGESTS);
});
