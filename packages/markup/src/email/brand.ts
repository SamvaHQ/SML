import { BRAND_FOOTER_MARKER, UNSUBSCRIBE_LINK } from "../internal/unsubscribe-link";
import type { BrandPlugin } from "./brand-plugin";
import { escapeAttribute } from "./html";
import { Fragment, jsx, type EmailChild, type EmailNode } from "./jsx-runtime";
import { samvaBrandPlugin } from "./samva-brand-plugin";

// A brand as a build receives it: the organization's brand theme, logo assets
// and footer details, resolved by the host for the brand import the project
// makes. The compiler never fetches one; the host passes it in, and a
// publication snapshots exactly what this build compiled against.

export interface EmailBrandAddress {
  readonly street1: string;
  readonly street2?: string | undefined;
  readonly city: string;
  readonly region: string;
  readonly postalCode: string;
  readonly country: string;
}

export interface EmailBrandSocialLink {
  readonly label: string;
  readonly url: string;
}

export interface EmailBrandAssets {
  readonly logoUrl?: string | undefined;
  readonly logoDarkUrl?: string | undefined;
  readonly iconUrl?: string | undefined;
}

export interface EmailBrandFooter {
  readonly companyName?: string | undefined;
  readonly address?: EmailBrandAddress | undefined;
  readonly socialLinks?: readonly EmailBrandSocialLink[] | undefined;
}

export interface EmailBrand {
  /** The brand's slug; a `<specifier>/<slug>` brand import must name it. */
  readonly slug: string;
  /** Brand theme CSS in the closed grammar `parseBrandCss` accepts. */
  readonly css: string;
  readonly assets?: EmailBrandAssets | undefined;
  readonly footer?: EmailBrandFooter | undefined;
}

// ── Brand components ─────────────────────────────────────────────────────────
//
// A template imports `BrandLogo` and `BrandFooter` from its brand import. The
// compiler writes a generated module that binds these to the brand the build
// resolved, so both render the snapshot a publication records. Their classes
// are compiled for every project that imports them and name only Tailwind's
// own scale, so a theme that defines nothing still renders them without an
// unmatched-class finding; the footer inherits the body's font.

/** Every class the brand components use, compiled for any project that imports them. */
export const BRAND_COMPONENT_CLASSES = [
  "dark:hidden!",
  "hidden",
  "dark:block!",
  "text-xs",
  "text-gray-500",
  "text-center",
  "font-semibold",
  "underline",
] as const;

export interface BrandLogoProps {
  /** Rendered width in pixels; the height follows the image. */
  readonly width?: number | undefined;
  /** Defaults to the brand footer's company name. */
  readonly alt?: string | undefined;
  readonly align?: "left" | "center" | "right" | undefined;
  readonly className?: string | undefined;
}

export interface BrandFooterProps {
  /** Text of the unsubscribe link. */
  readonly unsubscribeLabel?: string | undefined;
  readonly className?: string | undefined;
}

export interface BrandComponents {
  readonly BrandLogo: (props: BrandLogoProps) => EmailNode | null;
  readonly BrandFooter: (props: BrandFooterProps) => EmailNode | null;
}

const addressLines = (address: EmailBrandAddress): readonly string[] =>
  [
    address.street1,
    address.street2,
    [address.city, address.region, address.postalCode]
      .filter((part) => part.trim() !== "")
      .join(", "),
    address.country,
  ].filter((line): line is string => line !== undefined && line.trim() !== "");

const classes = (...names: readonly (string | undefined)[]): string | undefined => {
  const joined = names.filter((name) => name !== undefined && name !== "").join(" ");
  return joined === "" ? undefined : joined;
};

const row = (children: EmailChild, props: Readonly<Record<string, unknown>> = {}): EmailNode =>
  jsx("tr", { ...props, children: jsx("td", { style: { padding: "0 0 8px 0" }, children }) });

