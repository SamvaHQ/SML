import type { Stylesheet } from "./css";

/** Sheets flattened into one, with rule order preserved across sheets. */
export const mergeStylesheets = (sheets: readonly Stylesheet[]): Stylesheet => {
  let base = 0;
  const rules = sheets.flatMap((sheet) => {
    const offset = base;
    base += sheet.rules.length + 1;
    return sheet.rules.map((rule) => ({ ...rule, order: offset + rule.order }));
  });
  const variables: Record<string, string> = {};
  const headAtRules: string[] = [];
  const fontFaces = new Map<string, Stylesheet["fontFaces"][number]>();
  const diagnostics = sheets.flatMap((sheet) => sheet.diagnostics);
  for (const sheet of sheets) {
    Object.assign(variables, sheet.variables);
    headAtRules.push(...sheet.headAtRules);
    // Two sheets declaring the same face emit it once.
    for (const face of sheet.fontFaces) fontFaces.set(face.css, face);
  }
  return { rules, headAtRules, fontFaces: [...fontFaces.values()], variables, diagnostics };
};
