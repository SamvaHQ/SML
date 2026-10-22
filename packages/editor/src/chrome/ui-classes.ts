import { cn } from "../lib/utils";

// Class strings the chrome composes beside the shadcn primitives in `../ui`: the house focus
// ring and field recipes (shadcn's input), the segmented switch (shadcn's tabs list on a toggle
// group), and the reveal for secondary controls.

export { cn };

/** shadcn's focus ring, through the host's `--ring` token. */
export const focusRing =
  "focus-visible:border-ring focus-visible:ring-ring/50 outline-none focus-visible:ring-3";

/** shadcn's input recipe, for the editor's own text fields. */
export const fieldClass = cn(
  "border-input dark:bg-input/30 placeholder:text-muted-foreground min-h-8 w-full min-w-0 rounded-lg border bg-transparent px-2.5 py-1 text-sm transition-colors",
  "disabled:bg-input/50 dark:disabled:bg-input/80 disabled:cursor-not-allowed",
  focusRing,
);

/** The trough of a segmented switch: shadcn's tabs list. */
export const segmentedGroupClass = "bg-muted text-muted-foreground gap-0.5 rounded-lg p-[3px]";

/** One option of a segmented switch: shadcn's tabs trigger, selected when pressed. */
export const segmentedItemClass = cn(
  "h-full min-w-0 rounded-md! border border-transparent px-2 text-xs text-foreground/60 hover:bg-transparent hover:text-foreground",
  "aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-sm",
  "dark:text-muted-foreground dark:aria-pressed:border-input dark:aria-pressed:bg-input/30 dark:aria-pressed:text-foreground",
);

/**
 * A secondary control that reveals with its row: hidden at rest, shown while the row is hovered
 * or holds keyboard focus, and always shown on a device that cannot hover. The row carries the
 * `group/row` name.
 */
export const revealOnRowHover = cn(
  "opacity-0 transition-opacity duration-150",
  "group-hover/row:opacity-100 group-has-[:focus-visible]/row:opacity-100 focus-visible:opacity-100",
  "[@media(hover:none)]:opacity-100",
);

/**
 * The header row of a rail or pane (the assistant's, the work pane's tabs, the preview bar): one
 * height and one divider, so the rows line up across the frame.
 */
export const railHeaderClass = "border-border flex h-11 shrink-0 items-center border-b";

/**
 * A small value chip in the top bar (the brand, the email switcher, the channel): sentence case
 * on the 12px step, one height, one fill. A host that draws its own control beside the document
 * name uses this recipe so it matches.
 */
export const chipClass = cn(
  "border-border-subtle bg-surface-inset text-muted-foreground inline-flex h-6 min-w-0 max-w-44 shrink-0 items-center gap-1 rounded-md border px-2 text-xs font-medium whitespace-nowrap outline-none",
  focusRing,
);

/** A chip that opens something: it takes the hover fill and the open state. */
export const chipTriggerClass = cn(
  chipClass,
  "hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground data-popup-open:bg-muted data-popup-open:text-foreground",
);
