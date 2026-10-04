import type { EmittedPosition } from "../preview";
/* oxlint-disable eslint/no-control-regex -- Header validation intentionally rejects control characters. */
import type { JsxSourceLocation } from "../source-locations";
import type { EmailContent } from "../template";
import { applyStylesheet } from "./cascade";
import { preheaderNode } from "./components";
import type { Stylesheet } from "./css";
import { EmailCompileError, hasBlockingDiagnostic, type EmailDiagnostic } from "./diagnostics";
import { serializeEmailHtml, type SerializeEmailOptions } from "./html";
import { drainEmailDiagnostics, EmailNode } from "./jsx-runtime";
import { deriveEmailText } from "./text";

/** Classic Outlook lays a document out correctly only under a transitional doctype. */
export const EMAIL_DOCTYPE =
  '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">';

export interface EmailCompileOutput {
  readonly html: string;
  readonly text: string;
  /** Findings that did not block the compile; blocking findings throw. */
  readonly diagnostics: readonly EmailDiagnostic[];
  /**
   * Each emitted element's offset range and origins. Compatibility checks run
   * in the host over the emitted document, and this is what lets a finding name
   * the authoring element rather than a character offset.
   */
  readonly positions: readonly EmittedPosition[];
}

// oxlint-disable samva/no-try-catch-or-throw -- Synchronous compilation rejects unsafe authored output before submission.
const settle = (diagnostics: readonly EmailDiagnostic[]): readonly EmailDiagnostic[] => {
  if (hasBlockingDiagnostic(diagnostics)) throw new EmailCompileError({ diagnostics });
  return diagnostics;
};

/** Lower the derived tree to HTML and its plain-text alternative. */
export const compileEmail = (
  node: EmailNode,
  options: SerializeEmailOptions = {},
): EmailCompileOutput => {
  const serialized = serializeEmailHtml(node, options);
  const diagnostics = settle([...drainEmailDiagnostics(), ...serialized.diagnostics]);
  return {
    html: serialized.html,
    text: deriveEmailText(node),
    diagnostics,
    positions: serialized.positions,
  };
};

/** Put the hidden preview block first inside `<body>`, or first overall when there is no shell. */
const withPreheader = (node: EmailNode, text: string): EmailNode => {
  const insert = (current: EmailNode): EmailNode | undefined => {
    if (current.type === "Fragment") {
      for (const [index, child] of current.children.entries()) {
        const replaced = insert(child);
        if (replaced !== undefined)
          return EmailNode.Fragment({ children: current.children.with(index, replaced) });
      }
      return undefined;
    }
    if (current.type !== "Element") return undefined;
    if (current.tag === "body")
      return EmailNode.Element({
        ...current,
        children: [preheaderNode(text), ...current.children],
      });
    for (const [index, child] of current.children.entries()) {
      const replaced = insert(child);
      if (replaced !== undefined)
        return EmailNode.Element({ ...current, children: current.children.with(index, replaced) });
    }
    return undefined;
  };
  return insert(node) ?? EmailNode.Fragment({ children: [preheaderNode(text), node] });
};

const headStyle = (css: string, origins: readonly JsxSourceLocation[]): EmailNode =>
  EmailNode.Element({
    tag: "style",
    props: {},
    children: [EmailNode.Text({ value: css })],
    origins,
    authored: false,
  });

/**
 * Put the retained rules in a `<style>` at the end of `<head>`, and project
 * `@font-face` rules in a sibling classic Outlook cannot see. Outlook for
 * Windows registers a face it cannot load and then renders the family in Times
 * New Roman, ignoring the stack; hidden, the family is merely missing and the
 * stack's fallback applies.
 */
