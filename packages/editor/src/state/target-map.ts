import type { EmailElementSelection } from "@samva/markup/edit";

// The selection lives in the email render's instance paths, which the outline, inspector and
// checks key on. The web page is a second render of the same authoring, so a path in one is the
// same element in the other when both carry the same authored origin and iteration.

const identity = (selection: EmailElementSelection): string | null => {
  const origin = selection.origins[0];
  if (origin === undefined || !selection.authored) return null;
  return `${origin.fileName}:${origin.lineNumber}:${origin.columnNumber}#${selection.occurrence}`;
};

/**
 * The path in `to` of the element `from` names, or null when `to` has no render of that authored
 * element. Elements a compiler primitive generated have no authored identity of their own and
 * resolve to the primitive's outermost authored element.
 */
export const correspondingPath = (
  from: ReadonlyArray<EmailElementSelection>,
  to: ReadonlyArray<EmailElementSelection>,
  path: string,
): string | null => {
  const source = from.find((candidate) => candidate.instancePath === path);
  if (source === undefined) return null;
  const origin = source.origins[0];
  if (origin === undefined) return null;
  const wanted =
    identity(source) ??
    // Generated: use the authored element that asked for it, by origin and iteration.
    `${origin.fileName}:${origin.lineNumber}:${origin.columnNumber}#${source.occurrence}`;
  return to.find((candidate) => identity(candidate) === wanted)?.instancePath ?? null;
};
