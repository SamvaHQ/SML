import { useEditorIcons } from "./icon-context";
import type { EditorIconName } from "./icon-set";

/**
 * One of the editor's glyphs by name, for host chrome drawn beside the editor so it shares the
 * editor's icon set, including any glyph the host replaced through `EditorProvider`'s `icons`.
 */
export function EditorGlyph({
  name,
  className,
}: {
  readonly name: EditorIconName;
  readonly className?: string | undefined;
}) {
  const Icon = useEditorIcons()[name];
  return <Icon {...(className === undefined ? {} : { className })} />;
}
