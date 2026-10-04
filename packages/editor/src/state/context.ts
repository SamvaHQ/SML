import { createContext, useContext } from "react";
import { useStore } from "zustand";

import type { EditorBundle, EditorState, EditorStore } from "./store";

/**
 * The instance seam: one bundle (store + spine) per {@link EditorProvider}
 * mount, delivered by context so the editor stays embeddable — two editors on
 * one page never share state. The context carries the STORE, not state values,
 * so providing it never re-renders subscribers; all reactivity flows through
 * {@link useEditorStore} selectors.
 */
export const EditorBundleContext = createContext<EditorBundle | null>(null);

function useEditorBundle(): EditorBundle {
  const bundle = useContext(EditorBundleContext);
  // oxlint-disable-next-line samva/no-try-catch-or-throw, samva/no-error-constructor -- React hook boundary (not Effect domain): using the hook outside its provider is a programmer error that must fail loudly at render.
  if (bundle === null) throw new Error("useEditorBundle must be used within an EditorProvider");
  return bundle;
}

/**
 * Subscribe to a slice of editor state. Selector rules:
 * - one primitive per call is the default: `useEditorStore((s) => s.sizeKb)`
 * - actions are one stable object: `const { select } = useEditorStore((s) => s.actions)`
 * - a fresh object/array selector needs `useShallow`, or it renders on every transition
 * - a fallback value must be a module-level constant, never a fresh `[]` or `{}`: even
 *   under `useShallow` a freshly allocated member never settles, and the store spins
 */
export function useEditorStore<T>(selector: (state: EditorState) => T): T {
  return useStore(useEditorBundle().store, selector);
}

/**
 * The raw store handle for handler-only reads: `useEditorStoreApi().getState()`
 * at event time subscribes to nothing, so components whose handlers need doc or
 * outline never re-render for them.
 */
export function useEditorStoreApi(): EditorStore {
  return useEditorBundle().store;
}
