import type { EmailElementSelection } from "@samva/markup/render";

import { useEditorStore } from "../src/state/context";
import type { EditorActions, EditorState } from "../src/state/store";

/**
 * The flattened editor surface component tests assert against: full state,
 * every action, and the selector-derived valid hover element.
 * Subscribes to the whole store — a per-transition re-render is exactly what a
 * probe wants. Production code never does this; it selects narrow slices.
 */
export type EditorProbe = Omit<EditorState, "actions"> &
  EditorActions & {
    readonly hovered: EmailElementSelection | null;
  };

export const useEditorProbe = (): EditorProbe => {
  const state = useEditorStore((current) => current);
  return {
    ...state,
    ...state.actions,
    hovered:
      state.hoveredCandidatePath === null
        ? null
        : (state.outline?.index.get(state.hoveredCandidatePath) ?? null),
  };
};
