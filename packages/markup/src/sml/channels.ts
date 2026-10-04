import {
  SMS_ATTRIBUTES,
  SMS_CATEGORIES,
  WHATSAPP_ATTRIBUTES,
  WHATSAPP_CATEGORIES,
  WHATSAPP_HEADER_TYPES,
} from "../channel-specs";
// oxlint-disable samva/no-hand-rolled-object-guard -- IR nodes and Babel nodes are this package's own typed data, discriminated structurally; nothing here validates external input.
import type {
  IrNode,
  IrPredicate,
  IrSms,
  IrValue,
  IrWhatsApp,
  IrWhatsAppButton,
  IrWhatsAppButtonNode,
} from "../ir";
import { whatsappTemplate } from "../whatsapp-template";
import { child, children, text, unwrap, type Node } from "./ast";
import { bindingValue, isValueNode } from "./bindings";
import { checkBindings, type CheckFinding } from "./check";
import type { ChannelLowering } from "./components";
import type { Findings } from "./diagnostics";
import { joinValues, type Ctx, type Lowerer } from "./lower";
import type { ProjectModule } from "./project";

/**
 * The SMS and WhatsApp roots are read by `channelBodies` from the channel field, never lowered
 * as content, so a channel component met anywhere else is in the wrong channel.
 */
export const channelLowering: ChannelLowering = () => undefined;

export interface ChannelInput {
  readonly lowerer: Lowerer;
  readonly findings: Findings;
  readonly fields: ReadonlyMap<string, Node>;
  readonly module: ProjectModule;
  readonly openFunction: (node: Node) => { readonly ctx: Ctx; readonly body: Node } | undefined;
  readonly checks: CheckFinding[];
  readonly schema: Readonly<Record<string, unknown>> | undefined;
}

// Meta's published limits for a template.
const HEADER_LIMIT = 60;
const FOOTER_LIMIT = 60;
const BODY_LIMIT = 1024;
const BUTTON_TEXT_LIMIT = 25;
const URL_BUTTON_LIMIT = 2;
const PHONE_BUTTON_LIMIT = 1;
const QUICK_REPLY_LIMIT = 10;
const BUTTON_LIMIT = 10;

const jsxName = (name: Node): string => {
  if (name.type === "JSXIdentifier") return text(name, "name") ?? "";
  if (name.type === "JSXMemberExpression")
    return `${jsxName(child(name, "object") ?? name)}.${text(child(name, "property") ?? name, "name") ?? ""}`;
  return "";
};

const tagOf = (element: Node): string => {
  const opening = child(element, "openingElement");
  const name = opening === undefined ? undefined : child(opening, "name");
  return name === undefined ? "" : jsxName(name);
};

const attributesOf = (element: Node): readonly Node[] => {
  const opening = child(element, "openingElement");
  return opening === undefined ? [] : children(opening, "attributes");
};

interface Root {
  readonly ctx: Ctx;
  readonly node: Node;
  /** The name the root is imported under; parts are `${local}.Header` and so on. */
  readonly local: string;
}

/** The root element of a channel body, when it is the channel's own component. */
const readRoot = (
  input: ChannelInput,
  field: Node,
  imported: "Sms" | "WhatsApp",
  specifier: string,
): Root | undefined => {
  const opened = input.openFunction(field);
  if (opened === undefined) return undefined;
  const { ctx, body } = opened;
  const node = unwrap(body);
  const tag = node.type === "JSXElement" ? tagOf(node) : "";
  const binding = ctx.module.imports.get(tag);
  if (
    node.type !== "JSXElement" ||
    binding?.kind !== "markup" ||
    binding.specifier !== specifier ||
    binding.imported !== imported
  ) {
    input.lowerer.error(
      ctx,
      node,
      "wrong-channel",
      `The ${imported === "Sms" ? "sms" : "whatsapp"} channel returns one <${imported}> element imported from ${specifier}.`,
      `Write \`import { ${imported} } from "${specifier}"\` and return <${imported}>…</${imported}>.`,
    );
    return undefined;
  }
  return { ctx, node, local: tag };
};

