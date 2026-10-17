// Dark mode is one media query, `(prefers-color-scheme: dark)`. A theme's dark-mode block sets the
// colors that change under it, and every declaration that reads one of those colors switches with
// it. These helpers recognize that query wherever a stylesheet states it.

/** The media query a theme's dark-mode block and every generated dark-mode rule sit in. */
export const DARK_SCHEME_MEDIA = "@media (prefers-color-scheme: dark)";

const DARK_SCHEME_QUERY =
  /^(?:only\s+)?(?:screen\s+and\s+)?\(\s*prefers-color-scheme\s*:\s*dark\s*\)$/i;

/** Whether a `@media` prelude is exactly the dark-mode query. */
export const isDarkSchemeQuery = (prelude: string): boolean =>
  DARK_SCHEME_QUERY.test(prelude.trim());

/** Whether a rule's enclosing conditions are exactly the dark-mode query. */
export const isDarkSchemeCondition = (conditions: readonly string[]): boolean =>
  conditions.length === 1 &&
  /^@media\s/i.test(conditions[0]!) &&
  isDarkSchemeQuery(conditions[0]!.replace(/^@media\s+/i, ""));
