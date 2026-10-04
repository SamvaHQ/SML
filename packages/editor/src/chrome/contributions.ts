import { createContext, useContext, type ReactNode } from "react";

import type { EditorLifecycleControls } from "./shell";
import type { EditorAssistantControls } from "./use-assistant";

/**
 * What a host adds to the editor's chrome, named by the region it lands in. The editor owns the
 * layout of every region; a contribution supplies content and, where the region hands it one, the
 * controls it may call. A region the host leaves empty renders nothing.
 *
 * - `frame.start`: the host's own navigation, flush-left outside the editor grid.
 * - `toolbar.leading`: host identity at the start of the toolbar.
 * - `toolbar.actions`: host actions beside the canonical toolbar actions, in `order`.
 * - `document.switcher`: controls beside the document name, such as a channel or entry picker.
 * - `rail.assistant`: a docked assistant. Its presence makes Assistant the default rail mode.
 * - `rail.review`: a review surface docked as the Design rail's Review view.
 * - `canvas.overlay`: a notice pinned over the canvas without taking its clicks.
 * - `statusbar.headline`: one sentence that replaces the draft revision in the status bar.
 */
export type EditorContribution =
  | {
      readonly slot: "frame.start";
      readonly id: string;
      readonly render: () => ReactNode;
    }
  | {
      readonly slot: "toolbar.leading";
      readonly id: string;
      readonly render: () => ReactNode;
    }
  | {
      readonly slot: "toolbar.actions";
      readonly id: string;
      /** Lower renders first; contributions without one keep their list order after those with one. */
      readonly order?: number | undefined;
      readonly render: (controls: EditorLifecycleControls) => ReactNode;
    }
  | {
      readonly slot: "document.switcher";
      readonly id: string;
      readonly render: (controls: EditorLifecycleControls) => ReactNode;
    }
  | {
      readonly slot: "rail.assistant";
      readonly id: string;
      readonly render: (controls: EditorAssistantControls) => ReactNode;
      /** A standing fact beside the Assistant title, such as an allowance or a connection state. */
      readonly header?: ReactNode | undefined;
    }
  | {
      readonly slot: "rail.review";
      readonly id: string;
      readonly content: ReactNode;
      /** Count chip beside the Review tab label. */
      readonly badge?: ReactNode | undefined;
    }
  | {
      readonly slot: "canvas.overlay";
      readonly id: string;
      readonly render: () => ReactNode;
    }
  | {
      readonly slot: "statusbar.headline";
      readonly id: string;
      readonly headline: string;
      /** Keep the Save version action in the status bar beside the headline. */
      readonly saveVersion: boolean;
    };

export type EditorSlot = EditorContribution["slot"];

export type ContributionFor<S extends EditorSlot> = Extract<
  EditorContribution,
  { readonly slot: S }
>;

/** Regions that hold one thing: a second contribution there is a host bug, not a layout choice. */
const SINGLE: ReadonlySet<EditorSlot> = new Set([
  "frame.start",
  "document.switcher",
  "rail.assistant",
  "rail.review",
  "statusbar.headline",
]);

/** The contributions resolved per region, checked once per render of the shell. */
export interface ResolvedContributions {
  readonly all: <S extends EditorSlot>(slot: S) => ReadonlyArray<ContributionFor<S>>;
  readonly one: <S extends EditorSlot>(slot: S) => ContributionFor<S> | undefined;
}

/**
 * Index a host's contributions by region. Fails loudly on a duplicate id or on two contributions
 * to a region that holds one, because silently dropping either hides a host bug.
 */
export const resolveContributions = (
  contributions: ReadonlyArray<EditorContribution>,
): ResolvedContributions => {
  const ids = new Set<string>();
  const bySlot = new Map<EditorSlot, EditorContribution[]>();
  for (const contribution of contributions) {
    if (ids.has(contribution.id)) {
      // oxlint-disable-next-line samva/no-try-catch-or-throw, samva/no-error-constructor -- Host contract boundary (not Effect domain): a host that contributes twice is a defect that must fail loudly at render rather than drop a contribution.
      throw new Error(`Editor contribution id "${contribution.id}" is used twice.`);
    }
    ids.add(contribution.id);
    const list = bySlot.get(contribution.slot) ?? [];
    if (SINGLE.has(contribution.slot) && list.length > 0) {
      // oxlint-disable-next-line samva/no-try-catch-or-throw, samva/no-error-constructor -- Host contract boundary (not Effect domain): a host that contributes twice is a defect that must fail loudly at render rather than drop a contribution.
      throw new Error(
        `Editor region "${contribution.slot}" holds one contribution; "${list[0]!.id}" and "${contribution.id}" both target it.`,
      );
    }
    list.push(contribution);
    bySlot.set(contribution.slot, list);
  }
  const actions = bySlot.get("toolbar.actions");
  if (actions !== undefined) {
    const orderOf = (contribution: EditorContribution) =>
      contribution.slot === "toolbar.actions" ? contribution.order : undefined;
    // `toSorted` is stable, so equal orders and the unordered tail keep their list order.
    bySlot.set(
      "toolbar.actions",
      actions.toSorted((left, right) => {
        const a = orderOf(left);
        const b = orderOf(right);
        if (a === undefined || b === undefined) return a === b ? 0 : a === undefined ? 1 : -1;
        return a - b;
      }),
    );
  }
  const all = <S extends EditorSlot>(slot: S): ReadonlyArray<ContributionFor<S>> =>
    (bySlot.get(slot) ?? []).filter(
      (contribution): contribution is ContributionFor<S> => contribution.slot === slot,
    );
  return { all, one: (slot) => all(slot)[0] };
};

// The context lives here, apart from the components that read it, so an HMR update to a region
// never re-executes `createContext` and splits mounted providers from fresh consumers.
const ContributionsContext = createContext<ResolvedContributions>(resolveContributions([]));

/** Hands the shell's resolved contributions to the regions that render them. */
export const ContributionsProvider = ContributionsContext.Provider;

/** The one contribution a region holds, or undefined when the host left the region empty. */
export const useContribution = <S extends EditorSlot>(slot: S): ContributionFor<S> | undefined =>
  useContext(ContributionsContext).one(slot);

/** Every contribution to a region, in render order. */
export const useContributions = <S extends EditorSlot>(
  slot: S,
): ReadonlyArray<ContributionFor<S>> => useContext(ContributionsContext).all(slot);
