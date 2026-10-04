// oxlint-disable samva/no-hand-rolled-object-guard -- IR nodes and Babel nodes are this package's own typed data, discriminated structurally; nothing here validates external input.
import type { DiagnosticCode } from "../diagnostic-codes";
import { reservedBrandAttributes, type BrandPlugin } from "../email/brand-plugin";
import { EMAIL_ELEMENTS, emailElement } from "../email/elements";
import { checkAttribute } from "../email/html";
import { FORMATTER_NAMES } from "../fmt";
import type {
  IrArithmetic,
  IrComparison,
  IrEach,
  IrElement,
  IrFormatter,
  IrIf,
  IrNode,
  IrPredicate,
  IrSource,
  IrStyle,
  IrValue,
} from "../ir";
import { child, children, keyName, text, unwrap, type Node } from "./ast";
import { bindingValue, joinPath, type Binding, type Env } from "./bindings";
import { runBuiltinComponent, type ChannelLowering } from "./components";
import type { Findings } from "./diagnostics";
import type { Project, ProjectModule } from "./project";
import { didYouMean } from "./suggest";
import { readStatic, type StaticContext } from "./values";

// Lowering reads a body's syntax and builds IR. It never evaluates: an identifier is looked up in
// the bindings the enclosing function declared, a call is one of the few the profile allows, and
// anything else is a diagnostic that names the fix.

export interface LowerOptions {
  readonly project: Project;
  readonly findings: Findings;
  readonly staticContext: StaticContext;
  readonly assetUrl: (path: string) => string | undefined;
  readonly brand: import("../email/brand").EmailBrand | undefined;
  readonly brandPlugin: BrandPlugin;
  readonly channel?: ChannelLowering | undefined;
}

export interface Ctx {
  readonly module: ProjectModule;
  readonly env: Env;
  /** Partials being inlined, innermost last, to refuse recursion. */
  readonly stack: readonly string[];
  /** Loop variable names in scope, so an inner loop does not shadow a name a binding still holds. */
  readonly loops: readonly string[];
  readonly depth: number;
  /** Inside a chunked `<Columns each>`: the width a `Column` that states none takes. */
  readonly columnWidth?: IrValue | undefined;
}

const MAX_DEPTH = 40;
const ARITHMETIC: Readonly<Record<string, IrArithmetic>> = {
  "+": "+",
  "-": "-",
  "*": "*",
  "/": "/",
  "%": "%",
};
const COMPARISON: Readonly<Record<string, IrComparison>> = {
  "===": "eq",
  "!==": "ne",
  "<": "lt",
  ">": "gt",
  "<=": "le",
  ">=": "ge",
};
const FORMATTER_ARITY: Readonly<Record<IrFormatter, readonly [number, number]>> = {
  money: [2, 3],
  number: [1, 3],
  date: [1, 3],
  time: [1, 3],
  plural: [2, 3],
  list: [1, 2],
};
const RUN_TIME_METHODS = new Set([
  "reduce",
  "filter",
  "slice",
  "join",
  "sort",
  "concat",
  "flatMap",
  "find",
  "some",
  "every",
  "toFixed",
  "toLocaleString",
  "toLocaleDateString",
  "toUpperCase",
  "toLowerCase",
  "trim",
  "split",
  "replace",
  "padStart",
  "includes",
  "indexOf",
  "at",
]);

/** React's rule for JSX text: trim lines, drop blank ones, join the rest with a space. */
const cleanJsxText = (raw: string): string => {
  const lines = raw.split(/\r\n|\n|\r/);
  let lastNonEmpty = 0;
  for (const [index, line] of lines.entries()) if (/[^ \t]/.test(line)) lastNonEmpty = index;
  let output = "";
  for (const [index, line] of lines.entries()) {
    let trimmed = line.replace(/\t/g, " ");
    if (index !== 0) trimmed = trimmed.replace(/^ +/, "");
    if (index !== lines.length - 1) trimmed = trimmed.replace(/ +$/, "");
    if (trimmed !== "") {
      if (index !== lastNonEmpty) trimmed += " ";
      output += trimmed;
    }
  }
  return output;
};

const jsxName = (name: Node): string => {
  if (name.type === "JSXIdentifier") return text(name, "name") ?? "";
  if (name.type === "JSXNamespacedName")
    return `${text(child(name, "namespace") ?? name, "name") ?? ""}:${text(child(name, "name") ?? name, "name") ?? ""}`;
  if (name.type === "JSXMemberExpression")
    return `${jsxName(child(name, "object") ?? name)}.${text(child(name, "property") ?? name, "name") ?? ""}`;
  return "";
};

const isStatic = (value: IrValue): value is string | number | boolean | null =>
  value === null ||
  typeof value === "string" ||
  typeof value === "number" ||
  typeof value === "boolean";

const statementKind = (type: string): string => {
  if (type === "VariableDeclaration") return "`const`";
  if (type === "IfStatement") return "`if`";
  if (/For|While/.test(type)) return "a loop";
  return "a statement";
};

export class Lowerer {
  readonly sources: string[] = [];
  private uniqueId = 0;

  private readonly reservedAttributes: ReadonlySet<string>;

  constructor(private readonly options: LowerOptions) {
    this.reservedAttributes = reservedBrandAttributes(options.brandPlugin);
  }

  get findings(): Findings {
    return this.options.findings;
  }

  /** A stable source reference for a node: `[line, column]` in the entry, else with a file index. */
  src(module: ProjectModule, node: { readonly start: number }): IrSource {
    const at = module.parsed.position(node.start);
    if (module.path === this.options.project.entry.path) return [at.line, at.column];
    let index = this.sources.indexOf(module.path);
    if (index < 0) {
      index = this.sources.length;
      this.sources.push(module.path);
    }
    return [at.line, at.column, index + 1];
  }

  error(ctx: Ctx, node: Node, code: DiagnosticCode, message: string, fix?: string): void {
    this.findings.add(ctx.module.parsed, node, code, message, fix);
  }

  private dynamic(ctx: Ctx, node: Node, what: string, fix: string): undefined {
    this.error(
      ctx,
      node,
      "dynamic-expression",
      `${what} runs code, and templates render without running code.`,
      fix,
    );
    return undefined;
  }

  // ── Function bodies ──────────────────────────────────────────────────────────

