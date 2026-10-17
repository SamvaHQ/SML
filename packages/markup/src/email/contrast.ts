import { parseHtml } from "caniemail";
import { generate, parse, walk } from "css-tree";

import type { EmittedPosition } from "../preview";
import type { JsxSourceLocation } from "../source-locations";
import type { CompatibilityInput } from "./compatibility";
import { parseStylesheet, type CssRule } from "./css";
import { parseColor } from "./css-color";
import type { EmailDiagnostic } from "./diagnostics";
import { matchesSelector, type Ancestry, type EmailElementNode } from "./selectors";

// Contrast is judged on the document the recipient receives, once for the light
// presentation and once for the dark one. Light values are the inline styles and
// `bgcolor` attributes; dark values are the rules nested in
// `@media (prefers-color-scheme: dark)`, which carry `!important` and so replace
// the inline value. A color the checker cannot evaluate (`var()`, `currentColor`,
// a gradient or image) is never guessed: the element and what it paints under
// its descendants are skipped.
//
// Assumed client canvas, for text or controls no ancestor paints behind: white in
// light mode and #121212 in dark mode. The email declares `color-scheme: light
// dark`, so a client that honors dark mode paints a dark canvas under it.
//
// A filled control (an `<a>` with its own background, which is how `<Button>`
// renders) is judged against its surroundings. Below 1.5:1 it is
// indistinguishable from the surface it sits on; WCAG 1.4.11 asks 3:1 for UI
// components, so 1.5 to 3 warns. A border that reaches 3:1 keeps the shape.

type Mode = "light" | "dark";

