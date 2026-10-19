import type {
  CompiledElement,
  CompiledNode,
  CompiledPredicate,
  CompiledRaw,
  CompiledRawPart,
  CompiledSource,
  CompiledStyle,
  CompiledValue,
} from "../compiled-template";
// oxlint-disable samva/no-hand-rolled-object-guard -- IR nodes and Babel nodes are this package's own typed data, discriminated structurally; nothing here validates external input.
import { applyStylesheet, DARK_CLASS_PREFIX, renderDarkRules } from "../email/cascade";
import type { Stylesheet } from "../email/css";
import type { TemplateDiagnostic } from "../email/diagnostics";
import { serializeStyle } from "../email/html";
import { EmailNode } from "../email/jsx-runtime";
import type { JsxSourceLocation } from "../source-locations";
import { isValueNode } from "./bindings";
import { Tokens, rawParts } from "./tokens";

// Tailwind and the project's stylesheets are resolved against the lowered tree, once, at compile
// time. The cascade the email pipeline already runs works on a tree of elements, so the IR is
// projected into one (a "shadow": tags, classes, attributes and authored declarations), the
// cascade runs, and the winning declarations are written back as each element's inline style.
//
// A class that depends on the input picks between literal class lists. Each list is resolved in
// its own pass, and the element's style becomes the same choice between resolved styles.

type ClassTree =
  | { readonly leaf: string }
  | { readonly pred: CompiledPredicate; readonly then: ClassTree; readonly else: ClassTree };

const MAX_CLASS_VARIANTS = 8;

const product = (left: ClassTree, right: ClassTree): ClassTree => {
  if ("leaf" in left) {
    const prefix = left.leaf;
    const prepend = (tree: ClassTree): ClassTree =>
      "leaf" in tree
        ? { leaf: prefix + tree.leaf }
        : { pred: tree.pred, then: prepend(tree.then), else: prepend(tree.else) };
    return prepend(right);
  }
  return { pred: left.pred, then: product(left.then, right), else: product(left.else, right) };
};

const classTree = (value: CompiledValue): ClassTree | undefined => {
  if (typeof value === "string") return { leaf: value };
  if (typeof value !== "object" || value === null) return undefined;
  if ("if" in value) {
    const then = classTree(value.then);
    const otherwise = classTree(value.else);
    return then === undefined || otherwise === undefined
      ? undefined
      : { pred: value.if, then, else: otherwise };
  }
  if ("concat" in value) {
    let tree: ClassTree = { leaf: "" };
    for (const part of value.concat) {
      const next = classTree(part);
      if (next === undefined) return undefined;
      tree = product(tree, next);
    }
    return tree;
  }
  return undefined;
};

const leavesOf = (tree: ClassTree): readonly string[] =>
  "leaf" in tree ? [tree.leaf] : [...leavesOf(tree.then), ...leavesOf(tree.else)];

const mapTree = (
  tree: ClassTree,
  leafStyle: (index: number) => CompiledStyle,
  counter = { next: 0 },
): CompiledStyle => {
  if ("leaf" in tree) return leafStyle(counter.next++);
  const then = mapTree(tree.then, leafStyle, counter);
  const otherwise = mapTree(tree.else, leafStyle, counter);
  return JSON.stringify(then) === JSON.stringify(otherwise)
    ? then
    : { if: tree.pred, then, else: otherwise };
};

/** A class tree as the IR value it was read from: a literal, or a choice between literals. */
const treeValue = (tree: ClassTree): CompiledValue =>
  "leaf" in tree
    ? tree.leaf
    : { if: tree.pred, then: treeValue(tree.then), else: treeValue(tree.else) };

const appendClass = (classes: string, name: string | undefined): string =>
  name === undefined ? classes : classes.trim() === "" ? name : `${classes} ${name}`;

/**
 * An element's class with the dark-mode class each pass gave it. A choice between literal class
 * lists resolved one list per pass, so each list gains its own pass's class; any other class
 * value gains the first pass's. `undefined` when no pass gave the element one.
 */
const withDarkClass = (
  value: CompiledValue | undefined,
  tree: ClassTree | undefined,
  perPass: readonly (string | undefined)[],
): CompiledValue | undefined => {
  if (perPass.every((name) => name === undefined)) return undefined;
  if (tree !== undefined && leavesOf(tree).length > 1) {
    let leaf = 0;
    const extend = (node: ClassTree): ClassTree =>
      "leaf" in node
        ? { leaf: appendClass(node.leaf, perPass[Math.min(leaf++, perPass.length - 1)]) }
        : { pred: node.pred, then: extend(node.then), else: extend(node.else) };
    return treeValue(extend(tree));
  }
  const name = perPass[0];
  if (name === undefined) return value;
  if (value === undefined) return name;
  if (typeof value === "string") return appendClass(value, name);
  return { concat: [value, ` ${name}`] };
};

type Item =
  | { readonly kind: "el"; readonly el: CompiledElement }
  | { readonly kind: "raw"; readonly raw: CompiledRaw };