/** The string-literal attributes of a channel root; anything else is reported. */
const readAttributes = (
  input: ChannelInput,
  root: Root,
  allowed: readonly string[],
): Map<string, string> => {
  const values = new Map<string, string>();
  for (const attribute of attributesOf(root.node)) {
    if (attribute.type === "JSXSpreadAttribute") {
      input.lowerer.error(
        root.ctx,
        attribute,
        "dynamic-expression",
        "A spread attribute runs code, and templates render without running code.",
        "Write each attribute as a string literal.",
      );
      continue;
    }
    const nameNode = child(attribute, "name");
    const name = nameNode === undefined ? "" : jsxName(nameNode);
    if (name === "key") continue;
    if (!allowed.includes(name)) {
      input.lowerer.error(
        root.ctx,
        attribute,
        "unknown-attribute",
        `\`${name}\` is not an attribute of this component.`,
        `The attributes are ${allowed.join(", ")}.`,
      );
      continue;
    }
    const value = child(attribute, "value");
    const literal = value?.type === "JSXExpressionContainer" ? child(value, "expression") : value;
    if (literal?.type !== "StringLiteral") {
      input.lowerer.error(
        root.ctx,
        attribute,
        "dynamic-expression",
        `\`${name}\` is fixed when the template is compiled, so it is a string literal.`,
        `Write ${name}="…".`,
      );
      continue;
    }
    values.set(name, text(literal, "value") ?? "");
  }
  return values;
};

const oneOf = (
  input: ChannelInput,
  root: Root,
  node: Node,
  name: string,
  value: string,
  allowed: readonly string[],
): boolean => {
  if (allowed.includes(value)) return true;
  input.lowerer.error(
    root.ctx,
    node,
    "invalid-attribute",
    `\`${value}\` is not a ${name} this channel accepts.`,
    `Use one of ${allowed.join(", ")}.`,
  );
  return false;
};

const valueOnly = (nodes: readonly IrNode[]): nodes is readonly IrValue[] =>
  nodes.every((node) => isValueNode(node));

// ── SMS ──────────────────────────────────────────────────────────────────────

const containsElement = (nodes: readonly IrNode[]): boolean =>
  nodes.some((node) => {
    if (isValueNode(node)) return false;
    if ("el" in node || "raw" in node) return true;
    if ("if" in node) return containsElement(node.then) || containsElement(node.else ?? []);
    if ("each" in node) return containsElement(node.children);
    return false;
  });

const smsChannel = (input: ChannelInput, field: Node): IrSms | undefined => {
  const root = readRoot(input, field, "Sms", "@samva/markup/sms");
  if (root === undefined) return undefined;
  const attributes = readAttributes(input, root, SMS_ATTRIBUTES);
  const categoryNode = attributesOf(root.node).find(
    (attribute) => text(child(attribute, "name") ?? attribute, "name") === "category",
  );
  const category = attributes.get("category");
  if (
    category !== undefined &&
    categoryNode !== undefined &&
    !oneOf(input, root, categoryNode, "category", category, SMS_CATEGORIES)
  )
    return undefined;
  const body = input.lowerer.jsxChildren(root.ctx, root.node);
  if (containsElement(body))
    input.lowerer.error(
      root.ctx,
      root.node,
      "sms-markup",
      "An SMS body is plain text, and this one contains an element.",
      "Write the message as text and bindings; use a newline in the text for a line break.",
    );
  if (input.schema !== undefined) input.checks.push(...checkBindings(input.schema, body, []));
  return { ...(category === undefined ? {} : { category }), body };
};

// ── WhatsApp ─────────────────────────────────────────────────────────────────

const staticLength = (value: IrValue): number => {
  if (typeof value === "string") return value.length;
  if (typeof value === "number") return String(value).length;
  if (typeof value === "object" && value !== null && "concat" in value)
    return value.concat.reduce((total: number, part) => total + staticLength(part), 0);
  return 0;
};

interface ButtonCounts {
  readonly url: number;
  readonly phone: number;
  readonly quickReply: number;
  readonly total: number;
}

