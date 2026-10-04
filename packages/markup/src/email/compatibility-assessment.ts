import type { compatibilityContext } from "./compatibility-context";
import type { EmailCompatibilityAssessment } from "./diagnostics";

interface Assessment extends EmailCompatibilityAssessment {
  readonly explanation: string;
}

const VERIFIED_VALUES = /^(?:left|right|center|justify)$/i;
const SIMPLE_COLOR = /^(?:#[\da-f]{3,8}|rgba?\([^()]+\)|transparent|white|black)$/i;

/**
 * A feature matrix establishes support, not the effect on a particular message.
 * These rules interpret the pinned caniemail@2.0.2 limitations using emitted
 * values. Unresolved layout, fallback and client-account behavior stays unverified.
 */
export const assessCompatibility = (
  title: string,
  client: string,
  support: string,
  context: ReturnType<typeof compatibilityContext>,
  blocking: boolean,
): Assessment => {
  const result = (
    assessment: Assessment["assessment"],
    heading: string,
    explanation: string,
  ): Assessment => ({ assessment, title: heading, explanation });
  if (
    client === "outlook.windows" &&
    support === "partial" &&
    (title === "display" || title === "display:none") &&
    context.hiddenContentOffsets.length > 0
  )
    return result(
      "risk",
      "Hidden content becomes visible in classic Outlook",
      "Classic Outlook ignores display:none on images and does not inherit it onto nested tables. The emitted inline styles contain hidden content without a resolved hiding fallback. Add a supported hiding fallback before publishing.",
    );
  if (blocking)
    return result(
      "risk",
      `${title} is unavailable in a target client`,
      "This construct is required for message content, structure or navigation. Replace it with a supported construct before publishing.",
    );

  const explained = context.explanation(title, client, support);
  if (explained !== undefined)
    return result(
      title.startsWith("system-ui,") ? "degradation" : "not-applicable",
      title.startsWith("system-ui,")
        ? "A fallback font will be used"
        : `${title}: limitation avoided`,
      explained,
    );

  const declarations = (property: string) => context.declarations(property);
  const every = (property: string, predicate: (value: string) => boolean) => {
    const values = declarations(property);
    return context.complete && values.length > 0 && values.every(({ value }) => predicate(value));
  };
  const attributesAvoid = (attribute: string, unsupportedElement: string) => {
    const values = context.attributes(attribute);
    return values.length > 0 && values.every(({ element }) => element !== unsupportedElement);
  };

  if (
    title === "font-size" &&
    support === "partial" &&
    ["outlook.windows", "yahoo.desktop-webmail"].includes(client) &&
    declarations("font-size").some(({ value }) => /\d(?:\.\d+)?rem\b/i.test(value))
  )
    return result(
      "risk",
      "Text sizes use unsupported rem units",
      "These clients cannot apply the emitted rem font sizes. Use pixel sizes to preserve the intended text size.",
    );
  if (
    title === "target attribute" &&
    context.attributes("target").some(({ value }) => value !== "_blank")
  )
    return result(
      "risk",
      "Links cannot keep the requested window target",
      "These clients open links in a new window regardless of the requested target. Use a new-window target or remove the dependency on another browsing context.",
    );
  if (
    title.startsWith("system-ui,") &&
    declarations("font-family").some(
      ({ value }) => !/(?:^|,)\s*(?:sans-serif|serif|monospace)\s*$/i.test(value),
    )
  )
    return result(
      "risk",
      "An unsupported font stack has no generic fallback",
      "Declare a generic fallback so the client has an explicit font choice when the requested system font is unavailable.",
    );
  if (title === "border-radius" && support !== "partial")
    return result(
      "degradation",
      "Corners may appear square",
      "CSS corner rounding is unavailable in this client. Uncovered elements appear square; a separate VML shape can retain rounding. This finding does not establish a content or navigation failure.",
    );
  if (title === "border-radius" && client === "yahoo.desktop-webmail" && support === "partial")
    return result(
      "degradation",
      "Corner shapes may differ",
      "This client does not support elliptical slash syntax. Review the recorded values if that corner shape is part of the intended design.",
    );
  if (title === "background") {
    const values = [...declarations("background"), ...declarations("background-color")];
    if (
      context.complete &&
      values.length > 0 &&
      values.every(({ value }) => SIMPLE_COLOR.test(value)) &&
      declarations("background-image").every(({ value }) => value.toLowerCase() === "none")
    )
      return result(
        "not-applicable",
        "Backgrounds use supported color values",
        "The emitted backgrounds use simple colors. The cited multiple-background and background-size shorthand limitations do not apply.",
      );
  }
  if (title === "dir attribute" && client === "outlook.windows" && attributesAvoid("dir", "a"))
    return result(
      "not-applicable",
      "Direction is set outside links",
      "The cited direction bug affects anchor elements. No emitted anchor carries a dir attribute.",
    );
  if (
    title === "lang attribute" &&
    client === "yahoo.desktop-webmail" &&
    attributesAvoid("lang", "td")
  )
    return result(
      "not-applicable",
      "Language is set outside table cells",
      "The cited language-attribute limitation affects table cells. No emitted td carries a lang attribute.",
    );
  if (
    title === "role attribute" &&
    client === "yahoo.desktop-webmail" &&
    context.attributes("role").length > 0 &&
    context.attributes("role").every(({ element }) => element === "table")
  )
    return result(
      "not-applicable",
      "Roles are applied to supported tables",
      "Every emitted role attribute is on a table, matching this client's supported element scope.",
    );
  if (
    title === "text-align" &&
    support === "partial" &&
    every("text-align", (value) => VERIFIED_VALUES.test(value))
  )
    return result(
      "not-applicable",
      "Text uses supported alignment values",
      "The emitted alignment values do not use match-parent or flow-relative start/end values.",
    );
  if (title === "font-weight" && support === "partial") {
    const pattern =
      client === "outlook.windows" ? /^(?:normal|bold|400|700)$/i : /^(?:normal|bold|[1-9]00)$/i;
    if (every("font-weight", (value) => pattern.test(value)))
      return result(
        "not-applicable",
        "Font weights avoid the numeric limitation",
        "The emitted weights use values preserved by this client's pinned numeric-weight rule.",
      );
    return result(
      "degradation",
      "Font weight may be approximated",
      "This client may substitute a supported weight. Text remains present, but its emphasis can look different.",
    );
  }
  if (title === "outline" && every("outline", (value) => value === "none" || value === "0"))
    return result(
      "unverified",
      "Image outlines need a client check",
      "The emitted styles remove outlines. The matrix cannot establish whether this client adds its own link or image outline.",
    );
  if (
    title === "width attribute" &&
    client === "outlook.windows" &&
    context
      .attributes(title.split(" ")[0]!)
      .some(({ value, element }) => element === "img" && value.includes("%"))
  )
    return result(
      "risk",
      "Percentage image dimensions use the wrong reference size",
      "Classic Outlook sizes percentage image attributes against the image file rather than its parent. Use fixed image dimensions with an appropriate responsive fallback.",
    );
  if (
    title === "overflow" &&
    declarations("overflow").some(({ value }) => /^(?:auto|scroll)$/i.test(value))
  )
    return result(
      "risk",
      "Scrollable content may be inaccessible",
      "These clients cannot reliably expose content hidden behind a scrolling container. Keep required email content visible without scrolling inside an element.",
    );

  const verificationTitles: Readonly<Record<string, string>> = {
    "<body> element": "Body styling needs a client check",
    border: "Borders need an Outlook check",
    "color-scheme meta tag": "Dark appearance needs a client check",
    display: "Display behavior needs a client check",
    "display:none": "Hidden content needs an Outlook check",
    "height attribute": "Image sizing needs a high-DPI Outlook check",
    "height property": "Element heights need a client check",
    "line-height": "Line spacing needs an Outlook check",
    margin: "Outer spacing needs a client check",
    "max-height property": "Height limits need an Outlook check",
    "max-width": "Width limits need a client check",
    "@media": "Conditional styles need a client check",
    opacity: "Transparent content needs an Outlook check",
    overflow: "Clipped content needs a client check",
    "overflow-wrap": "Long text wrapping needs a client check",
    padding: "Cell spacing needs an Outlook check",
    "<style> element": "Retained styles need a client check",
    "text-decoration": "Link decoration needs a client check",
    "width attribute": "Image sizing needs a high-DPI Outlook check",
    "width property": "Element widths need an Outlook check",
    "word-break": "Word breaking needs a client check",
  };
  return result(
    "unverified",
    verificationTitles[title] ?? `${title} needs a client check`,
    "The feature matrix identifies a support difference but does not establish its effect on this message. Check the affected fixtures in the listed clients before relying on this behavior; no automatic source change is justified by this observation alone.",
  );
};
