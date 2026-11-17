import type { RevisionToken } from "@samva/editor/host";
import { createContext, useContext, type ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";

import { useEditorStore, useEditorStoreApi } from "../state/context";
import { summarizeChecks } from "../state/derive";
import { saveStatus, type EditorLayoutMode, type SaveStatus } from "../state/store";
import type { CheckItem, EditorPin } from "../state/types";
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
  /**
   * Save the draft as a version before an assistant turn so the turn builds on kept work;
   * resolves the saved revision (immediately when nothing changed).
   *
   * Call it before each send and start the turn on the revision it resolves: it writes every
   * edit still on its way (Design and Source alike), saves them as one version unless the open
   * revision already is the saved version, and makes that revision the open one. It rejects with
   * the reason when the save fails, which `workspace.version` also reports as `failed`; hold the
   * send then. Concurrent calls share one save. Without the host's `versions` it only writes the
   * draft and resolves its revision.
   */
  readonly saveVersion: () => Promise<RevisionToken>;
  readonly workspace: EditorAssistantWorkspace;
  readonly exportHtml: () => void;
  readonly canExport: boolean;
  /**
   * Reveals the host's `rail.review` surface. Undefined when the host contributes none, so an
   * assistant without one renders no link to it.
   */
  readonly openReview?: (() => void) | undefined;
  /** Remove one pin, as the tray's × does. */
  readonly removePin: (id: string) => void;
  /** Remove every pin, such as once the message they were attached to is sent. */
  readonly clearPins: () => void;
}

/** Read-only editor state projected into the host's assistant. */
export interface EditorAssistantWorkspace {
  readonly draftRevision: string | null;
  /**
   * Where the draft stands against its saved versions, as the status bar says it. `unsaved`
   * holds `changes` made here since the last saved version (0 when they are not counted, such as
   * changes made before the editor opened); `saved` names the version's `number` when the host
   * counts them; `failed` carries the `reason`. `unavailable` means the host offers no
   * `versions`.
   */
  readonly version: {
    readonly status: "unavailable" | "unsaved" | "saving" | "saved" | "failed";
    readonly changes: number;
    readonly number?: number | undefined;
    readonly reason?: string | undefined;
  };
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
   * The element the assistant is pointed at: the rendered instance and the fixture it was taken
   * in, which is what identifies it to the host. In point mode a selection points it; in Design
   * and pin mode only the element panel's "Ask agent about this" does, and changing the canvas
   * mode clears it.
   */
  readonly pointedElement: {
    readonly originIndex?: number;
    readonly instancePath: string;
    readonly fixture: string;
    readonly label: string;
  } | null;
  /**
   * Design is the canvas's mode. Its edits are ordinary changes to the draft; they never hold
   * the chat, and `saveVersion` keeps them before a turn.
   */
  readonly design: { readonly on: boolean };
  /** The pins on the email, in tray order, for the next message. */
  readonly pins: ReadonlyArray<EditorPin>;
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
}

/** The save status in the assistant's terms. */
const versionOf = (
  status: SaveStatus,
  versioned: boolean,
  changes: number | null,
): EditorAssistantWorkspace["version"] => {
  const counted = changes ?? 0;
  if (!versioned)
    return status.kind === "failed"
      ? { status: "failed", changes: counted, reason: status.reason }
      : { status: "unavailable", changes: counted };
  switch (status.kind) {
    case "saving":
      return { status: "saving", changes: counted };
    case "saved":
      return { status: "saved", changes: 0, number: status.number };
    case "failed":
      return { status: "failed", changes: counted, reason: status.reason };
    default:
      return { status: "unsaved", changes: counted };
  }
};

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
    target,
    originIndex,
    checks,
    diagnosticAssistance,
    layout,
    canFix,
    designOn,
    versioned,
    changes,
    pins,
  } = useEditorStore(
    useShallow((state) => ({
      doc: state.doc,
      render: state.render,
      outline: state.outline,
      selection: state.selection,
      target: state.assistantTarget,
      originIndex: state.assistantOriginIndex,
      checks: state.checks,
      diagnosticAssistance: state.diagnosticAssistance,
      layout: state.layoutMode,
      designOn: state.canvasMode === "design",
      versioned: state.versionsCapability?.status === "ready",
      changes: state.version.changes,
      pins: state.pins,
      canFix:
        state.sourceEditable &&
        !state.conflict &&
        state.pendingAuthoredSource === null &&
        !state.lifecycleBusy,
    })),
  );
  const status = useEditorStore(useShallow(saveStatus));
  if (assistant === undefined || shell === null) return null;

  const checkSummary = summarizeChecks(checks);
  const pointed = target === null ? null : (outline?.index.get(target.instancePath) ?? null);
  const pointedElement =
    pointed === null || target === null
      ? null
      : {
          originIndex: target.originIndex,
          instancePath: pointed.instancePath,
          fixture: target.fixture,
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
    saveVersion: () => store.getState().actions.saveVersion(),
    exportHtml: shell.exportHtml,
    canExport: shell.canExport,
    openReview: review === undefined ? undefined : () => store.getState().actions.openReview(),
    removePin: (id) => store.getState().actions.removePin(id),
    clearPins: () => store.getState().actions.clearPins(),
    workspace: {
      draftRevision: doc?.rev ?? null,
      version: versionOf(status, versioned, changes),
      checks: {
        errors: checkSummary.errorCount,
        warnings: checkSummary.warnCount,
        findings: checkSummary.actionable,
        canFix,
      },
      diagnosticAssistance,
      design: { on: designOn },
      pins,
      pointedElement,
      availableInstancePaths: outline === null ? [] : [...outline.index.keys()],
      layout,
      layers,
    },
  });
  return { panel, header: assistant.header ?? null };
}
