import type { WorkspaceView } from "./workspace-ui";

/** The DOM id of the Visual/Source tab for `view`, under an `idBase` given to `WorkspaceTabs`. */
export function workspaceTabId(idBase: string, view: WorkspaceView) {
  return `${idBase}-view-tab-${view}`;
}
