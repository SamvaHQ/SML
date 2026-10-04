import type { CssRule } from "./css";

// The half of the CSS pipeline that runs at render time. Parsing needs css-tree
// and happens once, at build time; matching and value resolution run per render
// inside the isolated host, which must not carry a CSS parser at all — a
// template's locked graph should never have to include one.

const MAX_RESOLVED_VALUE_LENGTH = 64 * 1024;
const MAX_RESOLUTION_WORK = 256 * 1024;

interface ResolutionWork {
  remaining: number;
}

const resolveVariablesWithin = (
  value: string,
  variables: Readonly<Record<string, string>>,
  depth: number,
  budget: number,
  work: ResolutionWork,
): string | undefined => {
  if (value.length > work.remaining) return undefined;
  work.remaining -= value.length;
  if (value.length > budget) return undefined;
  if (depth > 8 || !value.includes("var(")) return value;
  const chunks: string[] = [];
  let length = 0;
  const append = (chunk: string): boolean => {
    length += chunk.length;
    if (length > budget) return false;
    chunks.push(chunk);
    return true;
  };
  let cursor = 0;
  while (cursor < value.length) {
    const start = value.indexOf("var(", cursor);
    if (start < 0) {
      if (!append(value.slice(cursor))) return undefined;
      break;
    }
    if (!append(value.slice(cursor, start))) return undefined;
    let level = 0;
    let end = -1;
    for (let index = start + 3; index < value.length; index++) {
      if (value[index] === "(") level += 1;
      else if (value[index] === ")") {
        level -= 1;
        if (level === 0) {
          end = index;
          break;
        }
      }
    }
    if (end < 0) {
      if (!append(value.slice(start))) return undefined;
      break;
    }
    const body = value.slice(start + 4, end);
    const comma = body.indexOf(",");
    const name = (comma < 0 ? body : body.slice(0, comma)).trim();
    const fallback = comma < 0 ? undefined : body.slice(comma + 1).trim();
    const replacement = variables[name] ?? fallback;
    const resolved =
      replacement === undefined
        ? value.slice(start, end + 1)
        : resolveVariablesWithin(replacement, variables, depth + 1, budget - length, work);
    if (resolved === undefined || !append(resolved)) return undefined;
    cursor = end + 1;
  }
  return chunks.join("");
};

/**
 * Expand `var(--x, fallback)` against the collected custom properties.
 * Values whose expansion exceeds the render-time budget are left as authored.
 */
export const resolveVariables = (
  value: string,
  variables: Readonly<Record<string, string>>,
  depth = 0,
): string =>
  resolveVariablesWithin(value, variables, depth, MAX_RESOLVED_VALUE_LENGTH, {
    remaining: MAX_RESOLUTION_WORK,
  }) ?? value;

interface Dimension {
  readonly n: number;
  readonly unit: string;
}

/**
 * Fold a constant `calc()` to a plain value. Tailwind writes every spacing
 * utility as `calc(var(--spacing) * n)`, and classic Outlook does not implement
 * `calc()` at all, so an unfolded value is a silently missing style. An
 * expression that cannot be reduced to one term is left exactly as authored.
 */
export const foldCalc = (value: string): string => {
  if (!value.includes("calc(")) return value;
  let result = "";
  let rest = value;
  while (rest.length > 0) {
    const start = rest.indexOf("calc(");
    if (start < 0) {
      result += rest;
      break;
    }
    result += rest.slice(0, start);
    let level = 0;
    let end = -1;
    for (let index = start + 4; index < rest.length; index++) {
      if (rest[index] === "(") level += 1;
      else if (rest[index] === ")") {
        level -= 1;
        if (level === 0) {
          end = index;
          break;
        }
      }
    }
    if (end < 0) {
      result += rest.slice(start);
      break;
    }
    const folded = evaluate(rest.slice(start + 5, end));
    result += folded === undefined ? rest.slice(start, end + 1) : format(folded);
    rest = rest.slice(end + 1);
  }
  return result;
};

const format = (value: Dimension): string =>
  `${Math.round(value.n * 1e6) / 1e6}${value.n === 0 && value.unit !== "%" ? "" : value.unit}`;

