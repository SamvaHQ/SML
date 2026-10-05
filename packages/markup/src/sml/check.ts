// oxlint-disable samva/no-hand-rolled-object-guard -- IR nodes and Babel nodes are this package's own typed data, discriminated structurally; nothing here validates external input.
import type { DiagnosticCode } from "../diagnostic-codes";
import { emailElement } from "../email/elements";
import type { IrElement, IrNode, IrPredicate, IrSource, IrStyle, IrValue } from "../ir";
import { isValueNode } from "./bindings";
import { didYouMean } from "./suggest";

// The binding checker reads every binding in the IR against the template's portable JSON Schema,
// so a misspelled field, an optional field read without a guard and a value of the wrong type
// fail at compile time with the field named, not in a recipient's inbox.

type Schema = Readonly<Record<string, unknown>>;

export interface CheckFinding {
  readonly code: DiagnosticCode;
  readonly message: string;
  readonly fix?: string;
  readonly src: IrSource | undefined;
}

type ValueType = "string" | "number" | "boolean" | "array" | "object" | "unknown";

const isSchema = (value: unknown): value is Schema =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Follow local `$ref`s to the schema they name. */
const resolve = (root: Schema, schema: Schema, depth = 0): Schema => {
  const ref = schema.$ref;
  if (typeof ref !== "string" || depth > 16) return schema;
  if (ref === "#") return root;
  let current: unknown = root;
  for (const segment of ref.replace(/^#\//, "").split("/")) {
    if (!isSchema(current)) return schema;
    current = current[segment.replace(/~1/g, "/").replace(/~0/g, "~")];
  }
  return isSchema(current) ? resolve(root, current, depth + 1) : schema;
};

const branches = (root: Schema, schema: Schema): readonly Schema[] => {
  const resolved = resolve(root, schema);
  const alternatives = [resolved.anyOf, resolved.oneOf, resolved.allOf].flatMap((list) =>
    Array.isArray(list) ? list.filter(isSchema).flatMap((item) => branches(root, item)) : [],
  );
  return [resolved, ...alternatives];
};

const typeOf = (root: Schema, schema: Schema | undefined): ValueType => {
  if (schema === undefined) return "unknown";
  const types = new Set<string>();
  for (const branch of branches(root, schema)) {
    const declared = branch.type;
    if (typeof declared === "string") types.add(declared);
    else if (Array.isArray(declared))
      for (const item of declared) if (typeof item === "string") types.add(item);
    if (branch.const !== undefined) types.add(typeof branch.const);
    if (Array.isArray(branch.enum)) for (const item of branch.enum) types.add(typeof item);
  }
  types.delete("null");
  if (types.size !== 1) return "unknown";
  const [only] = types;
  switch (only) {
    case "string":
      return "string";
    case "number":
    case "integer":
      return "number";
    case "boolean":
      return "boolean";
    case "array":
      return "array";
    case "object":
      return "object";
    default:
      return "unknown";
  }
};

interface Step {
  readonly found: boolean;
  readonly schema: Schema | undefined;
  readonly required: boolean;
  readonly names: readonly string[];
  /** The schema constrains nothing here, so no claim can be made about the field. */
  readonly open: boolean;
}

const step = (root: Schema, schema: Schema, segment: string): Step => {
  const names: string[] = [];
  let open = true;
  let found: { schema: Schema | undefined; required: boolean } | undefined;
  for (const branch of branches(root, schema)) {
    if (isSchema(branch.properties)) {
      open = false;
      names.push(...Object.keys(branch.properties));
      if (Object.hasOwn(branch.properties, segment)) {
        const property = branch.properties[segment];
        const required = Array.isArray(branch.required) && branch.required.includes(segment);
        found = {
          schema: isSchema(property) ? property : undefined,
          required: found?.required === true || required,
        };
      }
    }
    if (
      branch.type === "object" &&
      !isSchema(branch.properties) &&
      branch.additionalProperties === false
    )
      open = false;
    if (Array.isArray(branch.items) || isSchema(branch.items)) {
      if (/^\d+$/.test(segment)) {
        open = false;
        return {
          found: true,
          schema: isSchema(branch.items) ? branch.items : undefined,
          required: true,
          names,
          open: false,
        };
      }
    }
    if (isSchema(branch.additionalProperties) && found === undefined) {
      found = { schema: branch.additionalProperties, required: false };
      open = false;
    }
  }
  if (found !== undefined)
    return { found: true, schema: found.schema, required: found.required, names, open: false };
  return { found: false, schema: undefined, required: false, names, open };
};

interface Scope {
  readonly variables: ReadonlyMap<string, Schema | undefined>;
  readonly guards: ReadonlySet<string>;
}

const withGuards = (scope: Scope, extra: ReadonlySet<string>): Scope =>
  extra.size === 0 ? scope : { ...scope, guards: new Set([...scope.guards, ...extra]) };

const prefixes = (path: string): string[] => {
  const segments = path.split(".");
  return segments.map((_, index) => segments.slice(0, index + 1).join("."));
};

const bindPath = (value: IrValue): string | undefined =>
  typeof value === "object" && value !== null && "bind" in value ? value.bind : undefined;

const guardsOf = (predicate: IrPredicate, positive: boolean): ReadonlySet<string> => {
  const own = (path: string | undefined): ReadonlySet<string> =>
    path === undefined ? new Set() : new Set(prefixes(path));
  if ("present" in predicate) return positive ? own(predicate.present) : new Set();
  if ("truthy" in predicate) {
    const value = predicate.truthy;
    const path =
      bindPath(value) ??
      (typeof value === "object" && value !== null && "length" in value
        ? bindPath(value.length)
        : undefined);
    return positive ? own(path) : new Set();
  }
  if ("not" in predicate) return guardsOf(predicate.not, !positive);
  if ("and" in predicate || "or" in predicate) {
    const list = "and" in predicate ? predicate.and : predicate.or;
    const union = "and" in predicate ? positive : !positive;
    const sets = list.map((item) => guardsOf(item, positive));
    if (union) return new Set(sets.flatMap((set) => [...set]));
    const [first, ...rest] = sets;
    return new Set([...(first ?? [])].filter((path) => rest.every((set) => set.has(path))));
  }
  const [left, right] = predicate.args;
  const path = bindPath(left) ?? bindPath(right);
  const other = bindPath(left) === undefined ? left : right;
  if (path === undefined) return new Set();
  const isNull = other === null;
  // Two fields can both be absent and equal, so only a comparison against a literal, or a value that is always there (text, a formatted value, a number), proves anything.
  const literal =
    other === null ||
    typeof other !== "object" ||
    "concat" in other ||
    "format" in other ||
    "op" in other ||
    "length" in other ||
    "count" in other;
  // `x === null` and `x !== literal` are true of an absent field; their opposites prove presence.
  if (predicate.cmp === "eq") return !literal || positive === isNull ? new Set() : own(path);
  if (predicate.cmp === "ne") return !literal || positive !== isNull ? new Set() : own(path);
  return positive ? own(path) : new Set();
};

/** Check every binding in a lowered email or channel body against the input schema. */
export const checkBindings = (
  schema: Schema,
  roots: readonly IrNode[],
  values: readonly IrValue[],
): readonly CheckFinding[] => {
  const findings: CheckFinding[] = [];
  const reported = new Set<string>();
  const report = (finding: CheckFinding): void => {
    const key = `${finding.code}\0${finding.message}\0${finding.src?.join(",") ?? ""}`;
    if (reported.has(key)) return;
    reported.add(key);
    findings.push(finding);
  };

  const display = (path: string): string =>
    path.startsWith("$") ? path.slice(1) : `input.${path}`;

  /** Resolve a bound path, reporting unknown and unguarded fields. Returns its schema when known. */
  const walk = (path: string, scope: Scope, src: IrSource | undefined): Schema | undefined => {
    const segments = path.split(".");
    const head = segments[0]!;
    let current: Schema | undefined;
    if (head.startsWith("$")) {
      if (!scope.variables.has(head.slice(1))) return undefined;
      current = scope.variables.get(head.slice(1));
    } else {
      const first = step(schema, schema, head);
      if (!first.found) return unknownField(head, first, "", src, path);
      if (!first.required && !scope.guards.has(head)) unguarded(head, src);
      current = first.schema;
    }
    for (let index = 1; index < segments.length; index++) {
      if (current === undefined) return undefined;
      const segment = segments[index]!;
      const next = step(schema, current, segment);
      const prefix = segments.slice(0, index).join(".");
      if (!next.found) {
        if (next.open) return undefined;
        return unknownField(segment, next, prefix, src, path);
      }
      const here = segments.slice(0, index + 1).join(".");
      if (!next.required && !scope.guards.has(here)) unguarded(here, src);
      current = next.schema;
    }
    return current;
  };

  const unknownField = (
    segment: string,
    stepResult: Step,
    prefix: string,
    src: IrSource | undefined,
    full: string,
  ): undefined => {
    if (stepResult.open) return undefined;
    const near = didYouMean(segment, stepResult.names);
    const owner = prefix === "" ? "input" : display(prefix);
    report({
      code: "unknown-field",
      message: `\`${prefix === "" ? "input" : display(prefix)}.${segment}\` is not in the schema${stepResult.names.length === 0 ? "" : ` (${owner} has ${stepResult.names.map((name) => `\`${name}\``).join(", ")})`}.`,
      ...(near === undefined
        ? { fix: `Add \`${segment}\` to the schema, or bind a field it declares.` }
        : { fix: `Did you mean \`${prefix === "" ? "input" : display(prefix)}.${near}\`?` }),
      src,
    });
    void full;
    return undefined;
  };

  const unguarded = (path: string, src: IrSource | undefined): void => {
    report({
      code: "unguarded-optional",
      message: `\`${display(path)}\` is optional and is read outside a guard, so a send without it would render a blank.`,
      fix: `Guard it: {${display(path)} && …}, or make the field required in the schema.`,
      src,
    });
  };

  const valueType = (value: IrValue, scope: Scope, src: IrSource | undefined): ValueType => {
    if (typeof value === "string") return "string";
    if (typeof value === "number") return "number";
    if (typeof value === "boolean") return "boolean";
    if (value === null) return "unknown";
    if ("bind" in value) return typeOf(schema, walk(value.bind, scope, src));
    if ("lit" in value) return "unknown";
    if ("concat" in value) {
      for (const part of value.concat) valueType(part, scope, src);
      return "string";
    }
    if ("format" in value) {
      checkFormat(value.format, value.args, scope, src);
      return "string";
    }
    if ("if" in value) {
      visitPredicate(value.if, scope, src);
      const then = valueType(value.then, withGuards(scope, guardsOf(value.if, true)), src);
      valueType(value.else, withGuards(scope, guardsOf(value.if, false)), src);
      return then;
    }
    if ("op" in value) {
      for (const operand of value.args) requireType(operand, "number", scope, src, "arithmetic");
      return "number";
    }
    if ("length" in value) {
      valueType(value.length, scope, src);
      return "number";
    }
    if ("count" in value) {
      const path = bindPath(value.count);
      let item: Schema | undefined;
      if (path === undefined) valueType(value.count, scope, src);
      else {
        const list = walk(path, scope, src);
        if (list !== undefined)
          for (const branch of branches(schema, list))
            if (isSchema(branch.items)) item = resolve(schema, branch.items);
      }
      const variables = new Map(scope.variables).set(value.as.replace(/^\$/, ""), item);
      visitPredicate(value.where, { ...scope, variables }, src);
      return "number";
    }
    return "unknown";
  };

  const requireType = (
    value: IrValue,
    expected: ValueType,
    scope: Scope,
    src: IrSource | undefined,
    where: string,
  ): void => {
    const actual = valueType(value, scope, src);
    if (actual === "unknown" || actual === expected) return;
    const path = bindPath(value);
    report({
      code: "invalid-binding-type",
      message: `${path === undefined ? "This value" : `\`${display(path)}\``} is ${actual === "array" ? "an array" : `a ${actual}`}, and ${where} needs ${expected === "array" ? "an array" : `a ${expected}`}.`,
      fix:
        expected === "number"
          ? "Bind a number field, or send the number in the payload."
          : `Bind a ${expected} field.`,
      src,
    });
  };

  const checkFormat = (
    name: string,
    args: readonly IrValue[],
    scope: Scope,
    src: IrSource | undefined,
  ): void => {
    const expected: Record<string, readonly (ValueType | undefined)[]> = {
      money: ["number", "string", "string"],
      number: ["number", undefined, "string"],
      date: ["string", "string", "string"],
      time: ["string", "string", "string"],
      plural: ["number", undefined, "string"],
      list: ["array", "string"],
    };
    for (const [index, argument] of args.entries()) {
      const type = expected[name]?.[index];
      if (type === undefined) valueType(argument, scope, src);
      else requireType(argument, type, scope, src, `\`fmt.${name}\``);
    }
  };

  const visitPredicate = (
    predicate: IrPredicate,
    scope: Scope,
    src: IrSource | undefined,
  ): void => {
    if ("present" in predicate) {
      // A guard reads the field, so it is exempt from the guard requirement itself.
      walkGuard(predicate.present, scope, src);
      return;
    }
    if ("truthy" in predicate) {
      const value = predicate.truthy;
      const path = bindPath(value);
      if (path !== undefined) walkGuard(path, scope, src);
      else valueTypeGuard(value, scope, src);
      return;
    }
    if ("not" in predicate) {
      visitPredicate(predicate.not, scope, src);
      return;
    }
    if ("and" in predicate) {
      let running = scope;
      for (const part of predicate.and) {
        visitPredicate(part, running, src);
        running = withGuards(running, guardsOf(part, true));
      }
      return;
    }
    if ("or" in predicate) {
      let running = scope;
      for (const part of predicate.or) {
        visitPredicate(part, running, src);
        running = withGuards(running, guardsOf(part, false));
      }
      return;
    }
    const numeric =
      predicate.cmp === "lt" ||
      predicate.cmp === "gt" ||
      predicate.cmp === "le" ||
      predicate.cmp === "ge";
    // Ordering compares two numbers or two strings, as the renderer does.
    const strings =
      numeric && predicate.args.every((operand) => valueType(operand, scope, src) === "string");
    for (const operand of predicate.args) {
      const path = bindPath(operand);
      if (strings) continue;
      if (path !== undefined && !numeric) walkGuard(path, scope, src);
      else if (numeric) requireType(operand, "number", scope, src, "a comparison");
      else valueTypeGuard(operand, scope, src);
    }
  };

  /** Reading a field to test it is what a guard is; only the field itself must exist. */
  const walkGuard = (path: string, scope: Scope, src: IrSource | undefined): void => {
    walk(path, { ...scope, guards: new Set([...scope.guards, ...prefixes(path)]) }, src);
  };

  const valueTypeGuard = (value: IrValue, scope: Scope, src: IrSource | undefined): void => {
    if (typeof value === "object" && value !== null && "length" in value) {
      const path = bindPath(value.length);
      if (path !== undefined) {
        walkGuard(path, scope, src);
        return;
      }
    }
    valueType(value, scope, src);
  };

  const scalar = (value: IrValue, scope: Scope, src: IrSource | undefined, where: string): void => {
    const type = valueType(value, scope, src);
    if (type === "array" || type === "object") {
      const path = bindPath(value);
      report({
        code: "invalid-binding-type",
        message: `${path === undefined ? "This value" : `\`${display(path)}\``} is ${type === "array" ? "an array" : "an object"}, and ${where} takes a string or a number.`,
        fix:
          type === "array"
            ? "Render the items with .map, or bind one of their fields."
            : "Bind one of its fields.",
        src,
      });
    }
  };

  const visitStyle = (
    style: IrStyle | undefined,
    scope: Scope,
    src: IrSource | undefined,
  ): void => {
    if (style === undefined || typeof style === "string") return;
    if (Array.isArray(style)) {
      for (const [, value] of style as readonly (readonly [string, IrValue])[])
        scalar(value, scope, src, "a style value");
      return;
    }
    const conditional = style as { if: IrPredicate; then: IrStyle; else: IrStyle };
    visitPredicate(conditional.if, scope, src);
    visitStyle(conditional.then, withGuards(scope, guardsOf(conditional.if, true)), src);
    visitStyle(conditional.else, withGuards(scope, guardsOf(conditional.if, false)), src);
  };

  const visit = (nodes: readonly IrNode[], scope: Scope, parent?: IrSource): void => {
    for (const node of nodes) {
      if (isValueNode(node)) {
        scalar(node, scope, parent, "text");
        continue;
      }
      if ("el" in node) {
        for (const value of Object.values(node.attrs ?? {}))
          scalar(value, scope, node.src, "an attribute");
        visitStyle(node.style, scope, node.src);
        visit(node.children ?? [], scope, node.src);
      } else if ("if" in node) {
        visitPredicate(node.if, scope, node.src);
        visit(node.then, withGuards(scope, guardsOf(node.if, true)), node.src ?? parent);
        visit(node.else ?? [], withGuards(scope, guardsOf(node.if, false)), node.src ?? parent);
      } else if ("each" in node) {
        const path = bindPath(node.each);
        let listSchema: Schema | undefined;
        if (path !== undefined) {
          listSchema = walk(path, scope, node.src);
          const type = typeOf(schema, listSchema);
          if (type !== "array" && type !== "unknown")
            report({
              code: "invalid-binding-type",
              message: `\`${display(path)}\` is ${type === "object" ? "an object" : `a ${type}`}, and a loop needs an array.`,
              fix: "Loop over an array field.",
              src: node.src,
            });
        } else valueType(node.each, scope, node.src);
        let item: Schema | undefined;
        if (listSchema !== undefined)
          for (const branch of branches(schema, listSchema)) {
            if (isSchema(branch.items)) item = resolve(schema, branch.items);
          }
        const itemName = node.as.replace(/^\$/, "");
        if (node.where !== undefined)
          visitPredicate(
            node.where,
            { ...scope, variables: new Map(scope.variables).set(itemName, item) },
            node.src ?? parent,
          );
        const variables = new Map(scope.variables);
        // A chunked loop binds each slice: an array of the items.
        variables.set(
          itemName,
          node.chunk === undefined || item === undefined ? item : { type: "array", items: item },
        );
        if (node.index !== undefined)
          variables.set(node.index.replace(/^\$/, ""), { type: "integer" });
        const kept =
          node.where === undefined ? scope : withGuards(scope, guardsOf(node.where, true));
        visit(node.children, { ...kept, variables }, node.src ?? parent);
      } else if ("raw" in node) {
        for (const part of node.raw)
          if (typeof part !== "string")
            scalar("attr" in part ? part.attr : part.text, scope, node.src, "markup");
      }
    }
  };

  const base: Scope = { variables: new Map(), guards: new Set() };
  visit(roots, base);
  for (const value of values) scalar(value, base, undefined, "the subject or preheader");
  return findings;
};