const ZERO: ButtonCounts = { url: 0, phone: 0, quickReply: 0, total: 0 };

/** The most buttons of each kind any combination of the conditions can produce. */
const maximalCounts = (nodes: readonly IrWhatsAppButtonNode[]): ButtonCounts => {
  let counts = ZERO;
  for (const node of nodes) {
    let add: ButtonCounts;
    if ("if" in node) {
      const then = maximalCounts(node.then);
      const otherwise = maximalCounts(node.else ?? []);
      add = {
        url: Math.max(then.url, otherwise.url),
        phone: Math.max(then.phone, otherwise.phone),
        quickReply: Math.max(then.quickReply, otherwise.quickReply),
        total: Math.max(then.total, otherwise.total),
      };
    } else
      add = {
        url: node.type === "url" ? 1 : 0,
        phone: node.type === "phone" ? 1 : 0,
        quickReply: node.type === "quick-reply" ? 1 : 0,
        total: 1,
      };
    counts = {
      url: counts.url + add.url,
      phone: counts.phone + add.phone,
      quickReply: counts.quickReply + add.quickReply,
      total: counts.total + add.total,
    };
  }
  return counts;
};

const buttonNodes = (buttons: readonly IrWhatsAppButtonNode[]): IrNode[] =>
  buttons.flatMap((button): IrNode[] => {
    if ("if" in button)
      return [
        {
          if: button.if,
          then: buttonNodes(button.then),
          ...(button.else === undefined ? {} : { else: buttonNodes(button.else) }),
          ...(button.src === undefined ? {} : { src: button.src }),
        },
      ];
    switch (button.type) {
      case "quick-reply":
        return [button.text];
      case "url":
        return [button.text, button.url];
      case "phone":
        return [button.text, button.phone];
      case "copy-code":
        return [button.code];
    }
  });

