import type { CompiledTemplate } from "./compiled-template";
import type { TemplateDiagnostic } from "./email/diagnostics";
import { parseIssue, type IssueFrontmatter } from "./markdown/index";
import { compileTemplate, type CompileResult, type CompileTemplateOptions } from "./sml/compile";

/** An issue's Markdown path and the ordinary TSX template used as its layout. */
export interface CompileIssueOptions extends Omit<
  CompileTemplateOptions,
  "entry" | "issueContent"
> {
  readonly entry: string;
  readonly layout?: string | undefined;
}

export interface IssueCompileResult extends CompileResult {
  readonly frontmatter: IssueFrontmatter | undefined;
}

/**
 * Compile an issue inside layout.tsx (or the selected layout), without evaluating either file.
 * The slug identifies the issue, title is its email subject, and preheader is its inbox preview.
 * The layout supplies the input schema, fixtures, brand, theme and one IssueContent slot.
 */
export const compileIssue = async (options: CompileIssueOptions): Promise<IssueCompileResult> => {
  const source = options.files[options.entry];
  if (typeof source !== "string") {
    return {
      template: undefined,
      frontmatter: undefined,
      fixtures: {},
      assets: [],
      diagnostics: [
        {
          code: "markdown-syntax",
          severity: "error",
          message: `Issue ${options.entry} is missing or is not text.`,
          origins: [{ fileName: options.entry, lineNumber: 1, columnNumber: 1 }],
        },
      ],
    };
  }
  const issue = parseIssue(source, options.entry);
  if (
    issue.frontmatter === undefined ||
    issue.diagnostics.some((item) => item.severity === "error")
  )
    return {
      template: undefined,
      frontmatter: issue.frontmatter,
      fixtures: {},
      assets: [],
      diagnostics: issue.diagnostics,
    };
  const layout = options.layout ?? "layout.tsx";
  if (typeof options.files[layout] !== "string")
    return {
      template: undefined,
      frontmatter: issue.frontmatter,
      fixtures: {},
      assets: [],
      diagnostics: [
        {
          code: "issue-layout",
          severity: "error",
          message: `Issue layout ${layout} is missing or is not text.`,
          origins: [{ fileName: layout, lineNumber: 1, columnNumber: 1 }],
        },
      ],
    };
  const compiled = await compileTemplate({
    ...options,
    entry: layout,
    issueContent: { file: options.entry, nodes: issue.nodes },
  });
  const diagnostics: readonly TemplateDiagnostic[] = [
    ...issue.diagnostics,
    ...compiled.diagnostics,
  ];
  const template = compiled.template;
  if (
    template?.email === undefined ||
    template.sms !== undefined ||
    template.whatsapp !== undefined
  ) {
    return {
      ...compiled,
      template: undefined,
      frontmatter: issue.frontmatter,
      diagnostics:
        template === undefined
          ? diagnostics
          : [
              ...diagnostics,
              {
                code: "issue-layout",
                severity: "error",
                message: "An issue layout must declare only an email channel.",
                origins: [{ fileName: layout, lineNumber: 1, columnNumber: 1 }],
              },
            ],
    };
  }
  const { preheader: _preheader, ...email } = template.email;
  void _preheader;
  const result: CompiledTemplate = {
    ...template,
    template: issue.frontmatter.slug,
    email: {
      ...email,
      subject: issue.frontmatter.title,
      ...(issue.frontmatter.preheader === undefined
        ? {}
        : { preheader: issue.frontmatter.preheader }),
    },
  };
  return { ...compiled, template: result, frontmatter: issue.frontmatter, diagnostics };
};
