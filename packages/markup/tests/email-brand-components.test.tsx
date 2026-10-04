/** @jsxImportSource @samva/markup/email */
import { describe, expect, it } from "@effect/vitest";

import {
  BRAND_COMPONENT_CLASSES,
  brandComponents,
  renderedFooterMarkers,
  withoutUnsubscribeRow,
  type EmailBrand,
} from "../src/email/brand";
import { renderBrandFooter } from "../src/email/brand-footer";
import { samvaBrandPlugin } from "../src/email/brand-plugin";
import { EmailCompileError } from "../src/email/diagnostics";
import { compileEmail } from "../src/email/render";
import { transformProject } from "../src/email/transform";
import { diagnosticCodes } from "./fixtures/email-compile";

const {
  footerAttribute: FOOTER_ATTRIBUTE,
  unsubscribeUrlPlaceholder: UNSUBSCRIBE_URL_PLACEHOLDER,
} = samvaBrandPlugin;

const BRAND: EmailBrand = {
  slug: "acme",
  css: "",
  assets: {
    logoUrl: "https://cdn.acme.test/logo.png",
    logoDarkUrl: "https://cdn.acme.test/logo-dark.png",
  },
  footer: {
    companyName: "Acme Inc.",
    address: {
      street1: "1 Market St",
      city: "San Francisco",
      region: "CA",
      postalCode: "94105",
      country: "US",
    },
    socialLinks: [
      { label: "X", url: "https://x.com/acme" },
      { label: "GitHub", url: "https://github.com/acme" },
    ],
  },
};

describe("BrandFooter", () => {
  it("renders the sign-off, marked as the template's footer, with the unsubscribe placeholder", () => {
    const { BrandFooter } = brandComponents(BRAND);
    const output = compileEmail(<BrandFooter />);
    expect(output.diagnostics).toEqual([]);
    expect(output.html).toContain(`${FOOTER_ATTRIBUTE}=""`);
    expect(output.html).toContain("Acme Inc.");
    expect(output.html).toContain("1 Market St<br />San Francisco, CA, 94105<br />US");
    expect(output.html).toContain('href="https://github.com/acme"');
    expect(output.html).toContain(
      `<tr data-samva-unsubscribe=""><td style="padding:0 0 8px 0"><a href="${UNSUBSCRIBE_URL_PLACEHOLDER}" data-samva-no-track`,
    );
    expect(output.text).toContain(`Unsubscribe (${UNSUBSCRIBE_URL_PLACEHOLDER})`);
  });

  it("omits what the brand does not set", () => {
    const { BrandFooter } = brandComponents({ slug: "bare", css: "" });
    const output = compileEmail(<BrandFooter unsubscribeLabel="Opt out" />);
    expect(output.diagnostics).toEqual([]);
    expect(output.html).not.toContain("<br />");
    expect(output.text.trim()).toBe(`Opt out (${UNSUBSCRIBE_URL_PLACEHOLDER})`);
  });

  it("keeps the footer markers away from author-written elements", () => {
    expect(diagnosticCodes(<div data-samva-footer="">Our footer</div>)).toEqual([
      "reserved-attribute",
    ]);
    expect(diagnosticCodes(<p data-samva-unsubscribe="">x</p>)).toEqual(["reserved-attribute"]);
    expect(
      diagnosticCodes(
        <a href="https://example.com" data-samva-no-track="">
          x
        </a>,
      ),
    ).toEqual(["reserved-attribute"]);
  });

  it("keeps the placeholder exemption away from author-written links", () => {
    expect(diagnosticCodes(<a href={UNSUBSCRIBE_URL_PLACEHOLDER}>Unsubscribe</a>)).toEqual([
      "unsafe-url",
    ]);
  });
});