  /** The expression a function returns, or a diagnostic when its body is more than one. */
  functionExpression(ctx: Ctx, fn: Node): Node | undefined {
    const body = child(fn, "body");
    if (body === undefined) return undefined;
    if (body.type !== "BlockStatement") return body;
    const statements = children(body, "body");
    const first = statements[0];
    if (statements.length === 1 && first?.type === "ReturnStatement") {
      const argument = child(first, "argument");
      if (argument !== undefined) return argument;
    }
    const offender = statements.find((statement) => statement.type !== "ReturnStatement") ?? body;
    const kind = statementKind(offender.type);
    this.error(
      ctx,
      offender,
      "statement-in-body",
      `A body is one expression, and ${kind} is a statement.`,
      "Write the value where it is used: `cond && <X />` or `cond ? <A /> : <B />` for branches, `.map` for lists. Compute anything else in the caller and send it in the payload.",
    );
    return undefined;
  }

  /** Bind a parameter pattern to a binding, adding the names it introduces to `env`. */
  bindPattern(
    ctx: Ctx,
    pattern: Node,
    binding: Binding | undefined,
    env: Map<string, Binding>,
    allowDefaults: boolean,
  ): void {
    switch (pattern.type) {
      case "Identifier": {
        const name = text(pattern, "name") ?? "";
        env.set(name, binding ?? { k: "value", value: null });
        return;
      }
      case "AssignmentPattern": {
        const left = child(pattern, "left");
        const right = child(pattern, "right");
        if (left === undefined || right === undefined) return;
        if (!allowDefaults) {
          this.error(
            ctx,
            pattern,
            "unsupported-pattern",
            "A default value on the input is never inserted, so it is not part of the profile.",
            "Remove the default; declare the field as required or guard it where it is read.",
          );
          return;
        }
        let resolved = binding;
        if (resolved === undefined) {
          const defaultValue = readStatic(this.options.staticContext, ctx.module, right);
          if (!defaultValue.ok) {
            this.error(
              ctx,
              right,
              "dynamic-expression",
              "A default prop value must be a literal.",
              "Use a string, number or boolean literal.",
            );
            return;
          }
          resolved = { k: "value", value: defaultValue.value as IrValue };
        }
        this.bindPattern(ctx, left, resolved, env, allowDefaults);
        return;
      }
      case "ObjectPattern": {
        for (const property of children(pattern, "properties")) {
          if (property.type === "RestElement") {
            this.error(
              ctx,
              property,
              "unsupported-pattern",
              "A rest element gathers props at run time.",
              "Name each prop you use.",
            );
            continue;
          }
          const key = child(property, "key");
          const value = child(property, "value");
          const name = keyName(key);
          if (name === undefined || value === undefined || property.computed === true) {
            this.error(
              ctx,
              property,
              "unsupported-pattern",
              "A computed key cannot be read statically.",
            );
            continue;
          }
          const field =
            binding === undefined ? undefined : this.field(ctx, binding, name, property);
          this.bindPattern(ctx, value, field, env, allowDefaults);
        }
        return;
      }
      default:
        this.error(
          ctx,
          pattern,
          "unsupported-pattern",
          "A parameter is a name or an object pattern of names.",
          "Write `(input) =>` or `({ name, items }) =>`.",
        );
    }
  }

  /** The binding for `base.name`. */
  private field(ctx: Ctx, base: Binding, name: string, at: Node): Binding | undefined {
    switch (base.k) {
      case "path":
        if (name === "length" && base.path !== "")
          return { k: "value", value: { length: { bind: base.path } } };
        return { k: "path", path: joinPath(base.path, name) };
      case "object":
        return base.fields.get(name);
      case "value":
        if (name === "length") return { k: "value", value: { length: base.value } };
        if (base.value === null) return { k: "value", value: null };
        this.error(
          ctx,
          at,
          "dynamic-expression",
          `\`.${name}\` reads a property of a computed value.`,
          "Read fields of the input directly.",
        );
        return undefined;
      case "nodes":
        this.error(
          ctx,
          at,
          "dynamic-expression",
          "`children` has no fields.",
          "Render `{children}` as is.",
        );
        return undefined;
    }
  }

  // ── Bindings and values ──────────────────────────────────────────────────────

  /** Resolve an identifier or member chain to a binding. */
  binding(ctx: Ctx, expression: Node): Binding | undefined {
    const node = unwrap(expression);
    if (node.type === "Identifier") {
      const name = text(node, "name") ?? "";
      if (name === "undefined") return { k: "value", value: null };
      const found = ctx.env.get(name);
      if (found !== undefined) return found;
      const imported = ctx.module.imports.get(name);
      if (imported?.kind === "asset") {
        const url = this.options.assetUrl(imported.path);
        if (url !== undefined) return { k: "value", value: url };
      }
      this.error(
        ctx,
        node,
        "dynamic-expression",
        `\`${name}\` is not a binding the template declared.`,
        "Read the input through the function's parameter, for example `input.name`.",
      );
      return undefined;
    }
    if (node.type === "MemberExpression") {
      const object = child(node, "object");
      const property = child(node, "property");
      if (object === undefined || property === undefined) return undefined;
      if (
        node.computed !== true &&
        text(property, "name") === "length" &&
        this.filterChain(ctx, object) !== undefined
      ) {
        const source = this.filterChain(ctx, object)!;
        if (source.list === undefined) return undefined;
        const first = source.filters[0];
        const param = first === undefined ? undefined : children(first, "params")[0];
        const as = this.uniqueName(
          ctx,
          param?.type === "Identifier" ? (text(param, "name") ?? "item") : "item",
        );
        const where = this.whereClause({ ...ctx, loops: [...ctx.loops, as] }, as, source.filters);
        return where === undefined
          ? undefined
          : { k: "value", value: { count: source.list, as, where } };
      }
      const base = this.binding(ctx, object);
      if (base === undefined) return undefined;
      let key: string | undefined;
      if (node.computed === true) {
        if (property.type === "StringLiteral") key = text(property, "value");
        else if (property.type === "NumericLiteral") key = String(property.value);
        if (key === undefined) {
          this.dynamic(
            ctx,
            node,
            "A computed property",
            "Use `.name`, or a numeric index such as `[0]`.",
          );
          return undefined;
        }
      } else key = text(property, "name");
      if (key === undefined) return undefined;
      return this.field(ctx, base, key, node);
    }
    if (node.type === "OptionalMemberExpression" || node.type === "OptionalCallExpression") {
      this.dynamic(
        ctx,
        node,
        "Optional chaining",
        "Guard the field: `input.discount && <p>{input.discount.label}</p>`.",
      );
      return undefined;
    }
    const value = this.value(ctx, node, false);
    return value === undefined ? undefined : { k: "value", value };
  }

