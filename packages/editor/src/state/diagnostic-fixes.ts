import {
  inspectSourceElement,
  literalReplacement,
  type SourceReplacement,
} from "@samva/markup/edit";

import type { CheckItem } from "./types";

/** Match enforced email-client navigation with an explicit, inspectable author choice. */
export const newWindowTargetFix = (
  check: CheckItem,
  source: string,
  file: string,
): readonly SourceReplacement[] => {
  const edits = new Map<number, SourceReplacement>();
  for (const diagnostic of check.diagnostics ?? []) {
    if (diagnostic.code !== "caniemail/target-attribute" || diagnostic.severity !== "warning")
      continue;
    for (const origins of diagnostic.occurrences ?? [diagnostic.origins]) {
      const origin = origins[0];
      if (origin === undefined) continue;
      const element = inspectSourceElement(source, file, origin);
      // A custom component may interpret target differently. Never rewrite its props by guesswork.
      if (element === null || element.tag !== "a" || element.hasSpread) continue;
      const targets = element.properties.filter((property) => property.name === "target");
      const target = targets[0];
      if (
        targets.length !== 1 ||
        target === undefined ||
        target.kind !== "literal" ||
        !["_self", "_parent", "_top"].includes(target.value)
      )
        continue;
      const edit = literalReplacement(source, target, "_blank");
      if (edit !== null) edits.set(edit.start, edit);
    }
  }
  return [...edits.values()].sort((left, right) => left.start - right.start);
};
