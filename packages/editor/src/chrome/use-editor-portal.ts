import { createContext, useContext } from "react";

// The context lives apart from the components that provide and read it so an HMR update to
// them never re-executes `createContext`. A new context object would leave mounted providers
// and freshly loaded consumers on different contexts.

// Undefined: no shell, and popups use document.body. Null: the shell is mounted and the
// portal element is not yet. The element itself, once mounted: Base UI 1.9 reads a ref's
// `.current` inside `useLayoutEffect` before React attaches a later sibling's ref, so a
// ref object whose current is still null is treated as "portal to document.body" and the
// effect does not run again.
export const EditorPortalContext = createContext<HTMLDivElement | null | undefined>(undefined);

/** The shell-owned Base UI portal target. */
export const useEditorPortalContainer = () => useContext(EditorPortalContext);