  /** Lower an expression to a value read at render time. `arith` allows arithmetic operators. */
  value(ctx: Ctx, expression: Node, arith: boolean): IrValue | undefined {
    const node = unwrap(expression);
    switch (node.type) {
      case "StringLiteral":
        return this.checkedText(ctx, node, text(node, "value") ?? "");
      case "NumericLiteral":
        return typeof node.value === "number" ? node.value : undefined;
      case "BooleanLiteral":
        return node.value === true;
      case "NullLiteral":
        return null;
      case "Identifier":
      case "MemberExpression":
      case "OptionalMemberExpression": {
        const bound = this.binding(ctx, node);
        if (bound === undefined) return undefined;
        const value = bindingValue(bound);
        if (value !== undefined) return value;
        this.error(
          ctx,
          node,
          "dynamic-expression",
          bound.k === "path"
            ? "The input as a whole is not a value."
            : "An object or `children` is not text.",
          bound.k === "path"
            ? "Read one field: `input.name`."
            : "Render `{children}` as content, or read one field.",
        );
        return undefined;
      }
      case "TemplateLiteral":
        return this.template(ctx, node, arith);
      case "ConditionalExpression": {
        const test = child(node, "test");
        const consequent = child(node, "consequent");
        const alternate = child(node, "alternate");
        if (test === undefined || consequent === undefined || alternate === undefined)
          return undefined;
        const predicate = this.predicate(ctx, test);
        const then = this.value(ctx, consequent, arith);
        const otherwise = this.value(ctx, alternate, arith);
        if (predicate === undefined || then === undefined || otherwise === undefined)
          return undefined;
        return { if: predicate, then, else: otherwise };
      }
      case "LogicalExpression": {
        const operator = text(node, "operator");
        const left = child(node, "left");
        const right = child(node, "right");
        if (left === undefined || right === undefined) return undefined;
        if (operator === "||") {
          const a = this.value(ctx, left, arith);
          const b = this.value(ctx, right, arith);
          if (a === undefined || b === undefined) return undefined;
          return { if: { truthy: a }, then: a, else: b };
        }
        if (operator === "??") {
          this.error(
            ctx,
            node,
            "dynamic-expression",
            "`??` is not one of the conditions the profile reads.",
            'Write the condition out: `input.name === null ? "there" : input.name`, or `input.name || "there"`.',
          );
          return undefined;
        }
        this.error(
          ctx,
          node,
          "dynamic-expression",
          "`&&` in a value position yields its left operand when that is falsy.",
          "Use a conditional: `cond ? value : fallback`, or `cond && <X />` in content.",
        );
        return undefined;
      }
      case "CallExpression":
        return this.call(ctx, node);
      case "BinaryExpression": {
        const operator = text(node, "operator") ?? "";
        const op = ARITHMETIC[operator];
        const left = child(node, "left");
        const right = child(node, "right");
        if (op === undefined || left === undefined || right === undefined) {
          this.error(
            ctx,
            node,
            "dynamic-expression",
            `\`${operator}\` produces a condition, not a value.`,
            "Use it as the test of `&&`, `? :` or `||`.",
          );
          return undefined;
        }
        if (!arith) {
          this.error(
            ctx,
            node,
            "dynamic-expression",
            "Arithmetic runs code, and it is allowed only inside a `fmt.*` argument or a condition.",
            "Wrap it: `fmt.number(item.price * item.qty)`, or send the computed value in the payload.",
          );
          return undefined;
        }
        if (
          op === "+" &&
          [left, right].some((side) => /StringLiteral|TemplateLiteral/.test(unwrap(side).type))
        ) {
          this.error(
            ctx,
            node,
            "dynamic-expression",
            "`+` with a string joins text at run time.",
            "Use a template string: `${a} ${b}`.",
          );
          return undefined;
        }
        const a = this.value(ctx, left, true);
        const b = this.value(ctx, right, true);
        return a === undefined || b === undefined ? undefined : { op, args: [a, b] };
      }
      case "UnaryExpression": {
        const operator = text(node, "operator");
        const argument = child(node, "argument");
        if (operator === "-" && argument !== undefined) {
          const inner = unwrap(argument);
          if (inner.type === "NumericLiteral" && typeof inner.value === "number")
            return -inner.value;
          if (arith) {
            const value = this.value(ctx, argument, true);
            return value === undefined ? undefined : { op: "-", args: [0, value] };
          }
        }
        if (operator === "!") {
          this.error(
            ctx,
            node,
            "dynamic-expression",
            "`!` produces a condition, not a value.",
            "Use it as the test of `&&`, `? :` or `||`.",
          );
          return undefined;
        }
        return this.dynamic(
          ctx,
          node,
          `\`${operator ?? "?"}\``,
          "Send the computed value in the payload.",
        );
      }
      case "JSXElement":
      case "JSXFragment":
        this.error(
          ctx,
          node,
          "dynamic-expression",
          "Markup is not a text value.",
          "Use it as content.",
        );
        return undefined;
      case "ArrowFunctionExpression":
      case "FunctionExpression":
        return this.dynamic(ctx, node, "A function", "Write the value directly.");
      case "NewExpression":
      case "AwaitExpression":
      case "AssignmentExpression":
      case "UpdateExpression":
      case "SequenceExpression":
      case "ObjectExpression":
      case "ArrayExpression":
      case "SpreadElement":
        return this.dynamic(
          ctx,
          node,
          `\`${node.type}\``,
          "Send the computed value in the payload.",
        );
      default:
        return this.dynamic(
          ctx,
          node,
          `\`${node.type}\``,
          "Send the computed value in the payload.",
        );
    }
  }

  private checkedText(ctx: Ctx, node: Node, value: string): IrValue {
    if (/[-]/.test(value))
      this.error(
        ctx,
        node,
        "reserved-character",
        "This text contains a private-use character the compiler reserves.",
        "Remove the characters U+E000 to U+E003.",
      );
    return value;
  }

  private template(ctx: Ctx, node: Node, arith: boolean): IrValue | undefined {
    const quasis = children(node, "quasis");
    const expressions = children(node, "expressions");
    const parts: IrValue[] = [];
    let ok = true;
    for (const [index, quasi] of quasis.entries()) {
      const chunk = templateChunk(quasi);
      if (chunk !== "") parts.push(this.checkedText(ctx, quasi, chunk));
      const expression = expressions[index];
      if (expression !== undefined) {
        const value = this.value(ctx, expression, arith);
        if (value === undefined) ok = false;
        else parts.push(value);
      }
    }
    if (!ok) return undefined;
    return joinValues(parts);
  }

