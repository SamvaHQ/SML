import type { EmailStyle } from "./elements";
import { escapeAttribute, escapeText } from "./html";
import {
  EmailNode,
  Fragment,
  jsx,
  normalizeChildren,
  rawMarkup,
  withEmailDiagnostics,
  type EmailFinding,
  type EmailChild,
} from "./jsx-runtime";
import { PRIMITIVE_CLASSES } from "./primitive-css";

// Email primitives are the constructs ordinary HTML cannot express portably:
// a document shell every client accepts, table layout, and the classic-Outlook
// fallbacks. They are plain synchronous functions over the same JSX factory an
// author uses, so every wrapper they generate carries the authoring call site
// as its origin and a preview can select the element that asked for it.

/** Marks the hidden preview block so the renderer can read it back and the text lane can keep it. */
export const PREHEADER_ATTRIBUTE = "data-samva-preheader";
const PREHEADER_PADDING_ATTRIBUTE = "data-samva-preheader-padding";
const PREHEADER_TARGET_LENGTH = 200;
const PREHEADER_PADDING = "\u00a0\u200c\u200b\u200d\u200e\u200f\ufeff";

const presentation = (
  table: Readonly<Record<string, unknown>>,
  row: EmailChild,
  rowProps: Readonly<Record<string, unknown>> = {},
): EmailNode =>
  jsx("table", {
    role: "presentation",
    border: 0,
    cellpadding: 0,
    cellspacing: 0,
    ...table,
    children: jsx("tbody", { children: jsx("tr", { ...rowProps, children: row }) }),
  });

/** A primitive's own class, then the author's. */
const classNames = (own: string, authored: string | undefined): string =>
  authored === undefined || authored.trim() === "" ? own : `${own} ${authored}`;

const optionalNumber = (
  found: EmailFinding[],
  component: string,
  name: string,
  value: unknown,
  bounds: { readonly min?: number } = {},
): number | undefined => {
  if (value === undefined) return undefined;
  if (
    typeof value === "number" &&
    Number.isFinite(value) &&
    (bounds.min === undefined || value >= bounds.min)
  )
    return value;
  found.push({
    code: "invalid-number-prop",
    severity: "error",
    message: `<${component} ${name}> must be a finite number${bounds.min === undefined ? "" : ` of at least ${bounds.min}`}.`,
  });
  return undefined;
};

// ── Document shell ──────────────────────────────────────────────────────────

export interface EmailProps {
  /** CSS classes applied to the primitive's content element. */
  readonly className?: string | undefined;
  readonly lang?: string | undefined;
  readonly dir?: "ltr" | "rtl" | undefined;
  /** Document title; several clients use it as the fallback preview line. */
  readonly title?: string | undefined;
  /**
   * The page color, painted across the whole body and, as `bgcolor`, on the wrapper table for
   * clients that drop body styles. Defaults to the theme's `--color-background`, which switches
   * in dark mode.
   */
  readonly backgroundColor?: string | undefined;
  /**
   * Pixels of space each side of the content, so it never touches the screen edge on a narrow
   * viewport. Defaults to 16; `0` lets content run edge to edge.
   */
  readonly gutter?: number | undefined;
  /** Applied to the content cell, where Yahoo and AOL keep body styling. */
  readonly style?: EmailStyle | undefined;
  readonly children?: EmailChild;
}

/** The hidden inbox preview block. Padding characters stop the client borrowing body copy. */
export const preheaderNode = (text: string): EmailNode =>
  jsx("div", {
    [PREHEADER_ATTRIBUTE]: text,
    style: {
      display: "none",
      overflow: "hidden",
      lineHeight: "1px",
      opacity: 0,
      maxHeight: 0,
      maxWidth: 0,
    },
    children: [
      text,
      text.length >= PREHEADER_TARGET_LENGTH
        ? null
        : jsx("div", {
            [PREHEADER_PADDING_ATTRIBUTE]: true,
            children: PREHEADER_PADDING.repeat(
              Math.ceil((PREHEADER_TARGET_LENGTH - text.length) / PREHEADER_PADDING.length),
            ),
          }),
    ],
  });

