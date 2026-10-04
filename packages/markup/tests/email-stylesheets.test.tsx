/** @jsxImportSource @samva/markup/email */
import { afterEach, beforeEach, describe, expect, it } from "@effect/vitest";

import { Email, Section } from "../src/email/components";
import { parseStylesheet } from "../src/email/css";
import { corpusTemplate } from "./fixtures/email-compile";
import { renderEmail } from "./support/email-fixture";
import {
  collectStylesheets,
  registerStylesheet,
  resetStylesheets,
} from "./support/stylesheet-registry";

// A template imports its stylesheets; the compiler rewrites each import into a
// module that registers parsed rules here. These tests stand in for that module
// graph by registering the same values by hand, in import order.

const message = (body: () => ReturnType<typeof Email>) =>
  corpusTemplate<Record<string, never>>({ type: "object" }, () => ({
    subject: "Styled",
    body: body(),
  }));

// This fixture registers sheets directly instead of evaluating a generated reset module.
// Vitest reuses the runtime registry between files, so establish that same entry boundary.
beforeEach(() => {
  resetStylesheets();
});

afterEach(() => {
  resetStylesheets();
});

describe("registered stylesheets reach the render", () => {
  it("inlines what a client honors and puts the rest in <head>", () => {
    registerStylesheet(
      parseStylesheet(
        ".card{padding:16px;color:#111111}@media (width>=40rem){.card{padding:32px}}",
        { origin: "styles.css" },
      ),
    );
    const rendered = renderEmail(
      message(() => (
        <Email title="Styled">
          <Section>
            <p className="card">Hello</p>
          </Section>
        </Email>
      )),
      {},
    );
    expect(rendered.html).toContain('<p class="card" style="padding:16px;color:#111111">');
    expect(rendered.html).toContain(
      "<style>@media (min-width:40rem){.card{padding:32px!important}}</style>",
    );
    // The retained rule sits inside the document head, ahead of the body.
    expect(rendered.html.indexOf("<style>")).toBeLessThan(rendered.html.indexOf("<body"));
  });

  it("orders sheets by import order, so a later import wins a specificity tie", () => {
    registerStylesheet(parseStylesheet(".a{color:#111111}", { origin: "first.css" }));
    registerStylesheet(parseStylesheet(".a{color:#222222}", { origin: "second.css" }));
    const rendered = renderEmail(
      message(() => (
        <Email>
          <p className="a">Hello</p>
        </Email>
      )),
      {},
    );
    expect(rendered.html).toContain("color:#222222");
  });

  it("refuses to drop styles that need a <head> the message does not have", () => {
    registerStylesheet(
      parseStylesheet("@media (width>=40rem){.a{padding:32px}}", { origin: "styles.css" }),
    );
    expect(() =>
      renderEmail(
        corpusTemplate<Record<string, never>>({ type: "object" }, () => ({
          subject: "No shell",
          body: <p className="a">Hello</p>,
        })),
        {},
      ),
    ).toThrow("missing-head");
  });

  it("renders unstyled markup unchanged when nothing is registered", () => {
    const rendered = renderEmail(
      message(() => (
        <Email>
          <p className="a">Hello</p>
        </Email>
      )),
      {},
    );
    expect(rendered.html).toContain('<p class="a">Hello</p>');
    expect(rendered.html).not.toContain("<style>");
  });
});

describe("registry isolation between renders", () => {
  it("accumulates across projects, which is why a test has to clear it", () => {
    registerStylesheet(parseStylesheet(".first{color:#111111}", { origin: "first.css" }));
    registerStylesheet(parseStylesheet(".second{color:#222222}", { origin: "second.css" }));
    // A host that renders two projects in one process shares this module, so
    // without a reset the second project inherits the first project's rules.
    expect(collectStylesheets().rules.map((rule) => rule.selector)).toEqual([".first", ".second"]);
    resetStylesheets();
    registerStylesheet(parseStylesheet(".second{color:#222222}", { origin: "second.css" }));
    expect(collectStylesheets().rules.map((rule) => rule.selector)).toEqual([".second"]);
  });
});