  /** A `fmt.*` call. Any other call is the dynamic expression the profile refuses. */
  private call(ctx: Ctx, node: Node): IrValue | undefined {
    const callee = child(node, "callee");
    const args = children(node, "arguments");
    if (callee === undefined) return undefined;
    const target = unwrap(callee);
    if (target.type === "MemberExpression" && target.computed !== true) {
      const object = child(target, "object");
      const property = child(target, "property");
      const method = property === undefined ? undefined : text(property, "name");
      if (object !== undefined && method !== undefined && this.isFmt(ctx, object)) {
        if (!(FORMATTER_NAMES as readonly string[]).includes(method)) {
          this.error(
            ctx,
            node,
            "unknown-formatter",
            `\`fmt.${method}\` is not a formatter.`,
            `Use one of ${FORMATTER_NAMES.map((name) => `fmt.${name}`).join(", ")}.`,
          );
          return undefined;
        }
        const name = method as IrFormatter;
        const [min, max] = FORMATTER_ARITY[name];
        if (args.length < min || args.length > max) {
          this.error(
            ctx,
            node,
            "formatter-arguments",
            `\`fmt.${name}\` takes ${min === max ? min : `${min} to ${max}`} arguments.`,
            "Check the formatter table in the reference.",
          );
          return undefined;
        }
        const lowered: IrValue[] = [];
        for (const argument of args) {
          const inner = unwrap(argument);
          if (inner.type === "ObjectExpression") {
            const literal = readStatic(this.options.staticContext, ctx.module, inner);
            if (!literal.ok) {
              this.error(
                ctx,
                inner,
                "dynamic-expression",
                "Formatter options are literal.",
                "Write plain string and number values.",
              );
              return undefined;
            }
            lowered.push({ lit: literal.value });
            continue;
          }
          if (inner.type === "ArrayExpression") {
            const literal = readStatic(this.options.staticContext, ctx.module, inner);
            if (literal.ok) {
              lowered.push({ lit: literal.value });
              continue;
            }
          }
          const value = this.value(ctx, argument, true);
          if (value === undefined) return undefined;
          lowered.push(value);
        }
        return { format: name, args: lowered };
      }
      if (method !== undefined && RUN_TIME_METHODS.has(method)) {
        return this.dynamic(
          ctx,
          node,
          `\`.${method}(…)\``,
          "Send the computed value in the payload and bind it, or format with `fmt.*`.",
        );
      }
    }
    if (target.type === "Identifier" && /^use[A-Z]/.test(text(target, "name") ?? "")) {
      this.error(
        ctx,
        node,
        "hook-call",
        `\`${text(target, "name")}\` is a hook, and a template has no state, effects or context.`,
        "Read the input through the function's parameter; send anything else in the payload.",
      );
      return undefined;
    }
    const name =
      target.type === "Identifier"
        ? (text(target, "name") ?? "")
        : target.type === "MemberExpression"
          ? `${jsxLike(child(target, "object"))}.${text(child(target, "property") ?? target, "name") ?? ""}`
          : "a call";
    return this.dynamic(
      ctx,
      node,
      `\`${name}(…)\``,
      "Send the computed value in the payload and bind it, or format with `fmt.money`, `fmt.number`, `fmt.date`, `fmt.time`, `fmt.plural` or `fmt.list`.",
    );
  }

  private isFmt(ctx: Ctx, object: Node): boolean {
    const node = unwrap(object);
    if (node.type !== "Identifier") return false;
    const imported = ctx.module.imports.get(text(node, "name") ?? "");
    return imported?.kind === "markup" && imported.specifier === "@samva/markup/fmt";
  }

  // ── Conditions ───────────────────────────────────────────────────────────────

  predicate(ctx: Ctx, expression: Node): IrPredicate | undefined {
    const node = unwrap(expression);
    if (node.type === "LogicalExpression") {
      const operator = text(node, "operator");
      const left = child(node, "left");
      const right = child(node, "right");
      if (left !== undefined && right !== undefined && (operator === "&&" || operator === "||")) {
        const a = this.predicate(ctx, left);
        const b = this.predicate(ctx, right);
        if (a === undefined || b === undefined) return undefined;
        if (operator === "&&") {
          const flat = (predicate: IrPredicate): readonly IrPredicate[] =>
            "and" in predicate ? predicate.and : [predicate];
          return { and: [...flat(a), ...flat(b)] };
        }
        const flat = (predicate: IrPredicate): readonly IrPredicate[] =>
          "or" in predicate ? predicate.or : [predicate];
        return { or: [...flat(a), ...flat(b)] };
      }
    }
    if (node.type === "UnaryExpression" && text(node, "operator") === "!") {
      const argument = child(node, "argument");
      const inner = argument === undefined ? undefined : this.predicate(ctx, argument);
      return inner === undefined ? undefined : { not: inner };
    }
    if (node.type === "BinaryExpression") {
      const operator = text(node, "operator") ?? "";
      const cmp = COMPARISON[operator];
      const left = child(node, "left");
      const right = child(node, "right");
      if (cmp === undefined || left === undefined || right === undefined) {
        this.error(
          ctx,
          node,
          "dynamic-expression",
          operator === "==" || operator === "!="
            ? `\`${operator}\` coerces types at run time.`
            : `\`${operator}\` is not a comparison the profile reads.`,
          "Use `===`, `!==`, `<`, `>`, `<=` or `>=`.",
        );
        return undefined;
      }
      const a = this.value(ctx, left, true);
      const b = this.value(ctx, right, true);
      return a === undefined || b === undefined ? undefined : { cmp, args: [a, b] };
    }
    const value = this.value(ctx, node, true);
    if (value === undefined) return undefined;
    if (typeof value === "object" && value !== null && "bind" in value)
      return { present: value.bind };
    if (isStatic(value)) return { truthy: value };
    return { truthy: value };
  }

  // ── Content ──────────────────────────────────────────────────────────────────

  /** Lower the children of a JSX element or fragment. */
  jsxChildren(ctx: Ctx, parent: Node): IrNode[] {
    const output: IrNode[] = [];
    for (const item of children(parent, "children")) {
      switch (item.type) {
        case "JSXText": {
          const cleaned = cleanJsxText(text(item, "value") ?? "");
          if (cleaned !== "") output.push(this.checkedText(ctx, item, cleaned) as IrNode);
          break;
        }
        case "JSXExpressionContainer": {
          const expression = child(item, "expression");
          if (expression === undefined || expression.type === "JSXEmptyExpression") break;
          output.push(...this.content(ctx, expression));
          break;
        }
        case "JSXElement":
        case "JSXFragment":
          output.push(...this.element(ctx, item));
          break;
        case "JSXSpreadChild":
          this.dynamic(ctx, item, "A spread child", "List the children.");
          break;
        default:
          break;
      }
    }
    return output;
  }

