import type { CompiledNode, CompiledSource } from "../compiled-template";
import type { EmailDiagnostic } from "../email/diagnostics";

export interface IssueFrontmatter {
  readonly title: string;
  readonly slug: string;
  readonly topic: string;
  readonly preheader?: string;
  readonly seo?: {
    readonly title?: string;
    readonly description?: string;
    readonly image?: string;
  };
  /** Number of leading top-level blocks visible before the subscription gate. */
  readonly gate?: { readonly leadIn: number };
}

/** Value offsets are UTF-16, end-exclusive; quoted spans include both literal quotes. */
export interface MarkdownSourceProperty {
  readonly name: string;
  readonly value: string | number | boolean;
  readonly literalType: "string" | "number" | "boolean";
  readonly start: number;
  readonly end: number;
  readonly syntax: "quoted" | "boolean" | "markdown";
}

/** Authored ranges, before decoding entities or removing Markdown delimiters. */
export interface MarkdownSourceNode {
  readonly kind: "component" | "block" | "inline" | "text";
  readonly start: number;
  readonly end: number;
  readonly contentStart: number;
  readonly contentEnd: number;
  readonly tag: string;
  readonly src: CompiledSource;
  readonly properties: readonly MarkdownSourceProperty[];
}

export interface ParseIssueResult {
  /** Empty whenever any diagnostic is an error. Brand components await host resolution. */
  readonly nodes: readonly CompiledNode[];
  readonly frontmatter: IssueFrontmatter | undefined;
  readonly diagnostics: readonly EmailDiagnostic[];
  readonly sources: readonly string[];
  readonly sourceNodes: readonly MarkdownSourceNode[];
}
