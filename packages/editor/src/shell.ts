// Shell entry for @samva/editor — the chrome around the canvas: editor
// state/provider, three-pane shell layout, left rail, and contextual inspector.
// Import the companion stylesheet once in the host: `@samva/editor/styles.css`.
// The editor's state hooks are deliberately NOT exported: hosts talk to the
// editor only through EditorProvider props and EditorShell; everything inside
// reads the instance store directly.
export { EditorProvider } from "./state/provider";
export type { EditorProviderProps } from "./state/provider";
export type { PreparedPreviewDocument } from "./canvas/preview-document";
export type { UserSelection } from "./state/store";
export type { CheckItem, CheckSeverity } from "./state/types";
export { EditorShell } from "./chrome/shell";
export type { EditorContribution, EditorSlot } from "./chrome/contributions";
export type { EditorIcon, EditorIconName, EditorIcons } from "./chrome/icon-set";
export { EditorGlyph } from "./chrome/editor-glyph";
export { LockedAction } from "./chrome/locked-action";
export type { LockedActionProps } from "./chrome/locked-action";
export type { EditorHostChrome, EditorLifecycleControls, EditorShellProps } from "./chrome/shell";
export type { EditorAssistantControls, EditorAssistantWorkspace } from "./chrome/use-assistant";
export { useEditorPortalContainer } from "./chrome/use-editor-portal";
export type { TopBarActions } from "./chrome/topbar";
export type { EditorBrandSource } from "./chrome/brand-chip";
export {
  STARTER_PATH,
  THEME_PATH,
  type EditorBrand,
  type EditorProjectTheme,
} from "./chrome/theme-brand";
export { downloadEmailHtml, emailHtmlForExport } from "./chrome/export-html";