const collect = (nodes: readonly CompiledNode[], into: Item[]): void => {
  for (const node of nodes) {
    if (isValueNode(node)) continue;
    if ("el" in node) {
      into.push({ kind: "el", el: node });
      collect(node.children ?? [], into);
    } else if ("if" in node) {
      collect(node.then, into);
      collect(node.else ?? [], into);
    } else if ("each" in node) collect(node.children, into);
    else if ("raw" in node) into.push({ kind: "raw", raw: node });
  }
};

interface PassResult {
  readonly styles: (Readonly<Record<string, string>> | undefined)[];
  readonly bgcolors: (string | undefined)[];
  /** The generated dark-mode class the cascade gave each element, if any. */
  readonly darkClasses: (string | undefined)[];
  readonly raws: string[];
}

export interface StyleOptions {
  readonly locate: (source: CompiledSource | undefined) => JsxSourceLocation | undefined;
  readonly report: (diagnostic: TemplateDiagnostic) => void;
}

export interface StyledTree {
  readonly root: CompiledNode;
  readonly headCss: string;
  readonly fontFaceCss: string;
}

const rawHtml = (tokens: Tokens, parts: readonly CompiledRawPart[]): string =>
  parts
    .map((part) =>
      typeof part === "string" ? part : tokens.value("attr" in part ? part.attr : part.text),
    )
    .join("");