const whatsappChannel = (input: ChannelInput, field: Node): IrWhatsApp | undefined => {
  const root = readRoot(input, field, "WhatsApp", "@samva/markup/whatsapp");
  if (root === undefined) return undefined;
  const { lowerer } = input;
  const { ctx } = root;
  const attributes = readAttributes(input, root, WHATSAPP_ATTRIBUTES);
  for (const required of ["category", "language"])
    if (!attributes.has(required))
      lowerer.error(
        ctx,
        root.node,
        "missing-attribute",
        `<WhatsApp> needs \`${required}\`.`,
        required === "category"
          ? `Write category="utility" (${WHATSAPP_CATEGORIES.join(", ")}).`
          : 'Write language="en_US".',
      );
  const category = attributes.get("category");
  const categoryNode = attributesOf(root.node).find(
    (attribute) => text(child(attribute, "name") ?? attribute, "name") === "category",
  );
  if (
    category !== undefined &&
    categoryNode !== undefined &&
    !oneOf(input, root, categoryNode, "category", category, WHATSAPP_CATEGORIES)
  )
    return undefined;

  const parts = new Map<string, Node>();
  for (const item of children(root.node, "children")) {
    if (item.type === "JSXText") {
      if ((text(item, "value") ?? "").trim() !== "")
        lowerer.error(
          ctx,
          item,
          "whatsapp-structure",
          "Text sits inside Header, Body, Footer or Buttons, not directly in <WhatsApp>.",
          "Move it into <WhatsApp.Body>.",
        );
      continue;
    }
    const tag = item.type === "JSXElement" ? tagOf(item) : "";
    const part = tag.startsWith(`${root.local}.`) ? tag.slice(root.local.length + 1) : "";
    if (!["Header", "Body", "Footer", "Buttons"].includes(part)) {
      lowerer.error(
        ctx,
        item,
        "whatsapp-structure",
        "<WhatsApp> holds <WhatsApp.Header>, <WhatsApp.Body>, <WhatsApp.Footer> and <WhatsApp.Buttons>.",
        "Wrap the content in one of them.",
      );
      continue;
    }
    if (parts.has(part)) {
      lowerer.error(
        ctx,
        item,
        "whatsapp-structure",
        `<WhatsApp.${part}> appears twice.`,
        "A WhatsApp template has at most one of each part.",
      );
      continue;
    }
    parts.set(part, item);
  }

  const roots: IrNode[] = [];
  const lengthWarning = (part: string, node: Node, length: number, limit: number): void => {
    if (length > limit)
      lowerer.findings.add(
        ctx.module.parsed,
        node,
        "whatsapp-length",
        `The ${part} is at least ${length} characters, and Meta allows ${limit}.`,
        `Shorten the ${part}.`,
        "warning",
      );
  };
  /** A text part: literal text and values, no branching. */
  const textPart = (name: string, node: Node, limit: number): readonly IrNode[] | undefined => {
    const nodes = lowerer.jsxChildren(ctx, node);
    if (!valueOnly(nodes)) {
      lowerer.error(
        ctx,
        node,
        "whatsapp-conditional",
        `A WhatsApp ${name} cannot branch or contain elements: Meta registers its text once.`,
        "Choose the wording as a parameter in the payload, or write separate templates.",
      );
      return undefined;
    }
    lengthWarning(
      name,
      node,
      nodes.reduce(
        (total: number, part) => total + (isValueNode(part) ? staticLength(part) : 0),
        0,
      ),
      limit,
    );
    roots.push(...nodes);
    return nodes;
  };

  let header: IrWhatsApp["header"];
  const headerNode = parts.get("Header");
  if (headerNode !== undefined) {
    const typeAttribute = attributesOf(headerNode).find(
      (attribute) => text(child(attribute, "name") ?? attribute, "name") === "type",
    );
    const literal = typeAttribute === undefined ? undefined : child(typeAttribute, "value");
    const raw = literal?.type === "JSXExpressionContainer" ? child(literal, "expression") : literal;
    const typeValue = raw?.type === "StringLiteral" ? (text(raw, "value") ?? "text") : "text";
    if (typeAttribute !== undefined && raw?.type !== "StringLiteral")
      lowerer.error(
        ctx,
        typeAttribute,
        "dynamic-expression",
        "`type` is fixed when the template is compiled, so it is a string literal.",
        'Write type="image".',
      );
    else if (
      typeAttribute !== undefined &&
      !WHATSAPP_HEADER_TYPES.includes(typeValue as "text" | "image" | "video" | "document")
    )
      lowerer.error(
        ctx,
        typeAttribute,
        "invalid-attribute",
        `\`${typeValue}\` is not a header type.`,
        `Use one of ${WHATSAPP_HEADER_TYPES.join(", ")}.`,
      );
    else {
      const type = typeValue as NonNullable<IrWhatsApp["header"]>["type"];
      const content = textPart("header", headerNode, type === "text" ? HEADER_LIMIT : Infinity);
      if (content !== undefined) {
        if (type === "text") {
          if (whatsappTemplate(content).params.length > 1)
            lowerer.error(
              ctx,
              headerNode,
              "whatsapp-header-variables",
              "A WhatsApp header text takes at most one variable.",
              "Keep one binding in the header and move the rest to the body.",
            );
        } else if (content.length !== 1)
          lowerer.error(
            ctx,
            headerNode,
            "whatsapp-header-media",
            `A ${type} header is one URL.`,
            "Write the media URL as the only child: a literal or one binding.",
          );
        header = { type, content };
      }
    }
  }

  let body: readonly IrNode[] = [];
  const bodyNode = parts.get("Body");
  if (bodyNode === undefined)
    lowerer.error(
      ctx,
      root.node,
      "whatsapp-body-required",
      "A WhatsApp template needs a body.",
      "Add <WhatsApp.Body>…</WhatsApp.Body>.",
    );
  else {
    const lowered = textPart("body", bodyNode, BODY_LIMIT);
    body = lowered ?? [];
    if (lowered !== undefined && lowered.length === 0)
      lowerer.error(
        ctx,
        bodyNode,
        "whatsapp-body-required",
        "The WhatsApp body is empty.",
        "Write the message text.",
      );
  }

  const footerNode = parts.get("Footer");
  const footer =
    footerNode === undefined ? undefined : textPart("footer", footerNode, FOOTER_LIMIT);

  const buttonPart = parts.get("Buttons");
  const buttons =
    buttonPart === undefined ? undefined : buttonList(input, ctx, root.local, buttonPart);
  if (buttons !== undefined) {
    const counts = maximalCounts(buttons);
    const over = (kind: string, count: number, limit: number): void => {
      if (count > limit)
        lowerer.error(
          ctx,
          buttonPart!,
          "whatsapp-button-limit",
          `A WhatsApp template allows ${limit} ${kind}, and these conditions can produce ${count}.`,
          `Remove ${count - limit}, or split the template.`,
        );
    };
    over("URL buttons", counts.url, URL_BUTTON_LIMIT);
    over("phone buttons", counts.phone, PHONE_BUTTON_LIMIT);
    over("quick-reply buttons", counts.quickReply, QUICK_REPLY_LIMIT);
    over("buttons in all", counts.total, BUTTON_LIMIT);
    roots.push(...buttonNodes(buttons));
  }

  if (input.schema !== undefined) input.checks.push(...checkBindings(input.schema, roots, []));
  if (category === undefined || !attributes.has("language")) return undefined;
  const name = attributes.get("name");
  return {
    ...(name === undefined ? {} : { name }),
    category,
    language: attributes.get("language")!,
    ...(header === undefined ? {} : { header }),
    body,
    ...(footer === undefined ? {} : { footer }),
    ...(buttons === undefined ? {} : { buttons }),
  };
};