/**
 * Document shell: the head every target client needs, a body painted with the page color, and
 * the content cell. The content cell sets the theme's text color and body font
 * (`--color-foreground`, `--font-sans`) for everything inside it, and pads the content off the
 * screen edge (`gutter`).
 */
export const Email = ({
  className,
  lang = "en",
  dir = "ltr",
  title,
  backgroundColor = "var(--color-background)",
  gutter,
  style,
  children,
}: EmailProps): EmailNode => {
  const found: EmailFinding[] = [];
  const safeGutter = optionalNumber(found, "Email", "gutter", gutter, { min: 0 });
  const padding =
    safeGutter === undefined
      ? {}
      : { paddingLeft: `${safeGutter}px`, paddingRight: `${safeGutter}px` };
  const cellStyle = { ...padding, ...style };
  const document = jsx("html", {
    lang,
    dir,
    xmlns: "http://www.w3.org/1999/xhtml",
    "xmlns:o": "urn:schemas-microsoft-com:office:office",
    children: [
      jsx("head", {
        children: [
          jsx("meta", { charset: "utf-8" }),
          jsx("meta", { "http-equiv": "Content-Type", content: "text/html; charset=UTF-8" }),
          jsx("meta", { name: "viewport", content: "width=device-width, initial-scale=1" }),
          jsx("meta", { name: "x-apple-disable-message-reformatting" }),
          jsx("meta", { name: "color-scheme", content: "light dark" }),
          jsx("meta", { name: "supported-color-schemes", content: "light dark" }),
          title === undefined ? null : jsx("title", { children: title }),
          // Classic Outlook scales a 96 DPI document to 120 DPI without this.
          rawMarkup(
            "<!--[if mso]><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->",
          ),
        ],
      }),
      jsx("body", {
        style: { margin: 0, padding: 0, width: "100%", backgroundColor },
        children: [
          presentation(
            {
              align: "center",
              width: "100%",
              bgcolor: backgroundColor,
              style: { width: "100%", backgroundColor },
            },
            jsx("td", {
              className: classNames(PRIMITIVE_CLASSES.email, className),
              ...(Object.keys(cellStyle).length === 0 ? {} : { style: cellStyle }),
              children,
            }),
          ),
        ],
      }),
    ],
  });
  return withEmailDiagnostics(document, found);
};

// ── Layout ──────────────────────────────────────────────────────────────────

export interface SectionProps {
  /** CSS classes applied to the primitive's content element. */
  readonly className?: string | undefined;
  readonly align?: "left" | "center" | "right" | undefined;
  /**
   * The band's width. A pixel width (`600`) is a maximum: the band fills a narrower screen, and
   * classic Outlook, which ignores `max-width`, draws it at that width.
   */
  readonly width?: number | string | undefined;
  readonly bgcolor?: string | undefined;
  /** Applied to the content cell so padding survives Outlook and Klaviyo. */
  readonly style?: EmailStyle | undefined;
  readonly tableStyle?: EmailStyle | undefined;
  readonly children?: EmailChild;
}

/** A pixel width as `width: 100%` capped at it, so a fixed-width table still fits a phone. */
const fluidWidth = (width: number | string): EmailStyle | undefined => {
  const pixels =
    typeof width === "number" ? width : /^\d+(?:\.\d+)?(?:px)?$/.test(width) ? width : undefined;
  if (pixels === undefined) return undefined;
  return {
    width: "100%",
    maxWidth: typeof pixels === "number" ? `${pixels}px` : `${Number.parseFloat(pixels)}px`,
  };
};

/** A full-width band of content, as the single-cell table every client agrees on. */
export const Section = ({
  className,
  align = "center",
  width = "100%",
  bgcolor,
  style,
  tableStyle,
  children,
}: SectionProps): EmailNode => {
  const fluid = fluidWidth(width);
  const table = fluid === undefined ? tableStyle : { ...fluid, ...tableStyle };
  return presentation(
    {
      align,
      width,
      ...(bgcolor === undefined ? {} : { bgcolor }),
      ...(table === undefined ? {} : { style: table }),
    },
    jsx("td", { className, ...(style === undefined ? {} : { style }), children }),
  );
};