/** Resolve the sheet against a lowered tree and write each element's inline style. */
export const applyStyles = (
  root: CompiledNode,
  sheet: Stylesheet,
  options: StyleOptions,
): StyledTree => {
  const items: Item[] = [];
  collect([root], items);
  const tokens = new Tokens();
  const trees = items.map((item) => {
    if (item.kind !== "el") return undefined;
    const value = item.el.attrs?.class;
    if (value === undefined) return undefined;
    const tree = classTree(value);
    if (tree === undefined) return undefined;
    return tree;
  });
  const leafCounts = trees.map((tree) => (tree === undefined ? 1 : leavesOf(tree).length));
  for (const [index, count] of leafCounts.entries()) {
    if (count > MAX_CLASS_VARIANTS) {
      const item = items[index];
      const at = item?.kind === "el" ? options.locate(item.el.src) : undefined;
      options.report({
        code: "too-many-class-variants",
        severity: "error",
        message: `This class list chooses between ${count} literal lists; the compiler resolves at most ${MAX_CLASS_VARIANTS}.`,
        fix: "Split the choice into fewer conditions, or move part of it to a partial.",
        origins: at === undefined ? [] : [at],
      });
      return { root, headCss: "", fontFaceCss: "" };
    }
  }
  const passes = Math.max(1, ...leafCounts);

  const shadow = (
    nodes: readonly CompiledNode[],
    pass: number,
    cursor: { next: number },
  ): EmailNode[] =>
    nodes.flatMap((node): EmailNode[] => {
      if (isValueNode(node)) return [];
      if ("el" in node) {
        const index = cursor.next++;
        const tree = trees[index];
        const leaves = tree === undefined ? undefined : leavesOf(tree);
        const props: Record<string, unknown> = {};
        for (const [name, value] of Object.entries(node.attrs ?? {})) {
          if (name === "class") continue;
          if (typeof value === "string" || typeof value === "number") props[name] = value;
          else if (typeof value === "object" && value !== null) props[name] = tokens.value(value);
        }
        if (leaves !== undefined) props.class = leaves[Math.min(pass, leaves.length - 1)];
        else if (node.attrs?.class !== undefined) props.class = tokens.value(node.attrs.class);
        const style = node.style;
        if (Array.isArray(style)) {
          const declared: Record<string, string | number> = {};
          for (const [property, value] of style as readonly (readonly [string, CompiledValue])[]) {
            if (value === null || typeof value === "boolean") continue;
            declared[property] = typeof value === "number" ? value : tokens.value(value);
          }
          props.style = declared;
        } else if (typeof style === "string" && style !== "") {
          const declared: Record<string, string> = {};
          for (const part of style.split(";")) {
            const at = part.indexOf(":");
            if (at > 0) declared[part.slice(0, at)] = part.slice(at + 1);
          }
          props.style = declared;
        }
        const at = options.locate(node.src);
        return [
          EmailNode.Element({
            tag: node.el,
            props,
            children: shadow(node.children ?? [], pass, cursor),
            origins: at === undefined ? [] : [at],
            authored: true,
          }),
        ];
      }
      if ("if" in node)
        return [
          EmailNode.Fragment({
            children: [
              ...shadow(node.then, pass, cursor),
              ...shadow(node.else ?? [], pass, cursor),
            ],
          }),
        ];
      if ("each" in node)
        return [EmailNode.Fragment({ children: shadow(node.children, pass, cursor) })];
      if ("raw" in node) {
        cursor.next++;
        return [EmailNode.Raw({ html: rawHtml(tokens, node.raw), text: "", origins: [] })];
      }
      return [];
    });

  const read = (nodes: readonly EmailNode[], into: PassResult): void => {
    for (const node of nodes) {
      if (node.type === "Fragment") read(node.children, into);
      else if (node.type === "Raw") into.raws.push(node.html);
      else if (node.type === "Element") {
        const classes = typeof node.props.class === "string" ? node.props.class.split(" ") : [];
        into.darkClasses.push(classes.find((name) => name.startsWith(DARK_CLASS_PREFIX)));
        into.styles.push(
          node.props.style === undefined
            ? undefined
            : (node.props.style as Readonly<Record<string, string>>),
        );
        into.bgcolors.push(typeof node.props.bgcolor === "string" ? node.props.bgcolor : undefined);
        read(node.children, into);
      }
    }
  };

  const results: PassResult[] = [];
  let headCss = "";
  let fontFaceCss = "";
  const darkRules = new Map<string, string>();
  const seen = new Set<string>();
  for (let pass = 0; pass < passes; pass++) {
    const tree = shadow([root], pass, { next: 0 });
    const applied = applyStylesheet(tree[0] ?? EmailNode.Fragment({ children: [] }), sheet);
    if (pass === 0) {
      headCss = applied.headCss;
      fontFaceCss = applied.fontFaceCss;
    }
    for (const [name, body] of applied.darkRules) darkRules.set(name, body);
    for (const diagnostic of applied.diagnostics) {
      const key = `${diagnostic.code}\0${diagnostic.message}`;
      if (seen.has(key)) continue;
      seen.add(key);
      options.report(diagnostic);
    }
    const result: PassResult = { styles: [], bgcolors: [], darkClasses: [], raws: [] };
    read([applied.tree], result);
    results.push(result);
  }

  const styleOf = (
    declarations: Readonly<Record<string, string>> | undefined,
    element: CompiledElement,
  ): CompiledStyle => {
    if (declarations === undefined) return "";
    const entries = Object.entries(declarations);
    if (entries.length === 0) return "";
    const at = options.locate(element.src);
    const dynamic = entries.some(([, value]) => value.includes(""));
    const staticOnly = Object.fromEntries(entries.filter(([, value]) => !value.includes("")));
    const checked = serializeStyle(staticOnly, at === undefined ? [] : [at]);
    for (const diagnostic of checked.diagnostics) options.report(diagnostic);
    if (!dynamic) return checked.css;
    return entries.map(([property, value]) => {
      const resolved = tokens.toValue(value);
      return [property, resolved ?? value] as const;
    });
  };

  let cursor = 0;
  let elementCursor = 0;
  let rawCursor = 0;
  const rebuild = (nodes: readonly CompiledNode[]): CompiledNode[] =>
    nodes.map((node): CompiledNode => {
      if (isValueNode(node)) return node;
      if ("el" in node) {
        const index = cursor++;
        const ordinal = elementCursor++;
        const tree = trees[index];
        const first = results[0];
        const baseStyle = first?.styles[ordinal];
        const style: CompiledStyle =
          tree !== undefined && leavesOf(tree).length > 1
            ? mapTree(tree, (leaf) =>
                styleOf(results[Math.min(leaf, results.length - 1)]?.styles[ordinal], node),
              )
            : styleOf(baseStyle, node);
        const bgcolor = first?.bgcolors[ordinal];
        const painted =
          typeof node.attrs?.bgcolor === "string" &&
          bgcolor !== undefined &&
          bgcolor !== node.attrs.bgcolor
            ? { ...node.attrs, bgcolor: tokens.toValue(bgcolor) ?? bgcolor }
            : node.attrs;
        const darkClass = withDarkClass(
          node.attrs?.class,
          tree,
          results.map((result) => result.darkClasses[ordinal]),
        );
        const attrs = darkClass === undefined ? painted : { ...painted, class: darkClass };
        const kids = rebuild(node.children ?? []);
        const { style: _authored, children: _children, attrs: _attrs, ...rest } = node;
        void _authored;
        void _children;
        void _attrs;
        return {
          ...rest,
          ...(attrs === undefined ? {} : { attrs }),
          ...(style === "" ? {} : { style }),
          ...(kids.length === 0 ? {} : { children: kids }),
        };
      }
      if ("if" in node) {
        const then = rebuild(node.then);
        const otherwise = rebuild(node.else ?? []);
        return { ...node, then, ...(node.else === undefined ? {} : { else: otherwise }) };
      }
      if ("each" in node) return { ...node, children: rebuild(node.children) };
      if ("raw" in node) {
        cursor++;
        const html = results[0]?.raws[rawCursor++];
        return html === undefined ? node : { ...node, raw: rawParts(tokens, html) };
      }
      return node;
    });

  return {
    root: rebuild([root])[0] ?? root,
    headCss: `${renderDarkRules(darkRules)}${headCss}`,
    fontFaceCss,
  };
};
