import type { EmailElementSelection } from "@samva/markup/edit";
import { useMemo } from "react";

import { useEditorStore } from "../state/context";
import type { CheckItem } from "../state/types";

/** The diagnostic code a component that reads simpler in email is reported under. */
const DEGRADATION_CODE = "email-component-degradation";

/** One component whose email is simpler than its web page, from the checks already on the draft. */
export interface EmailDifference {
  /** The component as the author wrote it, such as `Chart`. */
  readonly component: string;
  /** What email readers get, as the component declares it. */
  readonly note: string;
  /** How many times the preview renders it. */
  readonly count: number;
  /** The first rendered instance in document order, or null when the preview holds none. */
  readonly first: string | null;
}

const originKey = (origin: {
  readonly fileName: string;
  readonly lineNumber: number;
  readonly columnNumber: number;
}): string => `${origin.fileName}:${origin.lineNumber}:${origin.columnNumber}`;

const NO_SELECTIONS: ReadonlyArray<EmailElementSelection> = [];

/**
 * The degradation findings among `checks`, one row per component, with its instances in the
 * email preview counted from `selections`. It reads the findings the document already carries;
 * the editor never runs the compatibility check itself.
 */
export const emailDifferences = (
  checks: ReadonlyArray<CheckItem>,
  selections: ReadonlyArray<EmailElementSelection>,
): ReadonlyArray<EmailDifference> => {
  const rows = new Map<string, { note: string; origins: Set<string> }>();
  for (const check of checks) {
    for (const item of check.diagnostics ?? []) {
      if (item.code !== DEGRADATION_CODE || item.compatibility?.assessment !== "degradation") {
        continue;
      }
      const component = /^<([^>]+)>/.exec(item.message)?.[1];
      if (component === undefined) continue;
      const row = rows.get(component) ?? { note: item.compatibility.title, origins: new Set() };
      for (const chain of item.occurrences ?? [item.origins]) {
        const origin = chain[0];
        if (origin !== undefined) row.origins.add(originKey(origin));
      }
      rows.set(component, row);
    }
  }
  return [...rows].map(([component, { note, origins }]) => {
    const instances = selections.filter((selection) => {
      const origin = selection.origins[0];
      return selection.authored && origin !== undefined && origins.has(originKey(origin));
    });
    return { component, note, count: instances.length, first: instances[0]?.instancePath ?? null };
  });
};

/** The differences on screen, from the document's checks and the email preview's instances. */
export const useEmailDifferences = (): ReadonlyArray<EmailDifference> => {
  const checks = useEditorStore((state) => state.checks);
  const selections = useEditorStore((state) => state.render?.selections ?? NO_SELECTIONS);
  return useMemo(() => emailDifferences(checks, selections), [checks, selections]);
};
