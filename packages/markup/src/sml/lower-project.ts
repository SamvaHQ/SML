// oxlint-disable samva/no-hand-rolled-object-guard -- IR nodes and Babel nodes are this package's own typed data, discriminated structurally; nothing here validates external input.
import type { DiagnosticCode } from "../diagnostic-codes";
import type { AssetEntry } from "../email/assets";
import type { EmailBrand } from "../email/brand";
import type { BrandPlugin } from "../email/brand-plugin";
import type { Stylesheet } from "../email/css";
import type { TemplateDiagnostic } from "../email/diagnostics";
import { samvaBrandPlugin } from "../email/samva-brand-plugin";
import { mergeStylesheets } from "../email/stylesheets";
import { inputSchema, jsonSchema } from "../input-schema";
import {
  SML_IR_VERSION,
  type IrElement,
  type IrNode,
  type IrRaw,
  type IrSource,
  type IrValue,
  type TemplateIr,
} from "../ir";
import { TEMPLATE_ID_PATTERN, TEMPLATE_NAME_PATTERN } from "../template";
import { child, children, text, unwrap, type Node } from "./ast";
import { isValueNode, type Binding } from "./bindings";
import { channelBodies, channelLowering } from "./channels";
import { checkBindings, checkStructure, type CheckFinding } from "./check";
import { Findings } from "./diagnostics";
import { Lowerer, type Ctx } from "./lower";
import type { Project, ProjectModule } from "./project";
import { applyStyles } from "./styles";
import { propertyKey, readStatic, type StaticContext } from "./values";

// The lowering half of the static compile: a loaded project in, IR and findings out. It needs
// no Tailwind and no brand, so it is what `checkStaticProfile` runs in the browser.

export interface CompiledTemplate {
  /** The IR, or `undefined` when a finding blocks it. */
  readonly ir: TemplateIr | undefined;
  /** The fixtures read from the entry, with imported assets resolved to their URLs. */
  readonly fixtures: Readonly<Record<string, unknown>>;
  readonly assets: readonly AssetEntry[];
  /** Errors block the IR; warnings ride along. */
  readonly diagnostics: readonly TemplateDiagnostic[];
}

const ENTRY_CALL = "defineTemplate";
const CHANNELS = ["email", "sms", "whatsapp"] as const;

interface Definition {
  readonly module: ProjectModule;
  readonly call: Node;
  readonly fields: ReadonlyMap<string, Node>;
}

const readDefinition = (project: Project, findings: Findings): Definition | undefined => {
  const module = project.entry;
  let expression = module.defaultExport;
  if (expression?.type === "Identifier") {
    const declared = module.declarations.get(text(expression, "name") ?? "");
    expression = declared?.value;
  }
  const fail = (message: string, fix: string, code: DiagnosticCode = "no-template") => {
    findings.add(module.parsed, expression ?? module.parsed.program, code, message, fix);
    return undefined;
  };
  if (expression === undefined || expression.type !== "CallExpression")
    return fail(
      "The entry must default-export defineTemplate({ ... }).",
      "Write `export default defineTemplate({ id, schema, fixtures, email })`.",
    );
  const callee = child(expression, "callee");
  const name = callee === undefined ? undefined : text(callee, "name");
  const imported = name === undefined ? undefined : module.imports.get(name);
  if (name === "defineEmail")
    return fail(
      "`defineEmail` runs a render function, which the static profile does not read.",
      "Use `defineTemplate` from @samva/markup with `email: { subject, preheader, body }`.",
      "legacy-definition",
    );
  if (imported?.kind !== "markup" || imported.imported !== ENTRY_CALL)
    return fail(
      "The entry must default-export defineTemplate({ ... }) imported from @samva/markup.",
      'Add `import { defineTemplate } from "@samva/markup";`.',
    );
  const argument = children(expression, "arguments")[0];
  const object = argument === undefined ? undefined : unwrap(argument);
  if (object === undefined || object.type !== "ObjectExpression")
    return fail(
      "defineTemplate takes one object literal.",
      "Write defineTemplate({ id, schema, fixtures, email }).",
    );
  const fields = new Map<string, Node>();
  for (const property of children(object, "properties")) {
    const key = propertyKey(property);
    const value = child(property, "value");
    if (key === undefined || value === undefined) {
      findings.add(
        module.parsed,
        property,
        "dynamic-definition",
        "A definition field is written out, not spread or computed.",
        "Write each field as `name: value`.",
      );
      continue;
    }
    fields.set(key, value);
  }
  return { module, call: expression, fields };
};

