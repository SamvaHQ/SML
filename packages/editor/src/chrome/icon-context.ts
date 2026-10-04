import { createContext, useContext } from "react";

import { DEFAULT_EDITOR_ICONS, type EditorIcons } from "./icon-set";

// The context lives apart from the icon components so an HMR update to them never re-executes
// `createContext`, which would leave mounted providers and fresh consumers on different contexts.

const EditorIconsContext = createContext<EditorIcons>(DEFAULT_EDITOR_ICONS);

export const EditorIconsProvider = EditorIconsContext.Provider;

/** The icon set in effect: the defaults with whatever the host replaced. */
export const useEditorIcons = (): EditorIcons => useContext(EditorIconsContext);