const evaluate = (expression: string): Dimension | undefined => {
  const tokens = expression.match(/\(|\)|[+-]\s|[*/]|[^\s()*/]+/g);
  if (tokens === null) return undefined;
  let position = 0;
  const peek = () => tokens[position]?.trim();
  const sum = (): Dimension | undefined => {
    let left = product();
    while (left !== undefined && (peek() === "+" || peek() === "-")) {
      const operator = peek();
      position += 1;
      const right = product();
      if (right === undefined || left.unit !== right.unit) return undefined;
      left = { n: operator === "+" ? left.n + right.n : left.n - right.n, unit: left.unit };
    }
    return left;
  };
  const product = (): Dimension | undefined => {
    let left = term();
    while (left !== undefined && (peek() === "*" || peek() === "/")) {
      const operator = peek();
      position += 1;
      const right = term();
      if (right === undefined) return undefined;
      if (operator === "*") {
        if (left.unit !== "" && right.unit !== "") return undefined;
        left = { n: left.n * right.n, unit: left.unit === "" ? right.unit : left.unit };
      } else {
        if (right.unit !== "" || right.n === 0) return undefined;
        left = { n: left.n / right.n, unit: left.unit };
      }
    }
    return left;
  };
  const term = (): Dimension | undefined => {
    const token = tokens[position];
    if (token === undefined) return undefined;
    if (token === "(") {
      position += 1;
      const inner = sum();
      if (peek() !== ")") return undefined;
      position += 1;
      return inner;
    }
    const match = /^(-?(?:\d+\.?\d*|\.\d+))([a-z%]*)$/i.exec(token.trim());
    if (match === null) return undefined;
    position += 1;
    return { n: Number.parseFloat(match[1]!), unit: (match[2] ?? "").toLowerCase() };
  };
  const value = sum();
  return position === tokens.length ? value : undefined;
};

/** Resolve custom properties, then fold what the arithmetic allows. */
export const finalizeValue = (value: string, variables: Readonly<Record<string, string>>): string =>
  foldCalc(resolveVariables(value, variables));

const RANGE_FEATURE = /\(\s*([a-z-]+)\s*(<=|>=|<|>)\s*([^)]+?)\s*\)/gi;

/** Media Queries Level 4 range syntax down to the `min-`/`max-` prefixes clients support. */
export const downlevelMediaQuery = (condition: string): string =>
  condition.replace(RANGE_FEATURE, (whole, feature: string, comparison: string, bound: string) => {
    const prefix = comparison.startsWith(">") ? "min-" : "max-";
    return `(${prefix}${feature}:${bound})`;
  });

/** Render the rules that could not be inlined as one `<style>` body. */
export const renderHeadCss = (
  rules: readonly CssRule[],
  headAtRules: readonly string[],
  variables: Readonly<Record<string, string>>,
): string => {
  const blocks: string[] = [...headAtRules];
  const grouped = new Map<string, { conditions: readonly string[]; rules: CssRule[] }>();
  for (const rule of rules) {
    const conditions = rule.conditions.map(downlevelMediaQuery);
    const key = conditions.join("\u0000");
    const bucket = grouped.get(key);
    if (bucket === undefined) grouped.set(key, { conditions, rules: [rule] });
    else bucket.rules.push(rule);
  }
  for (const { conditions, rules: bucket } of grouped.values()) {
    const body = bucket
      .map((rule) => {
        const declarations = rule.declarations
          .filter((declaration) => !declaration.property.startsWith("--"))
          .map(
            (declaration) =>
              // Retained rules must beat the styles inlined onto the same
              // element, which is the only reason they were retained.
              `${declaration.property}:${finalizeValue(declaration.value, variables)}!important`,
          )
          .join(";");
        return declarations === "" ? "" : `${rule.selector}{${declarations}}`;
      })
      .filter((block) => block !== "")
      .join("");
    if (body === "") continue;
    // Conditional at-rules nest; there is no operator that joins a `@media`
    // prelude to a `@supports` one, and even two media queries cannot be
    // combined with `and` without re-deriving one valid query from both.
    blocks.push(conditions.reduceRight((inner, condition) => `${condition}{${inner}}`, body));
  }
  return blocks.join("");
};