  /** Lower an expression in content position. */
  content(ctx: Ctx, expression: Node): IrNode[] {
    if (ctx.depth > MAX_DEPTH) {
      this.error(ctx, expression, "nesting-limit", "The template nests too deeply.", "Flatten it.");
      return [];
    }
    const node = unwrap(expression);
    switch (node.type) {
      case "JSXElement":
      case "JSXFragment":
        return this.element(ctx, node);
      case "StringLiteral": {
        const value = text(node, "value") ?? "";
        return value === "" ? [] : [this.checkedText(ctx, node, value) as IrNode];
      }
      case "NumericLiteral":
        return typeof node.value === "number" ? [node.value] : [];
      case "BooleanLiteral":
      case "NullLiteral":
        return [];
      case "Identifier": {
        const name = text(node, "name") ?? "";
        if (name === "undefined") return [];
        const found = ctx.env.get(name);
        if (found?.k === "nodes") return [...found.nodes];
        break;
      }
      case "LogicalExpression": {
        const operator = text(node, "operator");
        const left = child(node, "left");
        const right = child(node, "right");
        if (operator === "&&" && left !== undefined && right !== undefined) {
          const test = this.predicate(ctx, left);
          const then = this.content(ctx, right);
          if (test === undefined) return [];
          return [{ if: test, then, src: this.src(ctx.module, node) }];
        }
        break;
      }
      case "ConditionalExpression": {
        const test = child(node, "test");
        const consequent = child(node, "consequent");
        const alternate = child(node, "alternate");
        if (test === undefined || consequent === undefined || alternate === undefined) return [];
        const predicate = this.predicate(ctx, test);
        const then = this.content(ctx, consequent);
        const otherwise = this.content(ctx, alternate);
        if (predicate === undefined) return [];
        const branch: IrIf = {
          if: predicate,
          then,
          ...(otherwise.length === 0 ? {} : { else: otherwise }),
          src: this.src(ctx.module, node),
        };
        return [branch];
      }
      case "CallExpression": {
        const callee = child(node, "callee");
        const target = callee === undefined ? undefined : unwrap(callee);
        const property = target === undefined ? undefined : child(target, "property");
        if (
          target?.type === "MemberExpression" &&
          target.computed !== true &&
          property !== undefined &&
          text(property, "name") === "map"
        )
          return this.each(ctx, node, target);
        break;
      }
      default:
        break;
    }
    const value = this.value(ctx, node, false);
    return value === undefined ? [] : [value];
  }

  /** A loop variable name that shadows none in scope. */
  freshName(ctx: Ctx, base: string): string {
    return this.uniqueName(ctx, base);
  }

  private uniqueName(ctx: Ctx, base: string): string {
    if (!ctx.loops.includes(base)) return base;
    this.uniqueId += 1;
    return `${base}_${this.uniqueId}`;
  }

  private each(ctx: Ctx, call: Node, callee: Node): IrNode[] {
    const object = child(callee, "object");
    const callback = children(call, "arguments")[0];
    if (object === undefined || callback === undefined) return [];
    const source = this.filterChain(ctx, object);
    const list = source === undefined ? this.value(ctx, object, false) : source.list;
    const fn = unwrap(callback);
    if (fn.type !== "ArrowFunctionExpression" && fn.type !== "FunctionExpression") {
      this.dynamic(
        ctx,
        callback,
        "A callback that is not an inline function",
        "Write `.map((item) => <Row item={item} />)`.",
      );
      return [];
    }
    if (list === undefined) return [];
    const each = this.eachOver(ctx, call, list, fn, source?.filters ?? []);
    return each === undefined ? [] : [each];
  }

  /** `list.filter(a).filter(b)`: the list underneath and the callbacks, innermost first. */
  private filterChain(
    ctx: Ctx,
    expression: Node,
  ): { readonly list: IrValue | undefined; readonly filters: readonly Node[] } | undefined {
    const filters: Node[] = [];
    let current = unwrap(expression);
    for (;;) {
      if (current.type !== "CallExpression") break;
      const callee = child(current, "callee");
      const target = callee === undefined ? undefined : unwrap(callee);
      const property = target === undefined ? undefined : child(target, "property");
      if (
        target?.type !== "MemberExpression" ||
        target.computed === true ||
        property === undefined ||
        text(property, "name") !== "filter"
      )
        break;
      const callback = children(current, "arguments")[0];
      const object = child(target, "object");
      if (callback === undefined || object === undefined) return undefined;
      filters.unshift(unwrap(callback));
      current = unwrap(object);
    }
    if (filters.length === 0) return undefined;
    return { list: this.value(ctx, current, false), filters };
  }

  /** The condition `.filter(callbacks)` keeps items by, with the item bound as `$as`. */
  private whereClause(ctx: Ctx, as: string, filters: readonly Node[]): IrPredicate | undefined {
    const predicates: IrPredicate[] = [];
    for (const filter of filters) {
      if (!/Function/.test(filter.type)) {
        this.dynamic(
          ctx,
          filter,
          "A `.filter` callback that is not an inline function",
          "Write `.filter((item) => item.done)`.",
        );
        return undefined;
      }
      const params = children(filter, "params");
      if (params.length > 1) {
        this.error(
          ctx,
          filter,
          "dynamic-expression",
          "A `.filter` callback reads the item; its index and the array are not part of the profile.",
          "Remove the extra parameters.",
        );
        return undefined;
      }
      const env = new Map(ctx.env);
      if (params[0] !== undefined)
        this.bindPattern(ctx, params[0], { k: "path", path: `$${as}` }, env, false);
      const scoped: Ctx = { ...ctx, env };
      const body = this.functionExpression(scoped, filter);
      const predicate = body === undefined ? undefined : this.predicate(scoped, body);
      if (predicate === undefined) return undefined;
      predicates.push(predicate);
    }
    if (predicates.length === 0) return undefined;
    return predicates.length === 1 ? predicates[0] : { and: predicates };
  }

