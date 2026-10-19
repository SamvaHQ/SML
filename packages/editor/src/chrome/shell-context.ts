import { createContext, useContext } from "react";

import type { StatusBarProps } from "./statusbar";
import type { TopBarActions } from "./topbar";

/** What {@link EditorRoot} computes for the parts it holds. */
export interface ShellChrome {
  readonly topBar: TopBarActions;
  readonly statusBar: StatusBarProps;
  /** A standalone rail is open over the canvas in a narrow frame. */
  readonly overlayOpen: boolean;
  /** This editor's id prefix, so parts that name each other (a switch and its panes) agree. */
  readonly idBase: string;
}

// The context lives apart from the components that read it, so an HMR update to a part never
// re-executes `createContext` and splits mounted providers from fresh consumers.
const ShellChromeContext = createContext<ShellChrome | null>(null);

export const ShellChromeProvider = ShellChromeContext.Provider;

/** The root's chrome state. A part rendered outside an `EditorRoot` is a host bug. */
export const useShellChrome = (): ShellChrome => {
  const chrome = useContext(ShellChromeContext);
  // oxlint-disable-next-line samva/no-try-catch-or-throw, samva/no-error-constructor -- React hook boundary (not Effect domain): a part outside its root is a programmer error that must fail loudly at render.
  if (chrome === null) throw new Error("Editor chrome parts must be rendered inside EditorRoot");
  return chrome;
};