export interface ColumnsProps<Item = never> {
  /** CSS classes applied to the primitive's content element. */
  readonly className?: string | undefined;
  readonly align?: "left" | "center" | "right" | undefined;
  readonly width?: number | string | undefined;
  readonly style?: EmailStyle | undefined;
  /**
   * Repeat the cells for each item: `children` is then a function from an item (and its index in
   * the row) to a `Column`. Without `per` all items share one row.
   */
  readonly each?: readonly Item[] | undefined;
  /** With `each`, the cells in a row; each chunk of items is its own `Columns` table. */
  readonly per?: number | undefined;
  /**
   * Stack the cells into one column, each full width, on a viewport narrower than 600px. On by
   * default; `stack={false}` keeps a row of small cells (icons, a price beside a label) side by
   * side. Clients that ignore media queries keep the row.
   */
  readonly stack?: boolean | undefined;
  /**
   * Pixels between the cells of a row. A stacked row puts the same space between the stacked
   * cells instead, so a gap needs no padding on the cells that would misalign them when stacked.
   * The cells must be written out and always render.
   */
  readonly gap?: number | undefined;
  /** `Column` elements, or with `each` a function that returns one. */
  readonly children?: EmailChild | ((item: Item, index: number) => EmailChild);
}

/** The equal share of a row that each of `count` cells takes, whole percent rounded down. */
export const equalColumnWidth = (count: number): string => `${Math.floor(100 / count)}%`;

/**
 * Give a `Column` that states no width its equal share, keeping the primitive's attribute order,
 * and the stacking class when its row stacks.
 */
const withColumnLayout = (
  node: EmailNode,
  width: string | undefined,
  stack: boolean,
): EmailNode => {
  if (node.type === "Fragment")
    return EmailNode.Fragment({
      children: node.children.map((child) => withColumnLayout(child, width, stack)),
    });
  if (node.type !== "Element" || node.tag !== "td") return node;
  const props: Record<string, unknown> = {};
  const sized = width === undefined || node.props.width !== undefined;
  for (const [key, value] of Object.entries(node.props)) {
    if (key === "style" && !sized) props.width = width;
    props[key] = value;
  }
  if (!sized && props.width === undefined) props.width = width;
  if (stack)
    props.className = classNames(
      PRIMITIVE_CLASSES.stack,
      typeof props.className === "string" ? props.className : undefined,
    );
  return EmailNode.Element({ ...node, props });
};

/** The cell between two `Column`s: `gap` wide in a row, `gap` tall once the row stacks. */
const gapCell = (gap: number, stack: boolean): EmailNode =>
  jsx("td", {
    ...(stack ? { className: PRIMITIVE_CLASSES.stack } : {}),
    width: gap,
    style: {
      width: `${gap}px`,
      ...(stack ? { height: `${gap}px` } : {}),
      fontSize: "1px",
      lineHeight: "1px",
    },
    children: "\u200b",
  });

/** Cells with a gap cell between each two that render something. */
const withGaps = (cells: readonly EmailNode[], gap: number | undefined, stack: boolean) => {
  if (gap === undefined || gap === 0) return cells;
  const output: EmailNode[] = [];
  for (const cell of cells) {
    if (cell.type === "Text" && cell.value.trim() === "") {
      output.push(cell);
      continue;
    }
    if (output.some((placed) => placed.type !== "Text" || placed.value.trim() !== ""))
      output.push(gapCell(gap, stack));
    output.push(cell);
  }
  return output;
};

/**
 * A row of side-by-side `Column`s that stacks on a narrow viewport (`stack`). No flex or grid
 * conversion happens here. With `each` it repeats its cells over a list, `per` to a row, and
 * splits the row equally between cells that state no width.
 */