describe("BrandLogo", () => {
  it("swaps to the dark logo only where the client honors dark mode", () => {
    const { BrandLogo } = brandComponents(BRAND);
    const output = compileEmail(<BrandLogo width={96} />);
    expect(output.diagnostics).toEqual([]);
    expect(output.html).toContain(
      'src="https://cdn.acme.test/logo.png" alt="Acme Inc." width="96"',
    );
    expect(output.html).toContain('class="dark:hidden!"');
    expect(output.html).toContain('class="hidden dark:block!"');
    expect(output.html).toContain("mso-hide:all");
    expect(output.html).toContain('src="https://cdn.acme.test/logo-dark.png"');
  });

  it("renders one image without a dark logo, and nothing without a logo", () => {
    const light = brandComponents({ ...BRAND, assets: { logoUrl: BRAND.assets!.logoUrl } });
    expect(compileEmail(<div>{light.BrandLogo({})}</div>).html.match(/<img /g)).toHaveLength(1);
    expect(brandComponents({ slug: "bare", css: "" }).BrandLogo({})).toBeNull();
  });
});

const ENTRY = `/** @jsxImportSource @samva/markup/email */
import { BrandFooter, BrandLogo } from "samva:brand";
export const view = () => <div><BrandLogo /><BrandFooter /></div>;
`;

describe("samva:brand in TSX", () => {
  it("compiles the components' own classes even though no project source names them", async () => {
    const compiled = await transformProject(
      { "emails/welcome.tsx": ENTRY, "emails/nested/part.tsx": ENTRY },
      { assetBase: "https://assets.samva.test/b", brand: BRAND },
    );
    const tailwind = JSON.stringify(compiled.tailwindSheet ?? "");
    for (const name of ["text-gray-500", "underline"]) expect(tailwind).toContain(name);
    expect(BRAND_COMPONENT_CLASSES).toContain("text-gray-500");
  });

  it("refuses a brand import the build has no brand for, where it is written", async () => {
    const error = await transformProject(
      { "emails/welcome.tsx": ENTRY },
      { assetBase: "https://assets.samva.test/b" },
    ).then(
      () => undefined,
      (cause: unknown) => cause,
    );
    expect(error).toBeInstanceOf(EmailCompileError);
    const [origin] = (error as EmailCompileError).diagnostics[0]?.origins ?? [];
    expect([origin?.fileName, origin?.lineNumber]).toEqual(["emails/welcome.tsx", 2]);
  });
});

describe("the send path's view of a footer", () => {
  it("renders the fallback footer from the brand, with or without the unsubscribe row", async () => {
    const withLink = await renderBrandFooter(BRAND, { unsubscribe: true });
    expect(withLink.html).toContain(`${FOOTER_ATTRIBUTE}=""`);
    expect(withLink.html).toContain("Acme Inc.");
    // Styled by the compiled utilities, inline.
    expect(withLink.html).toMatch(
      /<td[^>]*class="text-xs text-gray-500 text-center"[^>]*style="[^"]*font-size:/,
    );
    expect(renderedFooterMarkers(withLink.html)).toEqual({ footer: true, unsubscribeLink: true });
    expect(withLink.text).toContain(`Unsubscribe (${UNSUBSCRIBE_URL_PLACEHOLDER})`);

    const withoutLink = await renderBrandFooter(BRAND, { unsubscribe: false });
    expect(renderedFooterMarkers(withoutLink.html)).toEqual({
      footer: true,
      unsubscribeLink: false,
    });
    expect(withoutLink.text).not.toContain(UNSUBSCRIBE_URL_PLACEHOLDER);
    expect(withoutLink.text).toContain("Acme Inc.");
  });

  it("lets a brand's theme restyle the footer's own utilities", async () => {
    const themed = await renderBrandFooter(
      { ...BRAND, css: "@theme {\n  --color-gray-500: #123456;\n}" },
      { unsubscribe: true },
    );
    expect(themed.html).toContain("color:#123456");
  });

  it("strips the unsubscribe row from a rendered template when no group resolved", () => {
    const { BrandFooter } = brandComponents(BRAND);
    const rendered = compileEmail(<BrandFooter />);
    const stripped = withoutUnsubscribeRow(rendered);
    expect(stripped.html).not.toContain("data-samva-unsubscribe");
    expect(stripped.html).toContain("Acme Inc.");
    expect(stripped.text).not.toContain(UNSUBSCRIBE_URL_PLACEHOLDER);
  });

  it("does not take a marker without the placeholder link for a footer that carries one", () => {
    expect(renderedFooterMarkers('<div data-samva-footer="">fake</div>')).toEqual({
      footer: true,
      unsubscribeLink: false,
    });
  });
});