const withHeadCss = (node: EmailNode, css: string, fontFaceCss: string): EmailNode | undefined => {
  const insert = (current: EmailNode): EmailNode | undefined => {
    if (current.type === "Fragment") {
      for (const [index, child] of current.children.entries()) {
        const replaced = insert(child);
        if (replaced !== undefined)
          return EmailNode.Fragment({ children: current.children.with(index, replaced) });
      }
      return undefined;
    }
    if (current.type !== "Element") return undefined;
    if (current.tag === "head")
      return EmailNode.Element({
        ...current,
        children: [
          ...current.children,
          ...(css === "" ? [] : [headStyle(css, current.origins)]),
          ...(fontFaceCss === ""
            ? []
            : [
                EmailNode.Raw({ html: "<!--[if !mso]><!-->", text: "", origins: [] }),
                headStyle(fontFaceCss, current.origins),
                EmailNode.Raw({ html: "<!--<![endif]-->", text: "", origins: [] }),
              ]),
        ],
      });
    for (const [index, child] of current.children.entries()) {
      const replaced = insert(child);
      if (replaced !== undefined)
        return EmailNode.Element({ ...current, children: current.children.with(index, replaced) });
    }
    return undefined;
  };
  return insert(node);
};

export interface RenderedEmail {
  readonly subject: string;
  readonly preheader: string | undefined;
  readonly html: string;
  readonly text: string;
  readonly tree: EmailNode;
  readonly diagnostics: readonly EmailDiagnostic[];
  readonly positions: readonly EmittedPosition[];
}

/**
 * Render authored content against a stylesheet: inline what a client honors,
 * keep the rest for `<head>`, and lower to HTML and text.
 */
export const renderEmailContent = (
  stylesheet: Stylesheet | undefined,
  render: () => EmailContent,
  options: SerializeEmailOptions = {},
): RenderedEmail => {
  // Primitives report into a module-level sink; start each render from empty so
  // a previous render in the same isolate cannot contribute findings.
  drainEmailDiagnostics();
  const content = render();
  const invalid: EmailDiagnostic[] = [];
  const fail = (code: string, message: string) =>
    invalid.push({ code, severity: "error", message, origins: [] });
  if (typeof content.subject !== "string" || /[\r\n\u0000]/.test(content.subject))
    fail("invalid-subject", "Invalid email subject: it must be one line of text.");
  if (content.preheader !== undefined && typeof content.preheader !== "string")
    fail("invalid-preheader", "Invalid email preheader: it must be a string.");
  if (content.text !== undefined && typeof content.text !== "string")
    fail("invalid-text", "Invalid plain text: it must be a string.");
  settle(invalid);

  const base =
    content.preheader === undefined ? content.body : withPreheader(content.body, content.preheader);
  const styled =
    stylesheet === undefined
      ? { tree: base, headCss: "", fontFaceCss: "", diagnostics: [] }
      : applyStylesheet(base, stylesheet);
  const style: EmailDiagnostic[] = [...styled.diagnostics];
  let tree = styled.tree;
  if (styled.headCss !== "" || styled.fontFaceCss !== "") {
    const placed = withHeadCss(tree, styled.headCss, styled.fontFaceCss);
    if (placed === undefined)
      style.push({
        code: "missing-head",
        severity: "error",
        message:
          "Styles that cannot be inlined — media queries, dark-scheme rules and pseudo-selectors — need a <head> to live in. Wrap the message in <Email>, or write those declarations as inline styles.",
        origins: [],
      });
    else tree = placed;
  }
  settle(style);
  const compiled = compileEmail(tree, options);
  // The doctype is prepended after serialization, so every recorded offset moves
  // with it. Positions have to index the string this function returns as `html`,
  // or a host that locates a finding in it lands on the wrong element.
  const prefix = compiled.html.startsWith("<html") ? EMAIL_DOCTYPE : "";
  const html = `${prefix}${compiled.html}`;
  const positions =
    prefix === ""
      ? compiled.positions
      : compiled.positions.map((position) => ({
          ...position,
          start: position.start + prefix.length,
          end: position.end + prefix.length,
        }));
  return {
    subject: content.subject,
    preheader: content.preheader,
    html,
    text: content.text ?? compiled.text,
    tree,
    diagnostics: [...style, ...compiled.diagnostics],
    positions,
  };
};
// oxlint-enable samva/no-try-catch-or-throw