/** A function written in place, or named and declared in the project. */
const resolveFunction = (
  project: Project,
  module: ProjectModule,
  node: Node,
): { readonly module: ProjectModule; readonly fn: Node } | undefined => {
  const value = unwrap(node);
  if (/Function/.test(value.type)) return { module, fn: value };
  if (value.type === "Identifier") {
    const name = text(value, "name") ?? "";
    const declared = module.declarations.get(name);
    if (declared !== undefined) return resolveFunction(project, module, declared.value);
    const imported = module.imports.get(name);
    if (imported?.kind === "project") {
      const target = project.modules.get(imported.path);
      if (target === undefined) return undefined;
      const local =
        imported.imported === "default" ? undefined : target.exports.get(imported.imported);
      if (imported.imported === "default" && target.defaultExport !== undefined)
        return resolveFunction(project, target, target.defaultExport);
      const declaration = local === undefined ? undefined : target.declarations.get(local);
      return declaration === undefined
        ? undefined
        : resolveFunction(project, target, declaration.value);
    }
  }
  return undefined;
};

const stylesheetOrder = (project: Project): readonly string[] => {
  const order: string[] = [];
  const visited = new Set<string>();
  const visit = (module: ProjectModule): void => {
    if (visited.has(module.path)) return;
    visited.add(module.path);
    for (const item of module.ordered) {
      if (item.kind === "css") {
        if (!order.includes(item.path)) order.push(item.path);
      } else {
        const target = project.modules.get(item.path);
        if (target !== undefined) visit(target);
      }
    }
  };
  visit(project.entry);
  return order;
};

/** Rebuild a tree with `edit` applied to the first element it matches. */
const editFirst = (
  nodes: readonly IrNode[],
  matches: (element: IrElement) => boolean,
  edit: (element: IrElement) => IrElement,
): { readonly nodes: IrNode[]; readonly done: boolean } => {
  let done = false;
  const walk = (list: readonly IrNode[]): IrNode[] =>
    list.map((node): IrNode => {
      if (done || isValueNode(node)) return node;
      if ("el" in node) {
        if (matches(node)) {
          done = true;
          return edit(node);
        }
        return {
          ...node,
          ...(node.children === undefined ? {} : { children: walk(node.children) }),
        };
      }
      if ("if" in node) {
        const then = walk(node.then);
        const otherwise = walk(node.else ?? []);
        return { ...node, then, ...(node.else === undefined ? {} : { else: otherwise }) };
      }
      if ("each" in node) return { ...node, children: walk(node.children) };
      return node;
    });
  const result = walk(nodes);
  return { nodes: result, done };
};

const HEAD_COMMENT_OPEN: IrRaw = { raw: ["<!--[if !mso]><!-->"] };
const HEAD_COMMENT_CLOSE: IrRaw = { raw: ["<!--<![endif]-->"] };

/** What the compile needs from the project transform: the assets and the stylesheets it built. */
export interface ResolvedInputs {
  readonly assets: readonly AssetEntry[];
  readonly stylesheets: ReadonlyMap<string, Stylesheet>;
  readonly tailwindSheet: Stylesheet | undefined;
  readonly urlFor: (path: string) => string | undefined;
}

