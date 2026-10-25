import { generate, parse, type CssNode } from "css-tree";

import type { CompiledNode, CompiledValue } from "../compiled-template";
import { parseStylesheet, type Stylesheet } from "../email/css";
import { PRIMITIVE_CSS } from "../email/primitive-css";
import { isValueNode, type WebCssRule, type WebPresentation } from "./nodes";
import { Tokens } from "./tokens";

/** Parse compiler-owned font and keyframe rules once; send time only serializes checked data. */
const cssNodes = (node: CssNode, tokens?: Tokens): WebCssRule[] => {
  if (node.type === "StyleSheet")
    return [...node.children].flatMap((child) => cssNodes(child, tokens));
  if (node.type !== "Rule" && node.type !== "Atrule") return [];
  const style: (readonly [string, CompiledValue])[] = [];
  const children: WebCssRule[] = [];
  for (const child of node.block?.children ?? []) {
    if (child.type === "Declaration")
      style.push([
        child.property,
        tokens?.toValue(`${generate(child.value)}${child.important ? "!important" : ""}`) ??
          `${generate(child.value)}${child.important ? "!important" : ""}`,
      ]);
    else children.push(...cssNodes(child, tokens));
  }
  return [
    {
      ...(node.type === "Rule"
        ? { selector: generate(node.prelude) }
        : { at: `${node.name}${node.prelude === null ? "" : ` ${generate(node.prelude)}`}` }),
      ...(style.length === 0 ? {} : { style }),
      ...(children.length === 0 ? {} : { children }),
    },
  ];
};

/** Retain project selectors, conditions and fonts independently of the email cascade. */
export const webPresentation = (
  sheets: readonly Stylesheet[],
  tailwind: Stylesheet | undefined,
  body: CompiledNode,
): WebPresentation => {
  const rules: WebCssRule[] = [];
  const layers = [
    ...new Set(
      sheets
        .flatMap((sheet) => sheet.rules.map((rule) => rule.layer))
        .filter((layer) => layer !== Number.MAX_SAFE_INTEGER),
    ),
  ].sort((a, b) => a - b);
  rules.push({
    at: `layer sml-web-components${layers.map((layer) => `,sml-web-${layer}`).join("")}`,
  });
  const signature = (rule: Stylesheet["rules"][number]) =>
    JSON.stringify([rule.selector, rule.declarations, rule.conditions]);
  const defaults = new Set(parseStylesheet(PRIMITIVE_CSS).rules.map(signature));
  const fonts = new Set<string>();
  for (const sheet of sheets) {
    // @theme is compiler syntax rather than a selector; emit its token declarations as CSS.
    if (Object.keys(sheet.variables).length > 0)
      rules.push({ selector: ":root", style: Object.entries(sheet.variables) });
    if (Object.keys(sheet.darkVariables).length > 0)
      rules.push({
        at: "media (prefers-color-scheme:dark)",
        children: [{ selector: ":root", style: Object.entries(sheet.darkVariables) }],
      });
    for (const rule of sheet.rules) {
      if (sheet === tailwind && defaults.has(signature(rule))) continue;
      let out: WebCssRule = {
        selector: rule.selector,
        style: rule.declarations
          .filter(({ property }) => !/^mso-/i.test(property))
          .map(({ property, value, important }) => [
            property,
            `${value}${important ? "!important" : ""}`,
          ]),
      };
      for (const condition of rule.conditions.toReversed())
        out = { at: condition.replace(/^@/, ""), children: [out] };
      if (rule.layer !== Number.MAX_SAFE_INTEGER)
        out = { at: `layer sml-web-${rule.layer}`, children: [out] };
      rules.push(out);
    }
    for (const face of sheet.fontFaces)
      if (!fonts.has(face.css)) {
        fonts.add(face.css);
        rules.push(...cssNodes(parse(face.css)));
      }
    for (const css of sheet.headAtRules) rules.push(...cssNodes(parse(css)));
  }
  const componentLayer = tailwind?.rules.find((rule) => rule.selector === ".sml-email")?.layer;
  let inlineSpecificity =
    sheets.reduce(
      (max, sheet) =>
        sheet.rules.reduce((highest, rule) => Math.max(highest, rule.specificity[0]), max),
      0,
    ) + 1;
  const stylesheets: (readonly WebCssRule[])[] = [];
  const authored = (node: CompiledNode): void => {
    if (isValueNode(node)) return;
    if (
      ("type" in node && node.type !== "component" && node.tag === "style") ||
      ("el" in node && node.el === "style")
    ) {
      const tokens = new Tokens();
      const cssValue = (part: CompiledValue): string => {
        if (typeof part === "string") return part;
        if (part === null || typeof part === "boolean") return "";
        if (typeof part === "number") return String(part);
        if ("concat" in part) return part.concat.map(cssValue).join("");
        return tokens.value(part);
      };
      const css = (node.children ?? [])
        .map((part) => (isValueNode(part) ? cssValue(part) : "unsupported"))
        .join("");
      // Whole stylesheets, selectors and declaration names cannot be supplied by input data.
      // Only parsed declaration values are restored to expressions and evaluated at render time.
      let parsed: readonly WebCssRule[];
      // oxlint-disable-next-line samva/no-try-catch-or-throw -- CSS supplied in an authored style element is parsed once at compilation; malformed/raw stylesheet interpolation rejects at the renderer's typed boundary.
      try {
        parsed = cssNodes(parse(css), tokens);
      } catch {
        parsed = [];
      }
      stylesheets.push(
        parsed.length === 0 && css.trim() !== ""
          ? [{ at: "unsupported-dynamic-stylesheet" }]
          : parsed,
      );
      const selectorIds = (list: readonly WebCssRule[]): void => {
        for (const rule of list) {
          // Counting all hashes also overestimates :is/:where and attribute strings, safely.
          inlineSpecificity = Math.max(
            inlineSpecificity,
            (rule.selector?.match(/#/g)?.length ?? 0) + 1,
          );
          selectorIds(rule.children ?? []);
        }
      };
      selectorIds(parsed);
      return;
    }
    if ("if" in node) {
      for (const part of node.then) authored(part);
      for (const part of node.else ?? []) authored(part);
    } else if ("children" in node) for (const part of node.children ?? []) authored(part);
  };
  authored(body);
  return {
    rules,
    ...(componentLayer === undefined ? {} : { componentLayer }),
    inlineSpecificity,
    ...(stylesheets.length === 0 ? {} : { stylesheets }),
  };
};