interface Color {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

/** Evaluated, unevaluable, or not declared. */
type Declared = Color | "unknown" | undefined;
/** An opaque color, or one the checker will not judge. */
type Paint = Color | "unknown";

const CANVAS: Readonly<Record<Mode, Color>> = {
  light: { r: 1, g: 1, b: 1, a: 1 },
  dark: { r: 18 / 255, g: 18 / 255, b: 18 / 255, a: 1 },
};

/** The ratios `email-contrast` holds a message to, and what counts as large text. */
export const CONTRAST_THRESHOLDS = {
  /** Text below this is an error at any size. */
  textError: 3,
  /** Normal-size text below this is a warning (WCAG AA). */
  textWarning: 4.5,
  /** Text at least this many pixels is large, as is bold text at `largeBoldPx`. */
  largePx: 24,
  largeBoldPx: 18.5,
  /** A filled button below this against its surroundings is an error. */
  shapeError: 1.5,
  /** A filled button below this is a warning (WCAG 1.4.11). */
  shapeWarning: 3,
  /** A button border at least this against the surroundings keeps the shape. */
  border: 3,
} as const;

const TEXT_ERROR = CONTRAST_THRESHOLDS.textError;
const TEXT_WARNING = CONTRAST_THRESHOLDS.textWarning;
const LARGE_PX = CONTRAST_THRESHOLDS.largePx;
const LARGE_BOLD_PX = CONTRAST_THRESHOLDS.largeBoldPx;
const SHAPE_ERROR = CONTRAST_THRESHOLDS.shapeError;
const SHAPE_WARNING = CONTRAST_THRESHOLDS.shapeWarning;
const INSET_BORDER = CONTRAST_THRESHOLDS.border;

const SKIPPED_TAGS: ReadonlySet<string> = new Set(["head", "style", "title", "script"]);
const INVISIBLE = /[\s\u200b-\u200f\ufeff\u00a0\u00ad]|\u034f/g;
const DARK_QUERY = /^@media\b[^{]*\(\s*prefers-color-scheme\s*:\s*dark\s*\)/i;

interface Declaration {
  readonly property: string;
  readonly value: string;
}

type DomNode = ReturnType<typeof parseHtml>["document"]["children"][number];
type DomElement = Extract<DomNode, { attribs: unknown }>;

const clamp = (value: number): number => (value < 0 ? 0 : value > 1 ? 1 : value);

const channel = (value: number): number => {
  const v = clamp(value);
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

const luminance = (color: Color): number =>
  0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);

const ratioOf = (left: Color, right: Color): number => {
  const a = luminance(left);
  const b = luminance(right);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};

const hex = (color: Color): string =>
  `#${[color.r, color.g, color.b]
    .map((value) =>
      Math.round(clamp(value) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;

const over = (top: Color, below: Color): Color => ({
  r: top.r * top.a + below.r * (1 - top.a),
  g: top.g * top.a + below.g * (1 - top.a),
  b: top.b * top.a + below.b * (1 - top.a),
  a: 1,
});

const declarationsOf = (source: string): Declaration[] => {
  const found: Declaration[] = [];
  // oxlint-disable-next-line samva/no-try-catch-or-throw -- css-tree throws on malformed CSS; an unreadable style attribute contributes nothing.
  try {
    walk(parse(source, { context: "declarationList", positions: false }), (node) => {
      if (node.type === "Declaration")
        found.push({ property: node.property.toLowerCase(), value: generate(node.value).trim() });
    });
  } catch {
    return [];
  }
  return found;
};

/** Split on whitespace that is not inside parentheses. */
const tokens = (value: string): string[] => {
  const found: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of value) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (/\s/.test(char) && depth === 0) {
      if (current !== "") found.push(current);
      current = "";
    } else current += char;
  }
  if (current !== "") found.push(current);
  return found;
};

const declaredColor = (value: string): Declared => {
  const color = parseColor(value);
  return color === undefined ? "unknown" : color;
};

const pixels = (value: string): number | undefined => {
  const match = /^(\d+(?:\.\d+)?|\.\d+)px$/i.exec(value.trim());
  return match === null ? undefined : Number(match[1]);
};

interface Border {
  width: number | undefined;
  color: Declared;
}

interface Resolved {
  /** The element's own background color; `image` marks a url or gradient. */
  readonly background: Declared;
  readonly image: boolean;
  readonly color: Declared;
  readonly display: string | undefined;
  readonly fontSize: number | undefined;
  readonly bold: boolean | undefined;
  readonly border: Border;
}

const WIDTH_KEYWORDS: Readonly<Record<string, number>> = { thin: 1, medium: 3, thick: 5 };

const resolve = (declarations: readonly Declaration[]): Resolved => {
  let background: Declared;
  let image = false;
  let color: Declared;
  let display: string | undefined;
  let fontSize: number | undefined;
  let bold: boolean | undefined;
  const border: Border = { width: undefined, color: undefined };
  for (const { property, value } of declarations) {
    const lower = value.toLowerCase();
    switch (property) {
      case "background": {
        image = /url\(|gradient\(/.test(lower);
        const parts = tokens(value).filter((part) => !/^(?:url|[\w-]*gradient)\(/i.test(part));
        const parsed = parts.map(parseColor).find((entry) => entry !== undefined);
        background =
          parsed ??
          (/var\(|currentcolor|inherit|initial|unset/.test(lower) ? "unknown" : undefined);
        break;
      }
      case "background-color":
        background = declaredColor(value);
        break;
      case "background-image":
        image = lower !== "none";
        break;
      case "color":
        color = declaredColor(value);
        break;
      case "display":
        display = lower.replace(/\s*!important$/, "");
        break;
      case "font-size":
        fontSize = pixels(value);
        break;
      case "font-weight": {
        const weight = Number(lower);
        if (lower === "bold" || lower === "bolder") bold = true;
        else if (lower === "normal" || lower === "lighter") bold = false;
        else if (!Number.isNaN(weight)) bold = weight >= 700;
        break;
      }
      case "border":
      case "border-width":
      case "border-color":
      case "border-style": {
        const parts = tokens(value);
        if (property === "border" || property === "border-style") {
          if (parts.some((part) => /^(?:none|hidden)$/i.test(part))) border.width = 0;
          else if (property === "border" && border.width === undefined) border.width = 3;
        }
        if (property === "border" || property === "border-width") {
          const size = parts
            .map((part) => pixels(part) ?? WIDTH_KEYWORDS[part.toLowerCase()])
            .find((entry) => entry !== undefined);
          if (size !== undefined) border.width = size;
          else if (property === "border-width") border.width = undefined;
        }
        if (property === "border" || property === "border-color") {
          const named = parts.filter(
            (part) =>
              pixels(part) === undefined &&
              !/^(?:solid|dashed|dotted|double|groove|ridge|inset|outset|none|hidden|thin|medium|thick)$/i.test(
                part,
              ),
          );
          const parsed = named.map(parseColor).find((entry) => entry !== undefined);
          border.color = parsed ?? (named.length > 0 ? "unknown" : border.color);
        }
        break;
      }
      default:
        break;
    }
  }
  return { background, image, color, display, fontSize, bold, border };
};

/** Properties a declaration list sets, for deciding whether an unimportant dark rule can apply. */
const has = (declarations: readonly Declaration[], property: string): boolean =>
  declarations.some((entry) => entry.property === property);

interface State {
  readonly background: Paint;
  readonly color: Paint | undefined;
  readonly fontSize: number | undefined;
  readonly bold: boolean;
  readonly hidden: boolean;
}

const advance = (
  parent: State,
  style: Resolved,
  tag: string,
): { state: State; ownBackground: Color | undefined } => {
  let background: Paint = parent.background;
  let ownBackground: Color | undefined;
  if (style.image || style.background === "unknown") background = "unknown";
  else if (style.background !== undefined) {
    if (style.background.a >= 1) background = style.background;
    else if (parent.background !== "unknown")
      background = over(style.background, parent.background);
    else background = "unknown";
    if (background !== "unknown") ownBackground = background;
  }
  // Anchors take the client's link color unless they declare one, so the
  // parent's text color says nothing about them.
  let color: Paint | undefined = tag === "a" ? undefined : parent.color;
  if (style.color === "unknown") color = "unknown";
  else if (style.color !== undefined)
    color =
      style.color.a >= 1
        ? style.color
        : background === "unknown"
          ? "unknown"
          : over(style.color, background);
  return {
    ownBackground,
    state: {
      background,
      color,
      fontSize: style.fontSize ?? parent.fontSize,
      bold: style.bold ?? parent.bold,
      hidden: parent.hidden || style.display === "none",
    },
  };
};

const originsAt = (
  positions: readonly EmittedPosition[],
  offset: number | undefined,
): readonly JsxSourceLocation[] => {
  if (offset === undefined) return [];
  let best: EmittedPosition | undefined;
  for (const position of positions) {
    if (offset < position.start || offset >= position.end) continue;
    if (best === undefined || position.end - position.start < best.end - best.start)
      best = position;
  }
  return best?.origins ?? [];
};

const compareRules = (left: CssRule, right: CssRule): number => {
  const important = (rule: CssRule): number => (rule.declarations.some((d) => d.important) ? 1 : 0);
  return (
    important(left) - important(right) ||
    left.specificity[0] - right.specificity[0] ||
    left.specificity[1] - right.specificity[1] ||
    left.specificity[2] - right.specificity[2] ||
    left.order - right.order
  );
};

const textOf = (node: DomElement): string =>
  node.children.map((child) => ("data" in child ? String(child.data) : "")).join("");

interface Finding {
  readonly key: string;
  readonly diagnostic: EmailDiagnostic;
  readonly occurrences: (readonly JsxSourceLocation[])[];
}

const MODE_LABEL: Readonly<Record<Mode, string>> = { light: "Light mode", dark: "Dark mode" };

const FIX =
  "Pair background and text tokens (bg-primary with text-primary-foreground) and give the theme's dark-mode @theme a value for the token, or choose colors that reach";

/**
 * Check text and filled-control contrast in the emitted document, in light and
 * dark presentation.
 */
export const checkEmailContrast = (input: CompatibilityInput): readonly EmailDiagnostic[] => {
  const { document } = parseHtml(input.html);
  const sheets: string[] = input.css === undefined ? [] : [input.css];
  const collect = (nodes: readonly DomNode[]): void => {
    for (const node of nodes) {
      if (!("attribs" in node)) continue;
      if (node.name === "style") sheets.push(textOf(node));
      else collect(node.children);
    }
  };
  collect(document.children);
  const darkRules = sheets
    .flatMap((sheet) => parseStylesheet(sheet).rules)
    .filter((rule) => rule.conditions.length === 1 && DARK_QUERY.test(rule.conditions[0]!))
    .toSorted(compareRules);

  const findings = new Map<string, Finding>();
  const report = (
    mode: Mode,
    kind: "text" | "button",
    foreground: Color,
    background: Color,
    ratio: number,
    required: number,
    severity: "error" | "warning",
    offset: number | undefined,
  ) => {
    const origins = originsAt(input.positions ?? [], offset);
    const measured = ratio.toFixed(2);
    const colors = `${hex(foreground)} on ${hex(background)}`;
    const message =
      kind === "text"
        ? `${MODE_LABEL[mode]}: text ${colors} has a contrast ratio of ${measured}:1; ${required}:1 is required. ${FIX} ${required}:1.`
        : `${MODE_LABEL[mode]}: the button background ${hex(foreground)} against its surroundings ${hex(background)} has a contrast ratio of ${measured}:1; ${SHAPE_WARNING}:1 is required for the shape to stay visible (below ${SHAPE_ERROR}:1 it disappears). ${FIX} ${SHAPE_WARNING}:1, or give the button a border that does.`;
    const key = JSON.stringify([mode, kind, hex(foreground), hex(background), measured, origins]);
    const existing = findings.get(key);
    if (existing !== undefined) {
      if (origins.length > 0) existing.occurrences.push(origins);
      return;
    }
    findings.set(key, {
      key,
      occurrences: origins.length > 0 ? [origins] : [],
      diagnostic: {
        code: "email-contrast",
        severity,
        message,
        origins,
        ...(input.fixture === undefined ? {} : { fixtures: [input.fixture] }),
      },
    });
  };

  const visit = (
    node: DomElement,
    parents: Readonly<Record<Mode, State>>,
    parentAncestry: Ancestry | undefined,
    previous: readonly EmailElementNode[],
  ): EmailElementNode => {
    const inline = declarationsOf(node.attribs.style ?? "");
    const attribute: Declaration[] =
      node.attribs.bgcolor === undefined
        ? []
        : [{ property: "background-color", value: node.attribs.bgcolor }];
    const shape: EmailElementNode = {
      type: "Element",
      tag: node.name,
      props: node.attribs,
      children: [],
      origins: [],
      authored: false,
    };
    const ancestry: Ancestry = { element: shape, parent: parentAncestry, previous };
    const base = [...attribute, ...inline];
    const dark = [...base];
    for (const rule of darkRules) {
      if (!matchesSelector(rule.matcher, ancestry)) continue;
      for (const declaration of rule.declarations) {
        const property = declaration.property.toLowerCase();
        if (declaration.important || !has(inline, property))
          dark.push({ property, value: declaration.value.replace(/\s*!important$/i, "") });
      }
    }
    const styles: Readonly<Record<Mode, Resolved>> = {
      light: resolve(base),
      dark: resolve(dark),
    };
    const direct = node.children.some(
      (child) => child.type === "text" && String(child.data).replace(INVISIBLE, "") !== "",
    );
    const states: Record<Mode, State> = { light: parents.light, dark: parents.dark };
    for (const mode of ["light", "dark"] as const) {
      const parent = parents[mode];
      const style = styles[mode];
      const { state, ownBackground } = advance(parent, style, node.name);
      states[mode] = state;
      if (state.hidden) continue;
      if (
        node.name === "a" &&
        ownBackground !== undefined &&
        parent.background !== "unknown" &&
        !style.image
      ) {
        const ratio = ratioOf(ownBackground, parent.background);
        if (ratio < SHAPE_WARNING) {
          const { width, color } = style.border;
          const bordered = width !== undefined && width > 0 && color !== undefined;
          const keeps =
            bordered &&
            color !== "unknown" &&
            ratioOf(over(color, parent.background), parent.background) >= INSET_BORDER;
          if (!keeps && !(bordered && color === "unknown"))
            report(
              mode,
              "button",
              ownBackground,
              parent.background,
              ratio,
              SHAPE_WARNING,
              ratio < SHAPE_ERROR ? "error" : "warning",
              node.startIndex ?? undefined,
            );
        }
      }
      if (
        direct &&
        state.color !== undefined &&
        state.color !== "unknown" &&
        state.background !== "unknown"
      ) {
        const ratio = ratioOf(state.color, state.background);
        const large =
          state.fontSize !== undefined &&
          (state.fontSize >= LARGE_PX || (state.bold && state.fontSize >= LARGE_BOLD_PX));
        const required = large ? TEXT_ERROR : TEXT_WARNING;
        if (ratio < required)
          report(
            mode,
            "text",
            state.color,
            state.background,
            ratio,
            required,
            ratio < TEXT_ERROR ? "error" : "warning",
            node.startIndex ?? undefined,
          );
      }
    }
    if (!SKIPPED_TAGS.has(node.name) && (!states.light.hidden || !states.dark.hidden)) {
      let siblings: EmailElementNode[] = [];
      for (const child of node.children) {
        if (!("attribs" in child) || SKIPPED_TAGS.has(child.name)) continue;
        const done = visit(child, states, ancestry, siblings);
        siblings = [...siblings, done];
      }
    }
    return shape;
  };

  const root: Readonly<Record<Mode, State>> = {
    light: {
      background: CANVAS.light,
      color: undefined,
      fontSize: undefined,
      bold: false,
      hidden: false,
    },
    dark: {
      background: CANVAS.dark,
      color: undefined,
      fontSize: undefined,
      bold: false,
      hidden: false,
    },
  };
  let siblings: EmailElementNode[] = [];
  for (const node of document.children) {
    if (!("attribs" in node) || SKIPPED_TAGS.has(node.name)) continue;
    siblings = [...siblings, visit(node, root, undefined, siblings)];
  }

  return [...findings.values()].map(({ diagnostic, occurrences }) => ({
    ...diagnostic,
    ...(occurrences.length > 1 ? { occurrences } : {}),
  }));
};