const BUTTON_TAGS = ["UrlButton", "QuickReplyButton", "PhoneButton", "CopyCodeButton"] as const;

const buttonList = (
  input: ChannelInput,
  ctx: Ctx,
  local: string,
  parent: Node,
): readonly IrWhatsAppButtonNode[] => {
  const { lowerer } = input;
  const label = (element: Node, what: string): IrValue | undefined => {
    const nodes = lowerer.jsxChildren(ctx, element);
    if (!valueOnly(nodes) || nodes.length === 0) {
      lowerer.error(
        ctx,
        element,
        nodes.length === 0 ? "whatsapp-button-text" : "whatsapp-conditional",
        nodes.length === 0
          ? `A button needs its ${what}.`
          : `A button ${what} cannot branch or contain elements.`,
        `Write the ${what} as text between the tags.`,
      );
      return undefined;
    }
    const value = joinValues(nodes);
    if (what === "label" && staticLength(value) > BUTTON_TEXT_LIMIT)
      lowerer.findings.add(
        ctx.module.parsed,
        element,
        "whatsapp-length",
        `The button label is at least ${staticLength(value)} characters, and Meta allows ${BUTTON_TEXT_LIMIT}.`,
        "Shorten the label.",
        "warning",
      );
    return value;
  };
  const attribute = (element: Node, name: string | undefined): IrValue | undefined => {
    const bindings = lowerer.attributeBindings(ctx, attributesOf(element));
    if (bindings === undefined) return undefined;
    const known = attributesOf(element).map((item) => text(child(item, "name") ?? item, "name"));
    for (const item of known)
      if (item !== undefined && item !== name && item !== "key")
        lowerer.error(
          ctx,
          element,
          "unknown-attribute",
          `\`${item}\` is not an attribute of this button.`,
          name === undefined ? "Remove it." : `The attribute is ${name}.`,
        );
    if (name === undefined) return undefined;
    const bound = bindings.get(name);
    const value = bound === undefined ? undefined : bindingValue(bound);
    if (value === undefined)
      lowerer.error(
        ctx,
        element,
        "missing-attribute",
        `This button needs \`${name}\`.`,
        `Write ${name}="…" or ${name}={input.field}.`,
      );
    return value;
  };
  const single = (element: Node): IrWhatsAppButton | undefined => {
    const tag = tagOf(element);
    const kind = tag.startsWith(`${local}.`) ? tag.slice(local.length + 1) : "";
    switch (kind) {
      case "UrlButton": {
        const url = attribute(element, "url");
        const label_ = label(element, "label");
        return url === undefined || label_ === undefined
          ? undefined
          : { type: "url", text: label_, url };
      }
      case "PhoneButton": {
        const phone = attribute(element, "phone");
        const label_ = label(element, "label");
        return phone === undefined || label_ === undefined
          ? undefined
          : { type: "phone", text: label_, phone };
      }
      case "QuickReplyButton": {
        attribute(element, undefined);
        const label_ = label(element, "label");
        return label_ === undefined ? undefined : { type: "quick-reply", text: label_ };
      }
      case "CopyCodeButton": {
        const code = label(element, "code");
        return code === undefined ? undefined : { type: "copy-code", code };
      }
      default:
        lowerer.error(
          ctx,
          element,
          "whatsapp-structure",
          `<WhatsApp.Buttons> holds ${BUTTON_TAGS.map((name) => `<WhatsApp.${name}>`).join(", ")}.`,
          "Use one of the button components.",
        );
        return undefined;
    }
  };
  const expression = (node: Node): IrWhatsAppButtonNode[] => {
    const inner = unwrap(node);
    switch (inner.type) {
      case "JSXElement": {
        const button = single(inner);
        return button === undefined ? [] : [button];
      }
      case "JSXFragment":
        return fragment(inner);
      case "NullLiteral":
      case "BooleanLiteral":
        return [];
      case "LogicalExpression": {
        const left = child(inner, "left");
        const right = child(inner, "right");
        if (text(inner, "operator") === "&&" && left !== undefined && right !== undefined) {
          const test = lowerer.predicate(ctx, left);
          const then = expression(right);
          return test === undefined
            ? []
            : [{ if: test, then, src: lowerer.src(ctx.module, inner) }];
        }
        break;
      }
      case "ConditionalExpression": {
        const test = child(inner, "test");
        const consequent = child(inner, "consequent");
        const alternate = child(inner, "alternate");
        if (test === undefined || consequent === undefined || alternate === undefined) return [];
        const predicate: IrPredicate | undefined = lowerer.predicate(ctx, test);
        const then = expression(consequent);
        const otherwise = expression(alternate);
        return predicate === undefined
          ? []
          : [
              {
                if: predicate,
                then,
                ...(otherwise.length === 0 ? {} : { else: otherwise }),
                src: lowerer.src(ctx.module, inner),
              },
            ];
      }
      default:
        break;
    }
    lowerer.error(
      ctx,
      inner,
      "dynamic-expression",
      "Buttons are fixed by the template, and this expression builds them at render time.",
      "List each button; wrap one in `condition && <WhatsApp.UrlButton … />` to make it optional.",
    );
    return [];
  };
  const fragment = (node: Node): IrWhatsAppButtonNode[] => {
    const output: IrWhatsAppButtonNode[] = [];
    for (const item of children(node, "children")) {
      if (item.type === "JSXText") {
        if ((text(item, "value") ?? "").trim() !== "")
          lowerer.error(
            ctx,
            item,
            "whatsapp-structure",
            "Text cannot sit between buttons.",
            "Put the label inside the button.",
          );
      } else if (item.type === "JSXExpressionContainer") {
        const inner = child(item, "expression");
        if (inner !== undefined && inner.type !== "JSXEmptyExpression")
          output.push(...expression(inner));
      } else output.push(...expression(item));
    }
    return output;
  };
  return fragment(parent);
};

export const channelBodies = (
  input: ChannelInput,
): { readonly sms?: IrSms; readonly whatsapp?: IrWhatsApp } => {
  const smsField = input.fields.get("sms");
  const whatsappField = input.fields.get("whatsapp");
  const sms = smsField === undefined ? undefined : smsChannel(input, smsField);
  const whatsapp = whatsappField === undefined ? undefined : whatsappChannel(input, whatsappField);
  return {
    ...(sms === undefined ? {} : { sms }),
    ...(whatsapp === undefined ? {} : { whatsapp }),
  };
};