  /** Lower `list.map(fn)` to a loop, keeping only the items the filters keep. */
  eachOver(
    ctx: Ctx,
    at: Node,
    list: IrValue,
    fn: Node,
    filters: readonly Node[] = [],
    options: { readonly chunk?: number; readonly name?: string } = {},
  ): IrEach | undefined {
    const params = children(fn, "params");
    if (params.length > 2) {
      this.error(
        ctx,
        fn,
        "dynamic-expression",
        "`.map` callbacks read the item and its index; a third parameter is the whole array.",
        "Remove the third parameter.",
      );
      return undefined;
    }
    const env = new Map(ctx.env);
    const loops = [...ctx.loops];
    let as = "";
    let index: string | undefined;
    const itemPattern = params[0];
    if (itemPattern !== undefined) {
      const raw =
        itemPattern.type === "Identifier" ? (text(itemPattern, "name") ?? "item") : "item";
      as = this.uniqueName({ ...ctx, loops }, options.name ?? raw);
      loops.push(as);
      this.bindPattern({ ...ctx, loops }, itemPattern, { k: "path", path: `$${as}` }, env, false);
    } else {
      as = this.uniqueName(ctx, options.name ?? "item");
      loops.push(as);
    }
    const indexPattern = params[1];
    if (indexPattern !== undefined) {
      if (indexPattern.type !== "Identifier") {
        this.error(ctx, indexPattern, "unsupported-pattern", "The index is a plain name.");
      } else {
        index = this.uniqueName({ ...ctx, loops }, text(indexPattern, "name") ?? "index");
        loops.push(index);
        env.set(text(indexPattern, "name") ?? "index", {
          k: "value",
          value: { bind: `$${index}` },
        });
      }
    }
    const where = filters.length === 0 ? undefined : this.whereClause(ctx, as, filters);
    if (filters.length > 0 && where === undefined) return undefined;
    const inner: Ctx = { ...ctx, env, loops, depth: ctx.depth + 1 };
    const body = this.functionExpression(inner, fn);
    if (body === undefined) return undefined;
    const nodes = this.content(inner, body);
    return {
      each: list,
      as,
      ...(index === undefined ? {} : { index }),
      ...(where === undefined ? {} : { where }),
      ...(options.chunk === undefined ? {} : { chunk: options.chunk }),
      children: nodes,
      src: this.src(ctx.module, at),
    };
  }

  // ── Elements ─────────────────────────────────────────────────────────────────

  /** Lower a JSX element or fragment to IR nodes. */
  element(ctx: Ctx, node: Node): IrNode[] {
    if (node.type === "JSXFragment")
      return this.jsxChildren({ ...ctx, depth: ctx.depth + 1 }, node);
    const opening = child(node, "openingElement");
    const nameNode = opening === undefined ? undefined : child(opening, "name");
    if (opening === undefined || nameNode === undefined) return [];
    const name = jsxName(nameNode);
    const inner: Ctx = { ...ctx, depth: ctx.depth + 1 };
    if (inner.depth > MAX_DEPTH) {
      this.error(ctx, node, "nesting-limit", "The template nests too deeply.", "Flatten it.");
      return [];
    }
    if (/^[a-z]/.test(name) && !name.includes("."))
      return this.intrinsic(inner, node, opening, name);
    return this.component(inner, node, opening, name);
  }

  private attributeName(attribute: Node): string {
    const name = child(attribute, "name");
    return name === undefined ? "" : jsxName(name);
  }

  private intrinsic(ctx: Ctx, node: Node, opening: Node, tag: string): IrNode[] {
    const spec = emailElement(tag);
    if (spec === undefined) {
      const near = didYouMean(tag, Object.keys(EMAIL_ELEMENTS));
      this.error(
        ctx,
        node,
        "unsupported-element",
        `<${tag}> is not part of the supported email vocabulary.`,
        near === undefined
          ? `Use one of: ${Object.keys(EMAIL_ELEMENTS).join(", ")}.`
          : `Did you mean <${near}>? Supported elements: ${Object.keys(EMAIL_ELEMENTS).join(", ")}.`,
      );
      return [];
    }
    const attrs: Record<string, IrValue> = {};
    let style: IrStyle | undefined;
    const origin = [this.findings.locate(ctx.module.parsed, node)];
    for (const attribute of children(opening, "attributes")) {
      if (attribute.type === "JSXSpreadAttribute") {
        this.dynamic(ctx, attribute, "A spread attribute", "Write each attribute.");
        continue;
      }
      const name = this.attributeName(attribute);
      const valueNode = child(attribute, "value");
      if (name === "key") continue;
      if (name === "ref" || name === "dangerouslySetInnerHTML" || /^on[A-Z]/.test(name)) {
        const isHtml = name === "dangerouslySetInnerHTML";
        this.error(
          ctx,
          attribute,
          isHtml ? "dangerous-html" : name === "ref" ? "unsupported-attribute" : "event-handler",
          isHtml
            ? "`dangerouslySetInnerHTML` injects unescaped markup."
            : name === "ref"
              ? "A `ref` needs a running component."
              : `\`${name}\` is an event handler; email clients strip scripting and Samva refuses it.`,
          isHtml ? "Write the markup as elements." : "Remove it.",
        );
        continue;
      }
      if (this.reservedAttributes.has(name)) {
        this.error(
          ctx,
          attribute,
          "reserved-attribute",
          `\`${name}\` is written only by BrandFooter from ${this.options.brandPlugin.specifier}.`,
          "Render <BrandFooter /> instead of marking an element as the footer.",
        );
        continue;
      }
      if (name === "className" || name === "class") {
        const value = valueNode === undefined ? "" : this.classValue(ctx, valueNode);
        if (value !== undefined && value !== "") attrs.class = value;
        continue;
      }
      if (name === "style") {
        style = this.styleAttribute(ctx, valueNode);
        continue;
      }
      let value: IrValue | undefined;
      if (valueNode === undefined) value = true;
      else if (valueNode.type === "StringLiteral")
        value = this.checkedText(ctx, valueNode, text(valueNode, "value") ?? "");
      else if (valueNode.type === "JSXExpressionContainer") {
        const expression = child(valueNode, "expression");
        value = expression === undefined ? undefined : this.value(ctx, expression, false);
      } else {
        this.error(
          ctx,
          valueNode,
          "dynamic-expression",
          "An attribute value is text, a number or a binding.",
        );
        continue;
      }
      if (value === undefined) continue;
      if (value === false || value === null) continue;
      if (value === this.options.brandPlugin.unsubscribeUrlPlaceholder) {
        this.error(
          ctx,
          attribute,
          "reserved-url",
          "That URL is the unsubscribe placeholder only BrandFooter can write.",
          "Render <BrandFooter /> instead.",
        );
        continue;
      }
      if (isStatic(value)) {
        const checked = checkAttribute(tag, name, value, origin);
        if (checked.text === undefined && checked.diagnostics.length === 0) {
          const near = didYouMean(
            name,
            Object.keys({ ...spec.attributes, id: 0, title: 0, lang: 0, dir: 0, role: 0 }),
          );
          this.error(
            ctx,
            attribute,
            "unsupported-attribute",
            `<${tag}> does not support the ${name} attribute.`,
            near === undefined
              ? `Supported: ${Object.keys(spec.attributes).join(", ") || "none"}, plus id, title, lang, dir, role, class, style, data-* and aria-*.`
              : `Did you mean \`${near}\`?`,
          );
          continue;
        }
        this.findings.items.push(...checked.diagnostics);
      }
      attrs[name] = value;
    }
    const kids = spec.content === "void" ? [] : this.jsxChildren(ctx, node);
    const element: IrElement = {
      el: tag,
      ...(Object.keys(attrs).length === 0 ? {} : { attrs }),
      ...(style === undefined ? {} : { style }),
      ...(kids.length === 0 ? {} : { children: kids }),
      src: this.src(ctx.module, node),
    };
    return [element];
  }

