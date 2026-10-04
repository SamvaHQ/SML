import { parseHtml } from "caniemail";
import { generate, parse, walk } from "css-tree";

interface Declaration {
  readonly value: string;
  readonly offset: number | undefined;
  readonly element: string | undefined;
}

// These values cannot hide content. Other values remain unresolved, rather than
// claiming that a possible fallback is supported by a particular client.
const NON_HIDING_VALUES: Readonly<Record<string, RegExp>> = {
  "mso-hide": /^none$/,
  visibility: /^visible$/,
  opacity: /^(?:1(?:\.0+)?|100(?:\.0+)?%)$/,
  overflow: /^visible$/,
  "overflow-y": /^visible$/,
  "overflow-x": /^visible$/,
  clip: /^auto$/,
  "clip-path": /^none$/,
};

const POSITIVE_FIXED_HEIGHT = /^(?:\d+(?:\.\d+)?|\.\d+)(?:px|pt|pc|in|cm|mm)$/;

/** Evidence from actual declarations and elements, never a text match in email content. */
export const compatibilityContext = (html: string, css: string | undefined) => {
  const declarations = new Map<string, Declaration[]>();
  const attributes = new Map<string, Declaration[]>();
  const elements = new Map<string, number[]>();
  let complete = true;
  let unresolvedStyles = false;
  const hiddenContentOffsets: number[] = [];
  type InlineStyles = Map<string, { value: string; important: boolean }>;
  type Ancestor = { offset: number | undefined; styles: InlineStyles };
  const addCss = (
    source: string,
    context: "stylesheet" | "declarationList",
    offset?: number,
    element?: string,
  ) => {
    const inline: InlineStyles = new Map();
    if (context === "stylesheet" && source.trim() !== "") unresolvedStyles = true;
    // oxlint-disable-next-line samva/no-try-catch-or-throw -- Unparseable external CSS cannot establish a safe fallback; retain the matrix warning.
    try {
      const ast = parse(source, { context });
      walk(ast, (node) => {
        if (node.type === "Raw") complete = false;
        if (node.type !== "Declaration") return;
        const property = node.property.toLowerCase();
        const entries = declarations.get(property) ?? [];
        const value = generate(node.value);
        entries.push({ value, offset, element });
        if (!inline.get(property)?.important || node.important)
          inline.set(property, { value: value.toLowerCase(), important: Boolean(node.important) });
        declarations.set(property, entries);
      });
    } catch {
      complete = false;
    }
    return inline;
  };
  const { document } = parseHtml(html);
  const visit = (
    node: (typeof document.children)[number],
    ancestors: readonly Ancestor[] = [],
  ): void => {
    let descendants = ancestors;
    if (node.type === "comment" && /\[if\b/i.test(node.data)) unresolvedStyles = true;
    if ("attribs" in node) {
      const offset = node.startIndex ?? undefined;
      if (offset !== undefined) {
        const entries = elements.get(node.name) ?? [];
        entries.push(offset);
        elements.set(node.name, entries);
      }
      for (const [name, value] of Object.entries(node.attribs)) {
        const entries = attributes.get(name) ?? [];
        entries.push({ value, offset, element: node.name });
        attributes.set(name, entries);
      }
      const styles =
        node.attribs.style === undefined
          ? new Map<string, { value: string; important: boolean }>()
          : addCss(node.attribs.style, "declarationList", offset, node.name);
      descendants = [...ancestors, { offset, styles }];
      // Only resolved inline hiding establishes these pinned Outlook failures.
      // Clipping, visibility, MSO rules and CSS-wide resets need a client check.
      const fallback = descendants.some(({ styles: candidate }) => {
        const candidateDisplay = candidate.get("display")?.value;
        return (
          (candidateDisplay !== undefined &&
            !/^(?:none|block|inline|inline-block|table|table-row|table-cell|table-row-group)$/i.test(
              candidateDisplay,
            )) ||
          candidate.has("all") ||
          Object.entries(NON_HIDING_VALUES).some(([property, neutral]) => {
            const value = candidate.get(property)?.value;
            return value !== undefined && !neutral.test(value);
          }) ||
          ["height", "max-height"].some((property) => {
            const value = candidate.get(property)?.value;
            return (
              value !== undefined &&
              value !== (property === "height" ? "auto" : "none") &&
              !(POSITIVE_FIXED_HEIGHT.test(value) && Number.parseFloat(value) > 0)
            );
          })
        );
      });
      const hiddenAncestor = ancestors.find(
        ({ styles: candidate }) => candidate.get("display")?.value === "none",
      );
      const display = styles.get("display")?.value;
      if (
        !fallback &&
        node.name === "img" &&
        display === "none" &&
        hiddenAncestor === undefined &&
        offset !== undefined
      )
        hiddenContentOffsets.push(offset);
      if (
        !fallback &&
        node.name === "table" &&
        hiddenAncestor !== undefined &&
        display === undefined &&
        hiddenAncestor.offset !== undefined
      )
        hiddenContentOffsets.push(hiddenAncestor.offset);
      if (node.name === "style") {
        // A retained stylesheet has no element-level source evidence. Do not blame its wrapper.
        for (const child of node.children)
          if (child.type === "text") addCss(child.data, "stylesheet");
      }
    }
    if ("children" in node) for (const child of node.children) visit(child, descendants);
  };
  for (const child of document.children) visit(child);
  if (css !== undefined) addCss(css, "stylesheet");

  const everyValue = (property: string, predicate: (value: string) => boolean): boolean => {
    const entries = declarations.get(property);
    return (
      complete &&
      entries !== undefined &&
      entries.length > 0 &&
      entries.every(({ value }) => predicate(value))
    );
  };

  return {
    /** Known hidden-content failures; unresolved cascade or fallback evidence cannot block. */
    get hiddenContentOffsets(): readonly number[] {
      return complete && !unresolvedStyles ? [...new Set(hiddenContentOffsets)] : [];
    },
    /** Incomplete CSS cannot prove that every occurrence avoids a limitation. */
    get complete() {
      return complete;
    },
    declarations(property: string): readonly Declaration[] {
      return declarations.get(property) ?? [];
    },
    attributes(name: string): readonly Declaration[] {
      return attributes.get(name) ?? [];
    },
    /** Bounded exceptions to caniemail@2.0.2's feature-wide matrix, tied to its client rules. */
    explanation(title: string, client: string, support: string): string | undefined {
      if (
        title === "font-size" &&
        support === "partial" &&
        ["outlook.windows", "yahoo.desktop-webmail"].includes(client) &&
        everyValue("font-size", (value) => /^(?:0|(?:\d+(?:\.\d+)?|\.\d+)px)$/i.test(value))
      )
        return "All font sizes use pixels; this client's rem-unit limitation does not apply.";
      if (
        title === "border-radius" &&
        support === "partial" &&
        client === "yahoo.desktop-webmail" &&
        everyValue("border-radius", (value) =>
          /^(?:0|(?:\d+(?:\.\d+)?|\.\d+)(?:px|%))(?:\s+(?:0|(?:\d+(?:\.\d+)?|\.\d+)(?:px|%))){0,3}$/i.test(
            value,
          ),
        )
      )
        return "These corner radii do not use the unsupported elliptical slash syntax.";
      if (
        title === "target attribute" &&
        [
          "gmail.desktop-webmail",
          "gmail.ios",
          "gmail.android",
          "outlook.outlook-com",
          "yahoo.desktop-webmail",
          "outlook.windows",
          "apple-mail.macos",
          "apple-mail.ios",
        ].includes(client) &&
        attributes.has("target") &&
        attributes.get("target")!.every(({ value }) => value === "_blank")
      )
        return "Links already request a new window, matching the client's enforced behavior.";
      if (
        title === "system-ui, ui-serif, ui-sans-serif, ui-rounded, ui-monospace" &&
        everyValue("font-family", (value) =>
          /(?:^|,)\s*(?:sans-serif|serif|monospace)\s*$/i.test(value),
        )
      )
        return "Every font stack ends with a generic fallback. Font appearance can differ in this client.";
      return undefined;
    },
    offsets(title: string): readonly number[] {
      const element = /^<([a-z0-9]+)> element$/i.exec(title);
      if (element !== null) return elements.get(element[1]!) ?? [];
      const attribute = /^([a-z-]+) attribute$/i.exec(title);
      const entries =
        attribute !== null
          ? attributes.get(attribute[1]!)
          : declarations.get(
              title.startsWith("system-ui,") ? "font-family" : title.replace(/ property$/, ""),
            );
      return [
        ...new Set(entries?.flatMap(({ offset }) => (offset === undefined ? [] : [offset])) ?? []),
      ];
    },
  };
};