export interface LowerOptions {
  readonly entry: string;
  readonly schema?: Readonly<Record<string, unknown>> | undefined;
  readonly brand?: EmailBrand | undefined;
  /** Names the brand import and marks the footer `BrandFooter` renders; `samvaBrandPlugin` when omitted. */
  readonly brandPlugin?: BrandPlugin | undefined;
}

export const completed = (
  findings: Findings,
  ir: TemplateIr | undefined,
  fixtures: Readonly<Record<string, unknown>> = {},
  assets: readonly AssetEntry[] = [],
): CompiledTemplate => ({
  ir: findings.blocking ? undefined : ir,
  fixtures,
  assets,
  diagnostics: findings.items,
});

/**
 * Lower a loaded project to IR: the part of the compile that reads structure and needs no Tailwind
 * or brand. `checkStaticProfile` runs it with empty stylesheets.
 */
export const lowerProject = (
  options: LowerOptions,
  project: Project,
  findings: Findings,
  inputs: ResolvedInputs,
): CompiledTemplate => {
  const done = (
    ir: TemplateIr | undefined,
    fixtures: Readonly<Record<string, unknown>> = {},
    assets: readonly AssetEntry[] = inputs.assets,
  ): CompiledTemplate => completed(findings, ir, fixtures, assets);
  const urlFor = inputs.urlFor;
  const staticContext: StaticContext = { project, assetUrl: urlFor };

  const definition = readDefinition(project, findings);
  if (definition === undefined) return done(undefined);
  const { module, fields } = definition;
  const at = (name: string): Node => fields.get(name) ?? definition.call;

  // ── Identity, schema, fixtures ─────────────────────────────────────────────
  const id = fields.has("id") ? readStatic(staticContext, module, fields.get("id")!) : undefined;
  if (id === undefined || !id.ok || typeof id.value !== "string")
    findings.add(
      module.parsed,
      at("id"),
      "invalid-template-id",
      "The template id is a string literal.",
      'Write id: "order-shipped".',
    );
  else if (!TEMPLATE_ID_PATTERN.test(id.value))
    findings.add(
      module.parsed,
      at("id"),
      "invalid-template-id",
      `Template id ${JSON.stringify(id.value)} is not lowercase kebab-case.`,
      'Write lowercase letters and digits joined by single hyphens, for example "order-shipped".',
    );
  const templateId = id !== undefined && id.ok && typeof id.value === "string" ? id.value : "";

  let schemaJson: Record<string, unknown> | undefined;
  const schemaNode = fields.get("schema");
  if (schemaNode === undefined)
    findings.add(
      module.parsed,
      definition.call,
      "missing-schema",
      "The template declares no schema.",
      "Add `schema: jsonSchema<Input>({ ... })`.",
    );
  else {
    const read = readStatic(staticContext, module, schemaNode);
    if (read.ok && typeof read.value === "object" && read.value !== null)
      schemaJson = read.value as Record<string, unknown>;
    else if (options.schema !== undefined) schemaJson = { ...options.schema };
    else
      findings.add(
        read.ok ? module.parsed : read.module.parsed,
        read.ok ? schemaNode : read.node,
        "schema-not-static",
        `The schema cannot be read without running it${read.ok ? "" : ` (${read.reason})`}.`,
        'Write the schema as a literal: `jsonSchema<Input>({ type: "object", properties: { … } })`, or compile with the schema a library already converted.',
      );
  }
  let validate: ((value: unknown) => boolean) & {
    errors?: readonly { instanceLocation?: string; error?: string }[];
  } = () => true;
  if (schemaJson !== undefined) {
    // oxlint-disable-next-line samva/no-try-catch-or-throw -- The portable-schema converter throws TypeError for a schema outside the profile.
    try {
      const converted = inputSchema(jsonSchema<unknown>(schemaJson));
      validate = converted.validate;
      schemaJson = converted.schema;
    } catch (error) {
      if (!(error instanceof TypeError)) throw error; // oxlint-disable-line samva/no-try-catch-or-throw -- Not a statement about the schema.
      findings.add(
        module.parsed,
        at("schema"),
        "invalid-schema",
        error.message,
        "Use only the JSON Schema keywords the README lists.",
      );
      schemaJson = undefined;
    }
  }

  const fixtures: Record<string, unknown> = {};
  const fixtureNode = fields.get("fixtures");
  if (fixtureNode === undefined)
    findings.add(
      module.parsed,
      definition.call,
      "missing-fixtures",
      "The template declares no fixtures.",
      "Add `fixtures: { default: { … } }`.",
    );
  else {
    const read = readStatic(staticContext, module, fixtureNode);
    if (!read.ok)
      findings.add(
        read.module.parsed,
        read.node,
        "fixtures-not-static",
        `Fixtures are data, and this one is computed (${read.reason}).`,
        "Write each fixture as a literal object; an imported asset is allowed.",
      );
    else if (
      typeof read.value !== "object" ||
      read.value === null ||
      Object.keys(read.value).length === 0
    )
      findings.add(
        module.parsed,
        fixtureNode,
        "missing-fixtures",
        "The template declares no fixtures.",
        "Declare at least one: `fixtures: { default: { … } }`.",
      );
    else {
      const object = unwrap(fixtureNode);
      const locations = new Map<string, Node>();
      if (object.type === "ObjectExpression")
        for (const property of children(object, "properties")) {
          const key = propertyKey(property);
          if (key !== undefined) locations.set(key, child(property, "key") ?? property);
        }
      for (const [name, value] of Object.entries(read.value)) {
        if (!TEMPLATE_NAME_PATTERN.test(name)) {
          findings.add(
            module.parsed,
            locations.get(name) ?? fixtureNode,
            "invalid-fixture-name",
            `Fixture key ${JSON.stringify(name)} is not one path segment.`,
            "Use letters, digits, `.`, `_` and `-`, starting with a letter or digit.",
          );
          continue;
        }
        fixtures[name] = value;
        if (schemaJson !== undefined && !validate(value)) {
          const first = validate.errors?.at(-1) ?? validate.errors?.[0];
          findings.add(
            module.parsed,
            locations.get(name) ?? fixtureNode,
            "fixture-invalid",
            `Fixture ${JSON.stringify(name)} does not match the schema${first === undefined ? "" : `: ${first.instanceLocation === "#" || first.instanceLocation === undefined ? "" : `${first.instanceLocation.replace(/^#/, "")} `}${first.error ?? "is invalid"}`}.`,
            "Change the fixture, or the schema, so a fixture is a payload a send could make.",
          );
        }
      }
    }
  }
  const localeRead = fields.has("locale")
    ? readStatic(staticContext, module, fields.get("locale")!)
    : undefined;
  const locale =
    localeRead?.ok === true && typeof localeRead.value === "string" ? localeRead.value : undefined;
  if (fields.has("locale") && locale === undefined)
    findings.add(
      module.parsed,
      at("locale"),
      "invalid-locale",
      "The locale is a string literal.",
      'Write locale: "en-US".',
    );

  // ── Bodies ─────────────────────────────────────────────────────────────────
  const staticPart = {
    project,
    findings,
    staticContext,
    assetUrl: urlFor,
    brand: options.brand,
    brandPlugin: options.brandPlugin ?? samvaBrandPlugin,
  };
  const lowerer = new Lowerer({ ...staticPart, channel: channelLowering });
  const rootContext = (target: ProjectModule): Ctx => ({
    module: target,
    env: new Map(),
    stack: [],
    loops: [],
    depth: 0,
  });
  /** Bind the function's parameter to the input and return the single expression it returns. */
  const openFunction = (node: Node): { readonly ctx: Ctx; readonly body: Node } | undefined => {
    const resolved = resolveFunction(project, module, node);
    if (resolved === undefined) {
      findings.add(
        module.parsed,
        node,
        "not-a-function",
        "A channel field is a function of the input, written in place or declared in the project.",
        "Write `(input) => …`.",
      );
      return undefined;
    }
    const ctx = rootContext(resolved.module);
    const env = new Map<string, Binding>();
    const parameter = children(resolved.fn, "params")[0];
    if (parameter !== undefined)
      lowerer.bindPattern(ctx, parameter, { k: "path", path: "" }, env, false);
    const scoped: Ctx = { ...ctx, env };
    const body = lowerer.functionExpression(scoped, resolved.fn);
    return body === undefined ? undefined : { ctx: scoped, body };
  };

  for (const name of fields.keys())
    if (!["id", "schema", "fixtures", "locale", ...CHANNELS].includes(name))
      findings.add(
        module.parsed,
        at(name),
        "unknown-field",
        `\`${name}\` is not a defineTemplate field.`,
        "The fields are id, schema, fixtures, locale, email, sms and whatsapp.",
      );

  let ir: TemplateIr | undefined;
  const checks: CheckFinding[] = [];
  const emailField = fields.get("email");
  let emailIr: TemplateIr["email"];
  if (emailField !== undefined) {
    const object = unwrap(emailField);
    const parts = new Map<string, Node>();
    if (object.type === "ObjectExpression")
      for (const property of children(object, "properties")) {
        const key = propertyKey(property);
        const value = child(property, "value");
        if (key !== undefined && value !== undefined) parts.set(key, value);
      }
    else
      findings.add(
        module.parsed,
        emailField,
        "invalid-channel",
        "The email channel is an object: `{ subject, preheader, body }`.",
        "Write email: { subject: …, body: … }.",
      );
    for (const key of parts.keys())
      if (!["subject", "preheader", "body"].includes(key))
        findings.add(
          module.parsed,
          parts.get(key)!,
          "unknown-field",
          `\`${key}\` is not an email field.`,
          "The fields are subject, preheader and body.",
        );
    const value = (name: string): IrValue | undefined => {
      const node = parts.get(name);
      if (node === undefined) return undefined;
      const opened = openFunction(node);
      return opened === undefined ? undefined : lowerer.value(opened.ctx, opened.body, false);
    };
    const subject = parts.has("subject") ? value("subject") : undefined;
    if (!parts.has("subject") && object.type === "ObjectExpression")
      findings.add(
        module.parsed,
        emailField,
        "missing-subject",
        "The email channel needs a subject.",
        "Add `subject: (input) => …`.",
      );
    const preheader = value("preheader");
    let body: IrNode | undefined;
    const bodyNode = parts.get("body");
    if (bodyNode === undefined && object.type === "ObjectExpression")
      findings.add(
        module.parsed,
        emailField,
        "missing-body",
        "The email channel needs a body.",
        "Add `body: (input) => (<Email>…</Email>)`.",
      );
    else if (bodyNode !== undefined) {
      const opened = openFunction(bodyNode);
      if (opened !== undefined) {
        const nodes = lowerer.content(opened.ctx, opened.body);
        if (nodes.length === 1) body = nodes[0];
        else if (!findings.blocking)
          findings.add(
            opened.ctx.module.parsed,
            opened.body,
            "multiple-roots",
            nodes.length === 0
              ? "The email body renders nothing."
              : "The email body renders more than one root.",
            "Wrap the body in a single element such as <Email>.",
          );
      }
    }
    if (subject !== undefined && body !== undefined) {
      // Styles: Tailwind first, then the project's stylesheets in import order.
      const sheets: Stylesheet[] = [];
      if (inputs.tailwindSheet !== undefined) sheets.push(inputs.tailwindSheet);
      for (const path of stylesheetOrder(project)) {
        const sheet = inputs.stylesheets.get(path);
        if (sheet !== undefined) sheets.push(sheet);
      }
      const sources = [options.entry, ...lowerer.sources];
      const locate = (source: IrSource | undefined) => {
        if (source === undefined) return undefined;
        return {
          fileName: sources[source[2] ?? 0] ?? options.entry,
          lineNumber: source[0],
          columnNumber: source[1],
        };
      };
      const styled = applyStyles(body, mergeStylesheets(sheets), {
        locate,
        report: (diagnostic) => {
          findings.items.push(diagnostic);
        },
      });
      let root: IrNode = styled.root;
      if (styled.headCss !== "" || styled.fontFaceCss !== "") {
        const additions: IrNode[] = [
          ...(styled.headCss === ""
            ? []
            : [{ el: "style", children: [styled.headCss] } satisfies IrElement]),
          ...(styled.fontFaceCss === ""
            ? []
            : [
                HEAD_COMMENT_OPEN,
                { el: "style", children: [styled.fontFaceCss] } satisfies IrElement,
                HEAD_COMMENT_CLOSE,
              ]),
        ];
        const edited = editFirst(
          [root],
          (element) => element.el === "head",
          (head) => ({
            ...head,
            children: [...(head.children ?? []), ...additions],
          }),
        );
        if (!edited.done)
          findings.items.push({
            code: "missing-head",
            severity: "error",
            message:
              "Styles that cannot be inlined — media queries, dark-scheme rules and pseudo-selectors — need a <head> to live in.",
            fix: "Wrap the message in <Email>, or write those declarations as inline styles.",
            origins: [],
          });
        else root = edited.nodes[0] ?? root;
      }
      if (preheader !== undefined) {
        const edited = editFirst(
          [root],
          (element) => element.el === "body",
          (bodyElement) => ({
            ...bodyElement,
            children: [{ preheader: true as const }, ...(bodyElement.children ?? [])],
          }),
        );
        if (!edited.done)
          findings.add(
            module.parsed,
            at("email"),
            "preheader-without-shell",
            "A preheader is the hidden inbox preview inside <body>, and this body has no <Email> shell.",
            "Wrap the body in <Email>.",
          );
        else root = edited.nodes[0] ?? root;
      }
      checkStructure([root], (finding) => checks.push(finding));
      if (schemaJson !== undefined)
        checks.push(
          ...checkBindings(
            schemaJson,
            [root],
            [subject, ...(preheader === undefined ? [] : [preheader])],
          ),
        );
      emailIr = { subject, ...(preheader === undefined ? {} : { preheader }), body: root };
    }
  }
  const channelIr = channelBodies({
    lowerer,
    findings,
    fields,
    module,
    openFunction,
    checks,
    schema: schemaJson,
  });

  const sources = [options.entry, ...lowerer.sources];
  for (const finding of checks) {
    const source = finding.src;
    const file = sources[source?.[2] ?? 0] ?? options.entry;
    findings.items.push({
      code: finding.code,
      severity: "error",
      message: finding.message,
      ...(finding.fix === undefined ? {} : { fix: finding.fix }),
      origins:
        source === undefined
          ? [{ fileName: options.entry, lineNumber: 1, columnNumber: 1 }]
          : [{ fileName: file, lineNumber: source[0], columnNumber: source[1] }],
    });
  }

  if (
    schemaJson !== undefined &&
    templateId !== "" &&
    (emailIr !== undefined || channelIr.sms !== undefined || channelIr.whatsapp !== undefined)
  ) {
    ir = {
      sml: SML_IR_VERSION,
      template: templateId,
      ...(locale === undefined ? {} : { locale }),
      sources,
      ...(emailIr === undefined ? {} : { email: emailIr }),
      ...(channelIr.sms === undefined ? {} : { sms: channelIr.sms }),
      ...(channelIr.whatsapp === undefined ? {} : { whatsapp: channelIr.whatsapp }),
      schema: schemaJson,
    };
  } else if (emailField === undefined && !fields.has("sms") && !fields.has("whatsapp")) {
    findings.add(
      module.parsed,
      definition.call,
      "no-channel",
      "The template declares no channel.",
      "Add `email`, `sms` or `whatsapp`.",
    );
  }
  return done(ir, fixtures);
};