export const Columns = <Item = never>({
  className,
  align = "center",
  width = "100%",
  style,
  each,
  per,
  stack = true,
  gap,
  children,
}: ColumnsProps<Item>): EmailNode => {
  const table = { className, align, width, ...(style === undefined ? {} : { style }) };
  const found: EmailFinding[] = [];
  const safeGap = optionalNumber(found, "Columns", "gap", gap, { min: 0 });
  if (each === undefined || typeof children !== "function")
    return withEmailDiagnostics(
      presentation(
        table,
        withGaps(
          normalizeChildren(children as EmailChild).map((cell) =>
            withColumnLayout(cell, undefined, stack),
          ),
          safeGap,
          stack,
        ),
        { style: { width: "100%" } },
      ),
      found,
    );
  if (per !== undefined && (!Number.isInteger(per) || per < 1))
    found.push({
      code: "invalid-columns-per",
      severity: "error",
      message: "<Columns per> must be a positive integer.",
    });
  const size = per !== undefined && Number.isInteger(per) && per >= 1 ? per : undefined;
  const chunks: (readonly Item[])[] = [];
  if (size === undefined) chunks.push(each);
  else for (let at = 0; at < each.length; at += size) chunks.push(each.slice(at, at + size));
  const share = equalColumnWidth(size ?? Math.max(each.length, 1));
  const rows = jsx(Fragment, {
    children: chunks.map((chunk) =>
      presentation(
        table,
        withGaps(
          chunk.flatMap((item, index) =>
            normalizeChildren(children(item, index)).map((cell) =>
              withColumnLayout(cell, share, stack),
            ),
          ),
          safeGap,
          stack,
        ),
        { style: { width: "100%" } },
      ),
    ),
  });
  return withEmailDiagnostics(rows, found);
};

export interface ColumnProps {
  /** CSS classes applied to the primitive's content element. */
  readonly className?: string | undefined;
  readonly align?: "left" | "center" | "right" | undefined;
  readonly valign?: "top" | "middle" | "bottom" | undefined;
  readonly width?: number | string | undefined;
  readonly style?: EmailStyle | undefined;
  readonly children?: EmailChild;
}

/** One cell of a `Columns` row. */
export const Column = ({
  className,
  align,
  valign,
  width,
  style,
  children,
}: ColumnProps): EmailNode =>
  jsx("td", {
    className,
    ...(align === undefined ? {} : { align }),
    ...(valign === undefined ? {} : { valign }),
    ...(width === undefined ? {} : { width }),
    ...(style === undefined ? {} : { style }),
    children,
  });

// ── Call to action ──────────────────────────────────────────────────────────

export interface ButtonProps {
  /** CSS classes applied to the primitive's content element. */
  readonly className?: string | undefined;
  readonly href: string;
  /**
   * Pixel width of the box. Classic Outlook draws the VML shape at a fixed width, so without
   * this it is estimated from the label and `paddingX`, and the anchor sizes to its label.
   */
  readonly width?: number | undefined;
  /** Pixel height; classic Outlook's VML fallback needs it. */
  readonly height?: number | undefined;
  /** Horizontal padding on each side of the label when no `width` fixes the box. */
  readonly paddingX?: number | undefined;
  readonly backgroundColor?: string | undefined;
  readonly color?: string | undefined;
  readonly borderRadius?: number | undefined;
  readonly borderColor?: string | undefined;
  readonly borderWidth?: number | undefined;
  readonly fontSize?: number | undefined;
  readonly fontFamily?: string | undefined;
  readonly align?: "left" | "center" | "right" | undefined;
  readonly style?: EmailStyle | undefined;
  /** The label. A string label is required for the classic Outlook fallback. */
  readonly children?: EmailChild;
}

/** Average advance of a bold sans-serif glyph, as a fraction of the font size. */
const BOLD_GLYPH_ADVANCE = 0.6;

const invalidButtonNumber = (found: EmailFinding[], name: string): void => {
  found.push({
    code: "invalid-button-number",
    severity: "error",
    message: `<Button ${name}> must be a finite number.`,
  });
};

const buttonNumber = (
  found: EmailFinding[],
  name: string,
  value: unknown,
  fallback: number,
): number => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  invalidButtonNumber(found, name);
  return fallback;
};

