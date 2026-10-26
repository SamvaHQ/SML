import { render, RenderError } from "../render-template";
import { compileTemplate } from "../sml/compile";
import type { EmailBrand } from "./brand";
import type { BrandPlugin } from "./brand-plugin";
import type { TemplateDiagnostic } from "./diagnostics";
import { samvaBrandPlugin } from "./samva-brand-plugin";

// A sample email in a brand, for previewing a brand before it is saved. The sample is an ordinary
// template that imports the brand, compiled and rendered the way a template that imports the brand
// is, so the preview shows what such a template sends.

const ENTRY = "sample.tsx";

const sampleSource = (plugin: BrandPlugin) => `import { defineTemplate } from "@samva/markup";
import { Email, Section } from "@samva/markup/email";
import { jsonSchema } from "@samva/markup/input-schema";
import { BrandFooter, BrandLogo } from ${JSON.stringify(plugin.specifier)};

export default defineTemplate({
  id: "brand-preview",
  schema: jsonSchema({ type: "object", properties: {} }),
  fixtures: { default: {} },
  email: {
    subject: () => "Your order is on its way",
    body: () => (
      <Email className="bg-background font-sans">
        <Section style={{ padding: "32px 24px" }}>
          <BrandLogo />
          <h1 className="text-2xl font-semibold text-foreground font-heading">Your order is on its way</h1>
          <p className="text-base text-foreground font-sans">
            Thanks for your order. Here is a quick summary, and a link to follow it to your door.
          </p>
          <div className="p-4 rounded bg-card text-card-foreground">
            <p className="inline-block px-2 py-1 text-sm font-semibold rounded bg-accent text-accent-foreground">
              Order 1042
            </p>
            <p className="text-sm text-muted-foreground">2 items, arriving Thursday</p>
          </div>
          <p>
            <a
              href="https://example.com/orders/1042"
              className="inline-block px-6 py-3 font-semibold no-underline rounded bg-primary text-primary-foreground"
            >
              Track your order
            </a>
          </p>
        </Section>
        <BrandFooter />
      </Email>
    ),
  },
});
`;

/** The preview's HTML, or `undefined` when a finding blocks it. */
export interface BrandPreview {
  readonly html: string | undefined;
  readonly diagnostics: readonly TemplateDiagnostic[];
}

export const previewBrand = async (
  brand: EmailBrand,
  options: { readonly brandPlugin?: BrandPlugin | undefined } = {},
): Promise<BrandPreview> => {
  const plugin = options.brandPlugin ?? samvaBrandPlugin;
  const compiled = await compileTemplate({
    files: { [ENTRY]: sampleSource(plugin) },
    entry: ENTRY,
    // The sample imports no project files, so no asset is addressed against this base.
    assetBase: "/",
    tailwind: { css: `@import ${JSON.stringify(plugin.specifier)};` },
    brand,
    brandPlugin: plugin,
  });
  if (compiled.template === undefined)
    return { html: undefined, diagnostics: compiled.diagnostics };
  // The brand reaches the compiled sample as data (logo and social URLs), so the render can refuse
  // it; those refusals are findings about the brand, returned like the compile's.
  // oxlint-disable-next-line samva/no-try-catch-or-throw -- render signals a refused render by throwing RenderError; this API returns findings instead.
  try {
    const { html } = render(compiled.template, {}, { target: "email", brandPlugin: plugin });
    return { html, diagnostics: compiled.diagnostics };
  } catch (cause) {
    // oxlint-disable-next-line samva/no-try-catch-or-throw -- Anything but a RenderError is a defect, not a finding about the brand.
    if (!RenderError.is(cause)) throw cause;
    return {
      html: undefined,
      diagnostics: [
        ...compiled.diagnostics,
        ...cause.diagnostics.map((finding) => ({
          code: finding.code,
          severity: "error" as const,
          message: finding.message,
          origins: [],
        })),
      ],
    };
  }
};
