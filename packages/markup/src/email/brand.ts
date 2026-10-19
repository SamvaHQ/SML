import { BRAND_FOOTER_MARKER, UNSUBSCRIBE_LINK } from "../internal/unsubscribe-link";
import type { BrandPlugin } from "./brand-plugin";
import { escapeAttribute } from "./html";
import { Fragment, jsx, rawMarkup, type EmailChild, type EmailNode } from "./jsx-runtime";
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
// own scale and the theme vocabulary, which every project's theme defines, so
// they render without an unmatched-class finding; the footer inherits the
// body's font.

/** Every class the brand components use, compiled for any project that imports them. */
export const BRAND_COMPONENT_CLASSES = [
  "dark:hidden!",
  "hidden",
  "dark:block!",
  "text-xs",
  "text-muted-foreground",
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

const line = (children: readonly EmailChild[], last: boolean): EmailNode =>
  jsx("p", { style: { margin: last ? "0" : "0 0 8px 0" }, children });

/** The alignment a footer `className` asks for; the footer centers when it names none. */
const footerAlignment = (className: string | undefined): "left" | "center" | "right" =>
  (/(?:^|\s)text-(left|center|right)(?:\s|$)/.exec(className ?? "")?.[1] as
    | "left"
    | "center"
    | "right"
    | undefined) ?? "center";

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

  // One line of who sent it, where to find them and how to stop, then the postal address:
  // `Acme · X · LinkedIn · Unsubscribe`. The unsubscribe link and its separator sit in their
  // own marked span, so a send without an unsubscribe group drops exactly that. In the text part
  // the separator is a line break: the link has a line of its own, whatever its label says.
  const BrandFooter = ({ unsubscribeLabel = "Unsubscribe", className }: BrandFooterProps) => {
    const items: EmailChild[] = [];
    const separator = () => (items.length === 0 ? [] : [" · "]);
    if (footer.companyName !== undefined && footer.companyName.trim() !== "")
      items.push(jsx("span", { className: "font-semibold", children: footer.companyName }));
    for (const link of footer.socialLinks ?? [])
      items.push(
        ...separator(),
        jsx("a", {
          href: link.url,
          className: "text-muted-foreground underline",
          children: link.label,
        }),
      );
    items.push(
      jsx("span", {
        [plugin.unsubscribeRowAttribute]: "",
        [BRAND_FOOTER_MARKER]: true,
        children: [
          ...(items.length === 0 ? [] : [rawMarkup(" · ", "\n")]),
          unsubscribeLink(unsubscribeLabel, plugin),
        ],
      }),
    );
    const address = footer.address === undefined ? [] : addressLines(footer.address);
    const alignment = footerAlignment(className);
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
            align: alignment,
            className: classes(
              "text-xs text-muted-foreground",
              alignment === "center" ? "text-center" : undefined,
              className,
            ),
            style: { padding: "32px 16px" },
            children: [
              line(items, address.length === 0),
              ...(address.length === 0 ? [] : [line([address.join(", ")], true)]),
            ],
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
    className: "text-muted-foreground underline",
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
  // A `<span>` in the footer's line, or the `<tr>` row of a footer compiled before the line.
  html: rendered.html?.replace(
    new RegExp(`<(span|tr) ${plugin.unsubscribeRowAttribute}=""[^>]*>[\\s\\S]*?</\\1>`, "g"),
    "",
  ),
  text: rendered.text
    ?.split("\n")
    .filter((textLine) => !textLine.includes(plugin.unsubscribeUrlPlaceholder))
    .join("\n"),
});
