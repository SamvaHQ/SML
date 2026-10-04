import { createContext, useContext, type RefObject } from "react";

// The context lives apart from the components that provide and read it so an HMR update to
// them never re-executes `createContext`. A new context object would leave mounted providers
// and freshly loaded consumers on different contexts.

export const EditorPortalContext = createContext<RefObject<HTMLDivElement | null> | undefined>(
  undefined,
);

/** The shell-owned Base UI portal target. Undefined preserves standalone component tests. */
export const useEditorPortalContainer = () => useContext(EditorPortalContext);