/** The element content rules the serializer enforces, checked before any send. */
export const checkStructure = (
  roots: readonly IrNode[],
  report: (finding: CheckFinding) => void,
): void => {
  const flat = (nodes: readonly IrNode[]): readonly IrNode[] =>
    nodes.flatMap((node) => {
      if (isValueNode(node)) return [node];
      if ("if" in node) return [...flat(node.then), ...flat(node.else ?? [])];
      if ("each" in node) return flat(node.children);
      return [node];
    });
  const visit = (nodes: readonly IrNode[]): void => {
    for (const node of nodes) {
      if (isValueNode(node)) continue;
      if ("el" in node) checkElement(node);
      else if ("if" in node) {
        visit(node.then);
        visit(node.else ?? []);
      } else if ("each" in node) visit(node.children);
    }
  };
  const checkElement = (element: IrElement): void => {
    const spec = emailElement(element.el);
    const kids = flat(element.children ?? []);
    if (spec === undefined) return;
    if (spec.content === "void" && kids.length > 0)
      report({
        code: "void-element-children",
        message: `<${element.el}> cannot have children.`,
        src: element.src,
      });
    else if (spec.content === "text" || spec.content === "raw") {
      for (const kid of kids)
        if (!isValueNode(kid) && !("raw" in kid))
          report({
            code: "invalid-content",
            message: `<${element.el}> accepts text only.`,
            src: element.src,
          });
    } else if (spec.childElements !== undefined) {
      for (const kid of kids) {
        if (isValueNode(kid)) {
          if (typeof kid === "string" && kid.trim() === "") continue;
          report({
            code: "invalid-content",
            message: `<${element.el}> cannot contain text directly; put it inside <${spec.childElements[0]}>.`,
            src: element.src,
          });
        } else if ("el" in kid && !spec.childElements.includes(kid.el))
          report({
            code: "invalid-content",
            message: `<${element.el}> accepts only ${spec.childElements.map((name) => `<${name}>`).join(", ")}; found <${kid.el}>.`,
            src: kid.src ?? element.src,
          });
      }
    }
    visit(element.children ?? []);
  };
  visit(roots);
};