const optionalButtonNumber = (
  found: EmailFinding[],
  name: string,
  value: unknown,
): number | undefined => {
  if (value === undefined) return undefined;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  invalidButtonNumber(found, name);
  return undefined;
};

const optionalPositiveButtonNumber = (
  found: EmailFinding[],
  name: string,
  value: unknown,
): number | undefined => {
  if (value === undefined) return undefined;
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  found.push({
    code: "invalid-button-number",
    severity: "error",
    message: `<Button ${name}> must be a positive finite number.`,
  });
  return undefined;
};

/**
 * A link styled as a button, with a VML fallback so classic Outlook draws the shape. Its fill,
 * label color, font and corners default to the theme (`bg-primary`, `text-primary-foreground`,
 * `font-sans`, `rounded`), so a class on the button restyles it. Classic Outlook draws the VML
 * shape from the props alone: set `backgroundColor`, `color` and `borderRadius` when the button
 * does not use the theme's primary fill.
 */
export const Button = ({
  className,
  href,
  width,
  height,
  paddingX = 16,
  backgroundColor,
  color,
  borderRadius,
  borderColor,
  borderWidth = 0,
  fontSize = 16,
  fontFamily,
  align = "left",
  style,
  children,
}: ButtonProps): EmailNode => {
  const found: EmailFinding[] = [];
  const safeWidth = optionalButtonNumber(found, "width", width);
  const safeHeight = optionalPositiveButtonNumber(found, "height", height);
  const safePaddingX = buttonNumber(found, "paddingX", paddingX, 16);
  const safeBorderRadius = optionalButtonNumber(found, "borderRadius", borderRadius);
  const safeBorderWidth = buttonNumber(found, "borderWidth", borderWidth, 0);
  const safeFontSize = buttonNumber(found, "fontSize", fontSize, 16);
  const label = typeof children === "string" ? children : undefined;
  const fallback = safeHeight !== undefined && label !== undefined;
  if (!fallback)
    found.push({
      code: "button-outlook-fallback",
      severity: "warning",
      message:
        "<Button> draws its classic Outlook shape from VML, which needs a height and a plain string label. Without both, classic Windows Outlook shows an unstyled link.",
      clients: ["outlook-windows"],
    });
  const arcsize =
    safeHeight === undefined ? 0 : Math.round(((safeBorderRadius ?? 0) / safeHeight) * 100);
  // VML cannot size to its content, so a label-driven box keeps Outlook in step with the anchor.
  const fallbackWidth =
    safeWidth ??
    Math.ceil((label?.length ?? 0) * safeFontSize * BOLD_GLYPH_ADVANCE) + 2 * safePaddingX;
  const fill = backgroundColor ?? "var(--color-primary)";
  const ink = color ?? "var(--color-primary-foreground)";
  const family = fontFamily ?? "var(--font-sans)";
  const button = presentation(
    { width: "100%", style: { borderCollapse: "collapse" } },
    jsx("td", {
      align,
      children: [
        fallback
          ? rawMarkup(
              `<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${escapeAttribute(href)}" style="height:${safeHeight}px;v-text-anchor:middle;width:${fallbackWidth}px;" arcsize="${arcsize}%" ${
                borderColor === undefined
                  ? 'stroke="false"'
                  : `strokecolor="${escapeAttribute(borderColor)}" strokeweight="${safeBorderWidth}px"`
              } fillcolor="${escapeAttribute(fill)}"><w:anchorlock/><center style="color:${escapeAttribute(ink)};font-family:${escapeAttribute(family)};font-size:${safeFontSize}px;font-weight:bold;">${escapeText(label)}</center></v:roundrect><![endif]-->`,
            )
          : null,
        jsx("a", {
          className: classNames(PRIMITIVE_CLASSES.button, className),
          href,
          target: "_blank",
          rel: "noopener noreferrer",
          style: {
            ...(backgroundColor === undefined ? {} : { backgroundColor }),
            ...(color === undefined ? {} : { color }),
            ...(safeBorderRadius === undefined ? {} : { borderRadius: `${safeBorderRadius}px` }),
            display: "inline-block",
            ...(fontFamily === undefined ? {} : { fontFamily }),
            fontSize: `${safeFontSize}px`,
            fontWeight: "bold",
            lineHeight: safeHeight === undefined ? "120%" : `${safeHeight - 2 * safeBorderWidth}px`,
            textAlign: "center",
            textDecoration: "none",
            ...(safeWidth === undefined
              ? { padding: `0 ${safePaddingX}px` }
              : { width: `${safeWidth}px`, maxWidth: "100%" }),
            ...(borderColor === undefined
              ? {}
              : { border: `${safeBorderWidth}px solid ${borderColor}` }),
            // Classic Outlook shows the VML shape instead of this anchor.
            ...(fallback ? { msoHide: "all" } : {}),
            ...style,
          },
          children,
        }),
      ],
    }),
  );
  return withEmailDiagnostics(button, found);
};

