import { createContext, useContext } from "react";

/** What the shell hands the preview bar from the host and from the layout around it. */
export interface PreviewChrome {
  /** The host reports work that will change the preview, such as an assistant turn. */
  readonly hostBusy: boolean;
  /** Opens the current preview in a new browser tab. Undefined where the host offers none. */
  readonly openInNewTab: (() => void) | undefined;
  /** Shows the checks surface of this layout. Undefined where the layout has none to show. */
  readonly showChecks: (() => void) | undefined;
}

const NO_PREVIEW_CHROME: PreviewChrome = {
  hostBusy: false,
  openInNewTab: undefined,
  showChecks: undefined,
};

// The context lives apart from the components that read it, so an HMR update to a region never
// re-executes `createContext` and splits mounted providers from fresh consumers.
const PreviewChromeContext = createContext<PreviewChrome>(NO_PREVIEW_CHROME);

export const PreviewChromeProvider = PreviewChromeContext.Provider;

export const usePreviewChrome = (): PreviewChrome => useContext(PreviewChromeContext);
