import {
  applySourceReplacements,
  inspectMarkdownNode,
  literalReplacement,
  type JsxSourceLocation,
  type SourceReplacement,
} from "@samva/markup/edit";
import { parseIssue } from "@samva/markup/markdown";

export type MarkdownChange =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "property"; readonly name: string; readonly value: string };

export type MarkdownEditResult =
  | { readonly ok: true; readonly edits: readonly SourceReplacement[] }
  | { readonly ok: false; readonly reason: string };

/**
 * Prose is plain text: literalReplacement escapes punctuation and encodes whitespace, including
 * line breaks, rather than letting it introduce formatting or blocks. Re-parsing must recover
 * the exact value and the same element structure; otherwise the change is refused.
 */
export const markdownEdit = (
  source: string,
  file: string,
  origin: JsxSourceLocation,
  change: MarkdownChange,
  options: { readonly tag?: string | undefined } = {},
): MarkdownEditResult => {
  const target = inspectMarkdownNode(source, file, origin, options);
  if (target === null)
    return { ok: false, reason: "This content changed. Select it again before editing." };
  const name = change.kind === "text" ? "children" : change.name;
  const value = change.kind === "text" ? change.text : change.value;
  const field = target.properties.find((property) => property.name === name);
  if (field === undefined)
    return {
      ok: false,
      reason:
        change.kind === "text"
          ? "This content includes formatting. Choose a single piece of text to edit."
          : "This setting cannot be edited here.",
    };
  const edit = literalReplacement(source, field, value);
  if (edit === null) return { ok: false, reason: "That value does not fit this setting." };
  const result = applySourceReplacements(source, [edit], { markdown: { file } });
  const refusal = "This change cannot keep the text and formatting intact. Try different text.";
  if (!result.ok) return { ok: false, reason: refusal };
  const updated = inspectMarkdownNode(result.source, file, origin, options);
  if (updated?.properties.find((property) => property.name === name)?.value !== value)
    return { ok: false, reason: refusal };
  const structure = (text: string) =>
    parseIssue(text, file).sourceNodes.map((node) => [
      node.kind,
      node.tag,
      node.properties.map((property) => property.name),
    ]);
  if (JSON.stringify(structure(source)) !== JSON.stringify(structure(result.source)))
    return { ok: false, reason: refusal };
  return { ok: true, edits: edit.before === edit.after ? [] : [edit] };
};