  /** A class value: literal classes, possibly chosen by a condition. Tailwind cannot see anything else. */
  private classValue(ctx: Ctx, valueNode: Node): IrValue | undefined {
    const node =
      valueNode.type === "JSXExpressionContainer" ? child(valueNode, "expression") : valueNode;
    if (node === undefined) return undefined;
    const value = this.classExpression(ctx, node);
    if (value === undefined) {
      this.error(
        ctx,
        valueNode,
        "dynamic-class",
        "This class is built at run time, and Tailwind cannot see class names it does not read.",
        'Write the classes literally, or choose between literal classes: `input.vip ? "bg-amber-100" : "bg-white"`.',
      );
    }
    return value;
  }

  private classExpression(ctx: Ctx, expression: Node): IrValue | undefined {
    const node = unwrap(expression);
    switch (node.type) {
      case "StringLiteral":
        return text(node, "value") ?? "";
      case "NullLiteral":
        return "";
      case "BooleanLiteral":
        return "";
      case "Identifier":
      case "MemberExpression": {
        if (node.type === "Identifier" && text(node, "name") === "undefined") return "";
        // A partial forwarding a class it was given: literal at the call site, so still visible.
        const bound = this.binding(ctx, node);
        return bound?.k === "value" && isClassValue(bound.value) ? bound.value : undefined;
      }
      case "TemplateLiteral": {
        const quasis = children(node, "quasis");
        const expressions = children(node, "expressions");
        const parts: IrValue[] = [];
        for (const [index, quasi] of quasis.entries()) {
          const chunk = templateChunk(quasi);
          if (chunk !== "") parts.push(chunk);
          const inner = expressions[index];
          if (inner !== undefined) {
            const value = this.classExpression(ctx, inner);
            if (value === undefined) return undefined;
            parts.push(value);
          }
        }
        return joinValues(parts);
      }
      case "ConditionalExpression": {
        const test = child(node, "test");
        const consequent = child(node, "consequent");
        const alternate = child(node, "alternate");
        if (test === undefined || consequent === undefined || alternate === undefined)
          return undefined;
        const predicate = this.predicate(ctx, test);
        const then = this.classExpression(ctx, consequent);
        const otherwise = this.classExpression(ctx, alternate);
        if (predicate === undefined || then === undefined || otherwise === undefined)
          return undefined;
        return { if: predicate, then, else: otherwise };
      }
      case "LogicalExpression": {
        const left = child(node, "left");
        const right = child(node, "right");
        if (text(node, "operator") !== "&&" || left === undefined || right === undefined)
          return undefined;
        const predicate = this.predicate(ctx, left);
        const then = this.classExpression(ctx, right);
        if (predicate === undefined || then === undefined) return undefined;
        return { if: predicate, then, else: "" };
      }
      case "BinaryExpression": {
        const left = child(node, "left");
        const right = child(node, "right");
        if (text(node, "operator") !== "+" || left === undefined || right === undefined)
          return undefined;
        const a = this.classExpression(ctx, left);
        const b = this.classExpression(ctx, right);
        return a === undefined || b === undefined ? undefined : joinValues([a, b]);
      }
      default:
        return undefined;
    }
  }

  private styleAttribute(ctx: Ctx, valueNode: Node | undefined): IrStyle | undefined {
    const expression = valueNode === undefined ? undefined : child(valueNode, "expression");
    const object = expression === undefined ? undefined : unwrap(expression);
    if (object === undefined || object.type !== "ObjectExpression") {
      if (valueNode !== undefined)
        this.error(
          ctx,
          valueNode,
          "invalid-style",
          "`style` is an object literal of CSS properties.",
          'Write style={{ backgroundColor: "#fff" }}, or use Tailwind classes.',
        );
      return undefined;
    }
    return this.styleObject(ctx, object);
  }

  /** A `style` object literal as declarations whose values may be read at render time. */
  styleObject(ctx: Ctx, object: Node): IrStyle | undefined {
    const entries: (readonly [string, IrValue])[] = [];
    for (const property of children(object, "properties")) {
      if (property.type !== "ObjectProperty" || property.computed === true) {
        this.dynamic(ctx, property, "A spread or computed style entry", "Write each property.");
        continue;
      }
      const key = child(property, "key");
      const value = child(property, "value");
      const name = keyName(key);
      if (name === undefined || value === undefined) continue;
      const lowered = this.value(ctx, value, false);
      if (lowered === undefined) continue;
      if (lowered === null) continue;
      entries.push([name, lowered]);
    }
    return entries;
  }

  // ── Components ───────────────────────────────────────────────────────────────

  private component(ctx: Ctx, node: Node, opening: Node, name: string): IrNode[] {
    const head = name.split(".")[0] ?? name;
    const imported = ctx.module.imports.get(head);
    const local = ctx.module.declarations.get(head);
    const attributes = children(opening, "attributes");
    if (imported?.kind === "markup" || imported?.kind === "brand") {
      return runBuiltinComponent({
        lowerer: this,
        ctx,
        node,
        attributes,
        name,
        binding: imported,
        brand: this.options.brand,
        brandPlugin: this.options.brandPlugin,
        channel: this.options.channel,
      });
    }
    let fn: { readonly module: ProjectModule; readonly value: Node } | undefined;
    if (imported?.kind === "project") {
      const target = this.options.project.modules.get(imported.path);
      if (target !== undefined) {
        fn = this.exportedFunction(target, imported.imported, new Set());
      }
    } else if (local !== undefined) {
      fn = { module: ctx.module, value: local.value };
    }
    if (fn === undefined || !/Function|Arrow/.test(fn.value.type)) {
      this.error(
        ctx,
        node,
        "unknown-component",
        `<${name}> is not a component the profile can read.`,
        "Import it from @samva/markup/email, or from a project file that exports it as a function.",
      );
      return [];
    }
    return this.partial(ctx, node, attributes, name, fn.module, fn.value);
  }