// ── Rhythm ──────────────────────────────────────────────────────────────────

export interface SpacerProps {
  readonly height: number;
}

/** Vertical space that survives clients which collapse margins. */
export const Spacer = ({ height }: SpacerProps): EmailNode =>
  presentation(
    { width: "100%" },
    jsx("td", {
      height,
      style: { height: `${height}px`, lineHeight: `${height}px`, fontSize: "1px" },
      children: "\u200b",
    }),
  );

export interface DividerProps {
  /** CSS classes applied to the primitive's content element. */
  readonly className?: string | undefined;
  readonly color?: string | undefined;
  readonly thickness?: number | undefined;
  readonly style?: EmailStyle | undefined;
}

/**
 * A horizontal rule drawn as a cell border, which every target client renders. It defaults to a
 * 1px line in the theme's `--color-border`.
 */
export const Divider = ({ className, color, thickness, style }: DividerProps): EmailNode =>
  presentation(
    { width: "100%" },
    jsx("td", {
      className: classNames(PRIMITIVE_CLASSES.divider, className),
      style: {
        ...(color === undefined && thickness === undefined
          ? {}
          : { borderTop: `${thickness ?? 1}px solid ${color ?? "var(--color-border)"}` }),
        fontSize: "1px",
        lineHeight: "1px",
        ...style,
      },
      children: "\u200b",
    }),
  );

// ── Content ─────────────────────────────────────────────────────────────────

export interface ImageProps {
  /** CSS classes applied to the primitive's content element. */
  readonly className?: string | undefined;
  readonly src: string;
  /** Required. Use an empty string only for images that carry no meaning. */
  readonly alt: string;
  readonly width?: number | string | undefined;
  readonly height?: number | string | undefined;
  readonly align?: "left" | "center" | "right" | undefined;
  readonly style?: EmailStyle | undefined;
}

/** An image with the width/height attributes Outlook sizes from before CSS applies. */
export const Image = ({
  className,
  src,
  alt,
  width,
  height,
  align,
  style,
}: ImageProps): EmailNode =>
  jsx("img", {
    className,
    src,
    alt,
    border: 0,
    ...(width === undefined ? {} : { width }),
    ...(height === undefined ? {} : { height }),
    ...(align === undefined ? {} : { align }),
    style: {
      display: "block",
      outline: "none",
      border: "none",
      textDecoration: "none",
      maxWidth: "100%",
      ...style,
    },
  });

export interface LinkProps {
  /** CSS classes applied to the primitive's content element. */
  readonly className?: string | undefined;
  readonly href: string;
  readonly target?: string | undefined;
  readonly rel?: string | undefined;
  readonly style?: EmailStyle | undefined;
  readonly children?: EmailChild;
}

/**
 * A text link that opens outside the client and cannot reach back at the opener. It defaults to
 * the theme's `--color-primary`, underlined.
 */
export const Link = ({
  className,
  href,
  target = "_blank",
  rel = "noopener noreferrer",
  style,
  children,
}: LinkProps): EmailNode =>
  jsx("a", {
    className: classNames(PRIMITIVE_CLASSES.link, className),
    href,
    target,
    rel,
    ...(style === undefined ? {} : { style }),
    children,
  });