/** Bind `BrandLogo` and `BrandFooter` to one brand, marked as the plugin names. */
export const brandComponents = (
  brand: EmailBrand,
  plugin: BrandPlugin = samvaBrandPlugin,
): BrandComponents => {
  const assets = brand.assets ?? {};
  const footer = brand.footer ?? {};
  const BrandLogo = ({ width = 120, alt, align, className }: BrandLogoProps) => {
    if (assets.logoUrl === undefined) return null;
    const label = alt ?? footer.companyName ?? "";
    const image = (src: string, imageClass: string | undefined, imageAlt: string) =>
      jsx("img", {
        src,
        alt: imageAlt,
        width,
        border: 0,
        ...(align === undefined ? {} : { align }),
        className: classes(imageClass, className),
        style: { display: "block", outline: "none", border: "none", height: "auto" },
      });
    if (assets.logoDarkUrl === undefined) return image(assets.logoUrl, undefined, label);
    // Clients that honor `prefers-color-scheme` swap to the dark logo; every
    // other client, classic Outlook included, keeps the light one.
    return jsx(Fragment, {
      children: [
        image(assets.logoUrl, "dark:hidden!", label),
        jsx("div", {
          className: "hidden dark:block!",
          style: { msoHide: "all", maxHeight: 0, overflow: "hidden" },
          // The same logo again; its alt text would read twice in the text part.
          children: image(assets.logoDarkUrl, undefined, ""),
        }),
      ],
    });
  };

  const BrandFooter = ({ unsubscribeLabel = "Unsubscribe", className }: BrandFooterProps) => {
    const rows: EmailNode[] = [];
    if (footer.companyName !== undefined && footer.companyName.trim() !== "")
      rows.push(row(jsx("span", { className: "font-semibold", children: footer.companyName })));
    if (footer.address !== undefined) {
      const lines = addressLines(footer.address);
      if (lines.length > 0)
        rows.push(
          row(lines.flatMap((line, index) => (index === 0 ? [line] : [jsx("br", {}), line]))),
        );
    }
    const links = footer.socialLinks ?? [];
    if (links.length > 0)
      rows.push(
        row(
          links.flatMap((link, index) => [
            ...(index === 0 ? [] : [" · "]),
            jsx("a", {
              href: link.url,
              className: "text-gray-500 underline",
              children: link.label,
            }),
          ]),
        ),
      );
    rows.push(
      row(unsubscribeLink(unsubscribeLabel, plugin), {
        [plugin.unsubscribeRowAttribute]: "",
        [BRAND_FOOTER_MARKER]: true,
      }),
    );
    return jsx("table", {
      role: "presentation",
      width: "100%",
      border: 0,
      cellpadding: 0,
      cellspacing: 0,
      [plugin.footerAttribute]: "",
      [BRAND_FOOTER_MARKER]: true,
      children: jsx("tbody", {
        children: jsx("tr", {
          children: jsx("td", {
            align: "center",
            className: classes("text-xs text-gray-500 text-center", className),
            style: { padding: "32px 16px" },
            children: jsx("table", {
              role: "presentation",
              border: 0,
              cellpadding: 0,
              cellspacing: 0,
              children: jsx("tbody", { children: rows }),
            }),
          }),
        }),
      }),
    });
  };

  return { BrandLogo, BrandFooter };
};

/**
 * The unsubscribe link. Its href is the placeholder, which no author-written
 * link may carry: the serializer accepts it only on this node, and writes the
 * plugin's no-track marker on it so click tracking never rewrites it.
 */
const unsubscribeLink = (label: string, plugin: BrandPlugin): EmailNode =>
  jsx("a", {
    href: plugin.unsubscribeUrlPlaceholder,
    className: "text-gray-500 underline",
    [UNSUBSCRIBE_LINK]: true,
    children: label,
  });

/** What a rendered message says about the footer it carries. */
export interface RenderedFooterMarkers {
  /** The message renders `BrandFooter` (or claims to, with the marker). */
  readonly footer: boolean;
  /** The message carries the unsubscribe placeholder link only `BrandFooter` can write. */
  readonly unsubscribeLink: boolean;
}

/** Read the plugin's footer markers from rendered HTML. */
export const renderedFooterMarkers = (
  html: string,
  plugin: BrandPlugin = samvaBrandPlugin,
): RenderedFooterMarkers => ({
  footer: html.includes(`${plugin.footerAttribute}=""`),
  // The serializer escapes the placeholder as it does any attribute value.
  unsubscribeLink: html.includes(`href="${escapeAttribute(plugin.unsubscribeUrlPlaceholder)}"`),
});

/**
 * Drop the unsubscribe row from a rendered message, for a send that resolved
 * no unsubscribe group: there is no link to put there, so the row goes.
 */
export const withoutUnsubscribeRow = (
  rendered: {
    readonly html?: string | undefined;
    readonly text?: string | undefined;
  },
  plugin: BrandPlugin = samvaBrandPlugin,
): { readonly html: string | undefined; readonly text: string | undefined } => ({
  html: rendered.html?.replace(
    new RegExp(`<tr ${plugin.unsubscribeRowAttribute}=""[^>]*>[\\s\\S]*?</tr>`, "g"),
    "",
  ),
  text: rendered.text
    ?.split("\n")
    .filter((line) => !line.includes(plugin.unsubscribeUrlPlaceholder))
    .join("\n"),
});
