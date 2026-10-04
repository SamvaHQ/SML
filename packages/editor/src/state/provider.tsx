import type { AsyncEditorHost } from "@samva/editor/host";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { EditorIconsProvider } from "../chrome/icon-context";
import { DEFAULT_EDITOR_ICONS, type EditorIcons } from "../chrome/icon-set";
import { EditorBundleContext } from "./context";
import { createEditorBundle, type UserSelection } from "./store";
import type { CheckItem } from "./types";

/** Stable empty checks default so an omitted prop doesn't churn the synced state. */
const NO_CHECKS: ReadonlyArray<CheckItem> = [];

export interface EditorProviderProps {
  readonly host: AsyncEditorHost;
  /** Host-supplied lint results merged into the statusbar + document inspector checks. */
  readonly checks?: ReadonlyArray<CheckItem> | undefined;
  /** Icons that replace the editor's defaults, by name. Keep the object stable across renders. */
  readonly icons?: Partial<EditorIcons> | undefined;
  /**
   * Called when the user selects an element (a canvas click or an outline row), with the render the
   * selection was made in. A selection the editor rebinds to a newer render is not reported again.
   */
  readonly onSelectElement?: ((selection: UserSelection) => void) | undefined;
  readonly children: ReactNode;
}

/**
 * Mounts one editor instance: a store + persistence spine created per host.
 * A changed `host` identity swaps the whole bundle — a host is a document
 * session, so its state pile (selection, history, layout) dies with it. Bundle
 * creation is side-effect free; the session opens in the mount effect, so
 * StrictMode's double-invoke opens and disposes cleanly.
 */
export function EditorProvider({
  host,
  checks = NO_CHECKS,
  icons,
  onSelectElement,
  children,
}: EditorProviderProps) {
  const [bundle, setBundle] = useState(() => createEditorBundle(host, { hostChecks: checks }));
  // React-sanctioned derived-state reset: recreate the bundle during render when
  // the host changes (e.g. the vite dev app re-authenticates). React discards
  // this render and re-runs with the fresh bundle before committing, so children
  // never commit against the old document's state under the new host.
  if (bundle.host !== host) {
    setBundle(createEditorBundle(host, { hostChecks: checks }));
  }

  useEffect(() => {
    bundle.spine.open();
    return () => bundle.spine.dispose();
  }, [bundle]);

  useEffect(() => {
    bundle.store.getState().actions.setHostChecks(checks);
  }, [bundle, checks]);

  useEffect(() => {
    bundle.setUserSelectListener(onSelectElement);
    return () => bundle.setUserSelectListener(undefined);
  }, [bundle, onSelectElement]);

  const iconSet = useMemo(
    () => (icons === undefined ? DEFAULT_EDITOR_ICONS : { ...DEFAULT_EDITOR_ICONS, ...icons }),
    [icons],
  );

  return (
    <EditorBundleContext.Provider value={bundle}>
      <EditorIconsProvider value={iconSet}>{children}</EditorIconsProvider>
    </EditorBundleContext.Provider>
  );
}
