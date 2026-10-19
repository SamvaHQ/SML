// Shell entry for @samva/editor — the chrome around the canvas: editor state/provider, the shell
// layout (chat beside a tabbed work pane, or layers · canvas · inspector), and the inspector.
// Import the companion stylesheet once in the host: `@samva/editor/styles.css`.
// The editor's state hooks are deliberately NOT exported: hosts talk to the editor through
// EditorProvider props and the shell's parts; everything inside reads the instance store.
export { EditorProvider } from "./state/provider";
export type { EditorProviderProps } from "./state/provider";
export type { PreparedPreviewDocument } from "./canvas/preview-document";
export type { UserSelection } from "./state/store";
export type { CheckItem, CheckSeverity } from "./state/types";
export {
  EditorRoot,
  EditorShell,
  EditorStatusBar,
  EditorTopBar,
  EditorWorkspace,
} from "./chrome/shell";
export type { EditorRootProps, EditorRootState } from "./chrome/shell";
// Chrome parts: each takes `className` (a string or a function of its state) and Base UI's
// `render`, carries a `data-slot`, and exposes its state as data attributes. Render them inside
// `EditorRoot` to lay the editor out differently from `EditorShell`.
export { EditorAssistantDock, type AssistantDockState } from "./chrome/assistant-rail";
export { EditorCanvas } from "./chrome/canvas-pane";
export { EditorDivider } from "./chrome/resize";
export { EditorPaneSwitch, type EditorPaneSwitchState } from "./chrome/pane-switch";
export { EditorPreviewBar, FixtureSelect as EditorFixtureSelect } from "./chrome/preview-bar";
export type { PreviewBarState } from "./chrome/preview-bar";
export type { StatusBarState } from "./chrome/statusbar";
export type { TopBarState } from "./chrome/topbar";
export { VersionPicker as EditorVersionPicker } from "./chrome/version-picker";
export { AddViewItems as EditorAddViewItems, EditorWorkPane } from "./chrome/work-pane";
export type { WorkPaneState } from "./chrome/work-pane";
export { EditorZoomControl, type ZoomControlState } from "./chrome/zoom-control";
export type { PartProps } from "./chrome/part";
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
