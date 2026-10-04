import { createContext, useContext, type ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";

import { useEditorStore, useEditorStoreApi } from "../state/context";
import { summarizeChecks } from "../state/derive";
import type { EditorLayoutMode } from "../state/store";
import type { CheckItem } from "../state/types";
import { useContribution } from "./contributions";
import {
  outlineEntries,
  selectionComponentLabel,
  selectionLabel,
  selectionTextExcerpt,
} from "./email-outline";

/** What the `rail.assistant` contribution may call. */
export interface EditorAssistantControls {
  readonly flushSaves: () => Promise<string>;
  readonly workspace: EditorAssistantWorkspace;
  readonly exportHtml: () => void;
  readonly canExport: boolean;
  /**
   * Reveals the host's `rail.review` surface. Undefined when the host contributes none, so an
   * assistant without one renders no link to it.
   */
  readonly openReview?: (() => void) | undefined;
}

/** Read-only editor state projected into the host's assistant. */
export interface EditorAssistantWorkspace {
  readonly draftRevision: string | null;
  readonly saveVersionStatus: "unavailable" | "idle" | "saving" | "saved" | "error";
  readonly checks: {
    readonly errors: number;
    readonly warnings: number;
    /** Current grouped diagnostics, with fixture and client evidence. */
    readonly findings: ReadonlyArray<CheckItem>;
    readonly canFix: boolean;
  };
  readonly diagnosticAssistance: {
    readonly id: number;
    readonly revision: string;
    readonly check: CheckItem;
  } | null;
  /**
   * Canvas selection while the assistant is pointing, not editing: the rendered instance and the
   * fixture it was taken in, which is what identifies it to the host.
   */
  readonly pointedElement: {
    readonly originIndex?: number;
    readonly instancePath: string;
    readonly fixture: string;
    readonly label: string;
  } | null;
  /** Instance paths present in the render on screen. */
  readonly availableInstancePaths: ReadonlyArray<string>;
  /** Layout mode the editor chrome resolved for its frame width. */
  readonly layout: EditorLayoutMode;
  /** Every rendered layer in document order, with its hierarchy and source identity. */
  readonly layers: ReadonlyArray<{
    readonly instancePath: string;
    readonly fixture: string;
    readonly originIndex?: number | undefined;
    readonly label: string;
    readonly detail?: string | undefined;
    readonly depth: number;
    readonly active: boolean;
  }>;
}

/** The shell-owned state the assistant region hands its contribution beside the store's. */
export interface AssistantShellState {
  readonly exportHtml: () => void;
  readonly canExport: boolean;
  readonly saveVersionStatus: EditorAssistantWorkspace["saveVersionStatus"];
}

const AssistantShellContext = createContext<AssistantShellState | null>(null);

export const AssistantShellProvider = AssistantShellContext.Provider;

/**
 * The host's `rail.assistant` contribution, rendered with its controls, or null when the host
 * contributes none. Only the region that docks the assistant calls this, so the store slices the
 * workspace projects re-render that region alone.
 */
export function useAssistant(): {
  readonly panel: ReactNode;
  readonly header: ReactNode;
} | null {
  const assistant = useContribution("rail.assistant");
  const review = useContribution("rail.review");
  const shell = useContext(AssistantShellContext);
  const store = useEditorStoreApi();
  const {
    doc,
    render,
    outline,
    selection,
    originIndex,
    checks,
    diagnosticAssistance,
    layout,
    canFix,
  } = useEditorStore(
    useShallow((state) => ({
      doc: state.doc,
      render: state.render,
      outline: state.outline,
      selection: state.selection,
      originIndex: state.assistantOriginIndex,
      checks: state.checks,
      diagnosticAssistance: state.diagnosticAssistance,
      layout: state.layoutMode,
      canFix:
        state.sourceEditable &&
        !state.conflict &&
        state.pendingAuthoredSource === null &&
        !state.lifecycleBusy,
    })),
  );
  if (assistant === undefined || shell === null) return null;

  const checkSummary = summarizeChecks(checks);
  const pointed =
    selection.kind === "element" ? (outline?.index.get(selection.instancePath) ?? null) : null;
  const pointedElement =
    pointed === null || selection.kind !== "element"
      ? null
      : {
          originIndex,
          instancePath: pointed.instancePath,
          fixture: selection.fixture,
          label: selectionLabel(pointed),
        };
  const fixture = doc?.channel === "email" ? doc.fixture : null;
  const layers =
    outline === null || fixture === null || render === null || doc === null
      ? []
      : outlineEntries(outline).map(({ depth, node }) => {
          const detail = selectionTextExcerpt(node.selection, render.html);
          return {
            instancePath: node.instancePath,
            fixture,
            ...(node.selection.origins[originIndex] === undefined ? {} : { originIndex }),
            label: selectionComponentLabel(node.selection, doc.origin.authoredSource),
            ...(detail === undefined ? {} : { detail }),
            depth,
            active: selection.kind === "element" && selection.instancePath === node.instancePath,
          };
        });

  const panel = assistant.render({
    flushSaves: () => store.getState().actions.flushSaves(),
    exportHtml: shell.exportHtml,
    canExport: shell.canExport,
    openReview: review === undefined ? undefined : () => store.getState().actions.openReview(),
    workspace: {
      draftRevision: doc?.rev ?? null,
      saveVersionStatus: shell.saveVersionStatus,
      checks: {
        errors: checkSummary.errorCount,
        warnings: checkSummary.warnCount,
        findings: checkSummary.actionable,
        canFix,
      },
      diagnosticAssistance,
      pointedElement,
      availableInstancePaths: outline === null ? [] : [...outline.index.keys()],
      layout,
      layers,
    },
  });
  return { panel, header: assistant.header ?? null };
}