  private exportedFunction(
    module: ProjectModule,
    exported: string,
    seen: Set<string>,
  ): { readonly module: ProjectModule; readonly value: Node } | undefined {
    const key = `${module.path}\0${exported}`;
    if (seen.has(key)) return undefined;
    seen.add(key);
    if (exported === "default") {
      const value = module.defaultExport;
      if (value === undefined) return undefined;
      if (value.type === "Identifier") {
        const declared = module.declarations.get(text(value, "name") ?? "");
        return declared === undefined ? undefined : { module, value: declared.value };
      }
      return { module, value };
    }
    const local = module.exports.get(exported);
    if (local === undefined) return undefined;
    const declared = module.declarations.get(local);
    if (declared !== undefined) return { module, value: declared.value };
    const imported = module.imports.get(local);
    if (imported?.kind === "project") {
      const target = this.options.project.modules.get(imported.path);
      return target === undefined
        ? undefined
        : this.exportedFunction(target, imported.imported, seen);
    }
    return undefined;
  }

  /** Bindings for the attributes written on a component tag. */
  attributeBindings(ctx: Ctx, attributes: readonly Node[]): Map<string, Binding> | undefined {
    const props = new Map<string, Binding>();
    let ok = true;
    for (const attribute of attributes) {
      if (attribute.type === "JSXSpreadAttribute") {
        this.dynamic(ctx, attribute, "A spread attribute", "Write each prop.");
        ok = false;
        continue;
      }
      const name = this.attributeName(attribute);
      if (name === "key") continue;
      const valueNode = child(attribute, "value");
      if (valueNode === undefined) {
        props.set(name, { k: "value", value: true });
        continue;
      }
      if (valueNode.type === "StringLiteral") {
        props.set(name, {
          k: "value",
          value: this.checkedText(ctx, valueNode, text(valueNode, "value") ?? ""),
        });
        continue;
      }
      const expression =
        valueNode.type === "JSXExpressionContainer" ? child(valueNode, "expression") : undefined;
      if (expression === undefined) {
        this.error(
          ctx,
          valueNode,
          "dynamic-expression",
          "A prop value is text, a number, a binding or an object.",
        );
        ok = false;
        continue;
      }
      const bound = this.propBinding(ctx, expression);
      if (bound === undefined) ok = false;
      else props.set(name, bound);
    }
    return ok ? props : undefined;
  }

  private propBinding(ctx: Ctx, expression: Node): Binding | undefined {
    const node = unwrap(expression);
    if (node.type === "ObjectExpression") {
      const fields = new Map<string, Binding>();
      for (const property of children(node, "properties")) {
        if (property.type !== "ObjectProperty" || property.computed === true) {
          this.dynamic(ctx, property, "A spread or computed entry", "Write each field.");
          return undefined;
        }
        const key = child(property, "key");
        const value = child(property, "value");
        const name =
          key === undefined
            ? undefined
            : key.type === "Identifier"
              ? text(key, "name")
              : text(key, "value");
        if (name === undefined || value === undefined) return undefined;
        const bound = this.propBinding(ctx, value);
        if (bound === undefined) return undefined;
        fields.set(name, bound);
      }
      return { k: "object", fields };
    }
    if (node.type === "Identifier" || node.type === "MemberExpression")
      return this.binding(ctx, node);
    if (node.type === "JSXElement" || node.type === "JSXFragment") {
      return { k: "nodes", nodes: this.element(ctx, node) };
    }
    const value = this.value(ctx, node, false);
    return value === undefined ? undefined : { k: "value", value };
  }

  private partial(
    ctx: Ctx,
    node: Node,
    attributes: readonly Node[],
    name: string,
    module: ProjectModule,
    fn: Node,
  ): IrNode[] {
    const id = `${module.path}#${fn.start}`;
    if (ctx.stack.includes(id)) {
      this.error(
        ctx,
        node,
        "recursive-partial",
        `<${name}> renders itself, and the compiler inlines partials.`,
        "Flatten the recursion, or repeat the structure with `.map`.",
      );
      return [];
    }
    const props = this.attributeBindings(ctx, attributes);
    if (props === undefined) return [];
    const kids = this.jsxChildren(ctx, node);
    if (kids.length > 0) props.set("children", { k: "nodes", nodes: kids });
    const inner: Ctx = {
      module,
      env: new Map(),
      stack: [...ctx.stack, id],
      loops: ctx.loops,
      depth: ctx.depth + 1,
    };
    const env = new Map<string, Binding>();
    const param = children(fn, "params")[0];
    if (param !== undefined) {
      const bag: Binding = { k: "object", fields: props };
      if (param.type === "Identifier") env.set(text(param, "name") ?? "props", bag);
      else this.bindPattern(inner, param, bag, env, true);
    }
    const scoped: Ctx = { ...inner, env };
    const body = this.functionExpression(scoped, fn);
    return body === undefined ? [] : this.content(scoped, body);
  }
}

const jsxLike = (node: Node | undefined): string =>
  node === undefined ? "" : node.type === "Identifier" ? (text(node, "name") ?? "") : "…";

/** A value made only of literal class lists and choices between them. */
const isClassValue = (value: IrValue): boolean => {
  if (typeof value === "string") return true;
  if (typeof value !== "object" || value === null) return false;
  if ("if" in value) return isClassValue(value.then) && isClassValue(value.else);
  if ("concat" in value) return value.concat.every(isClassValue);
  return false;
};

/** The cooked text of one template-string segment. */
const templateChunk = (quasi: Node): string => {
  const value = quasi.value;
  if (typeof value !== "object" || value === null) return "";
  const cooked = (value as { cooked?: unknown; raw?: unknown }).cooked;
  const raw = (value as { raw?: unknown }).raw;
  return typeof cooked === "string" ? cooked : typeof raw === "string" ? raw : "";
};

/** Concatenate values, merging adjacent literals. A lone part stays itself. */
export const joinValues = (parts: readonly IrValue[]): IrValue => {
  const merged: IrValue[] = [];
  for (const part of parts) {
    const previous = merged[merged.length - 1];
    if (typeof part === "string" && typeof previous === "string")
      merged[merged.length - 1] = previous + part;
    else if (typeof part === "object" && part !== null && "concat" in part) {
      for (const inner of part.concat) {
        const last = merged[merged.length - 1];
        if (typeof inner === "string" && typeof last === "string")
          merged[merged.length - 1] = last + inner;
        else merged.push(inner);
      }
    } else merged.push(part);
  }
  if (merged.length === 0) return "";
  if (merged.length === 1) return merged[0]!;
  return { concat: merged };
};
