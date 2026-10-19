import { clsx } from "clsx";

// The editor keeps its own Base UI components but draws them with the class recipes of the
// dashboard's design system (`@samva/ui`, base-nova): the same geometry, tokens and states, so
// the editor sits inside the dashboard without a seam. Popups animate with Base UI's
// starting/ending style attributes rather than an animation plugin the host may not ship.

export function cn(...inputs: (string | false | null | undefined)[]) {
  return clsx(inputs);
}

/**
 * House focus ring. Routes through the room `--ring` token, which every editor host
 * (dashboard `.surface-app`, warm marketing) maps to amber.
 */
export const focusRing =
  "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

/** Shared press-and-fade motion for every control. */
const controlMotion =
  "transition-[color,background-color,border-color,box-shadow,translate,opacity] duration-150 ease-out";

/**
 * Editor chrome primary CTA in the raised material (`--editor-raised-*`). Hover and an open
 * popup hold one fill step; pressing moves it 1px down into an inset; disabled flattens. The
 * caller supplies height and horizontal padding.
 */
export const chromePrimary = cn(
  "inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-all outline-none disabled:pointer-events-none disabled:opacity-50",
  "bg-[var(--editor-raised-bg)] text-[color:var(--editor-raised-fg)] shadow-[var(--editor-raised-shadow)]",
  "hover:bg-[var(--editor-raised-bg-hover)] aria-expanded:bg-[var(--editor-raised-bg-hover)] data-popup-open:bg-[var(--editor-raised-bg-hover)]",
  "active:translate-y-px active:shadow-[var(--editor-raised-shadow-pressed)] disabled:shadow-none data-disabled:shadow-none",
  focusRing,
);

/**
 * The paper-raised control (`@samva/ui` button `outline`): select triggers, pickers and the
 * floating zoom control. Hover and an open popup settle on the accent surface.
 */
export const softRaised = cn(
  "bg-background shadow-[0_0_0_1px_color-mix(in_oklab,var(--foreground)_16%,transparent),inset_0_1px_0_0_oklch(1_0_0/0.85),inset_0_0_0_1px_oklch(1_0_0/0.5),0_1px_2px_0_oklch(0_0_0/0.08)]",
  "hover:bg-accent hover:text-accent-foreground aria-expanded:bg-accent aria-expanded:text-accent-foreground data-popup-open:bg-accent data-popup-open:text-accent-foreground",
  "active:translate-y-px active:bg-[color-mix(in_oklab,var(--accent),black_3%)] active:shadow-[0_0_0_1px_color-mix(in_oklab,var(--foreground)_16%,transparent),inset_0_1px_3px_0_oklch(0_0_0/0.14)] disabled:shadow-none data-disabled:shadow-none",
  "dark:bg-input/40 dark:shadow-[0_1px_2px_0_oklch(0_0_0/0.35),0_0_0_1px_oklch(0_0_0/0.4),inset_0_1px_0_0_oklch(1_0_0/0.1),inset_0_0_0_1px_oklch(1_0_0/0.06)] dark:hover:bg-input/55",
);

/**
 * The ghost button (`@samva/ui` button `ghost`): quiet text or icon controls in a toolbar. Its
 * hover and open state take the accent surface. The caller supplies size through
 * {@link toolbarButton} or {@link iconButton}.
 */
export const ghostButton = cn(
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium text-muted-foreground outline-none",
  controlMotion,
  "hover:bg-accent hover:text-accent-foreground aria-expanded:bg-accent aria-expanded:text-accent-foreground data-popup-open:bg-accent data-popup-open:text-accent-foreground dark:hover:bg-accent/50",
  "disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  focusRing,
);

/** A toolbar-tier text button (`@samva/ui` size `xs`): a 28px pill. */
export const toolbarButton = cn(ghostButton, "h-7 rounded-full px-2.5 text-xs");

/**
 * A toolbar-tier icon button (`@samva/ui` size `icon-xs`): a 28px circle whose invisible
 * `after:` extends the hit target, so the visual size stays small without a small target.
 */
export const iconButton = cn(
  ghostButton,
  "relative size-7 rounded-full after:absolute after:-inset-1.5",
);

/** The pressed-in inset a toggle holds while on (`@samva/ui` `tactilePressedInset`). */
export const pressedInset =
  "aria-pressed:bg-[var(--editor-pressed-bg)] aria-pressed:text-foreground aria-pressed:shadow-[var(--editor-pressed-shadow)]";

/**
 * The recessed trough a set of tabs or a segmented switch sits in (`@samva/ui` `TabsList`),
 * without a display, for a caller that lays its options out itself.
 */
export const tabTroughClass = cn(
  "gap-0.5 rounded-lg bg-muted p-[3px] text-muted-foreground",
  "shadow-[inset_0_1px_2px_0_oklch(0_0_0/0.05)] dark:shadow-[inset_0_1px_2px_0_oklch(0_0_0/0.35)]",
);

/** The trough laid out as one inline row of options. */
export const tabListClass = cn("inline-flex w-fit items-center justify-center", tabTroughClass);

/**
 * The tab-option treatment for every editor switcher (`@samva/ui` `TabsTrigger`). A resting
 * option is quiet text; the selected one raises off its trough or row as a chip
 * (`--editor-chip-*`, which carry the design system's chip values). The transparent resting
 * border holds both states at the same height. Geometry stays with the caller.
 *
 * Base UI spells "selected" three ways — `data-pressed` on a toggle, `data-active` on a
 * tab, and `aria-pressed` where a toggle keeps its button semantics — so each key is
 * written out in full for Tailwind to extract.
 */
export const tabOptionClass = cn(
  "relative inline-flex items-center justify-center gap-1.5 rounded-md border border-transparent font-medium whitespace-nowrap text-foreground/60 outline-none dark:text-muted-foreground",
  "hover:text-foreground dark:hover:text-foreground",
  "transition-[color,background-color,border-color,box-shadow] duration-150 ease-out",
  "disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  focusRing,
  "data-[pressed]:border-[color:var(--editor-chip-border)] data-[pressed]:bg-[var(--editor-chip-bg)] data-[pressed]:text-[color:var(--editor-chip-fg)] data-[pressed]:shadow-[var(--editor-chip-shadow)]",
  "data-active:border-[color:var(--editor-chip-border)] data-active:bg-[var(--editor-chip-bg)] data-active:text-[color:var(--editor-chip-fg)] data-active:shadow-[var(--editor-chip-shadow)]",
  "aria-pressed:border-[color:var(--editor-chip-border)] aria-pressed:bg-[var(--editor-chip-bg)] aria-pressed:text-[color:var(--editor-chip-fg)] aria-pressed:shadow-[var(--editor-chip-shadow)]",
);

/** Base UI popup motion: scale and fade from the trigger, in and out. */
const popupMotion =
  "origin-[var(--transform-origin)] transition-[transform,scale,opacity] duration-150 ease-out data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0";

/** A menu's paper (`@samva/ui` `DropdownMenuContent`). */
export const menuPopupClass = cn(
  "z-50 max-h-[var(--available-height)] min-w-32 overflow-x-hidden overflow-y-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-[var(--shadow-md)] outline-none",
  popupMotion,
);

/** A menu row (`@samva/ui` `DropdownMenuItem`). */
export const menuItemClass = cn(
  "relative flex cursor-default items-center gap-1.5 rounded-md px-1.5 py-1 text-[13px] whitespace-nowrap outline-hidden select-none",
  "data-highlighted:bg-accent data-highlighted:text-accent-foreground",
  "data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
);

/** A small heading over a group of menu rows (`@samva/ui` `DropdownMenuLabel`). */
export const menuLabelClass =
  "px-1.5 py-1.5 text-[10.5px] font-medium tracking-[0.06em] text-muted-foreground uppercase";

/** A popover's paper (`@samva/ui` `PopoverContent`); the caller supplies width and padding. */
export const popoverPopupClass = cn(
  "z-50 flex flex-col rounded-md border border-border bg-popover text-popover-foreground shadow-[var(--shadow-md)] outline-hidden",
  popupMotion,
);

/** A tooltip (`@samva/ui` `TooltipContent`): inverted ink, with room for a shortcut. */
export const tooltipPopupClass = cn(
  "z-50 inline-flex w-fit max-w-xs items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-xs text-background",
  popupMotion,
);

/** A keyboard shortcut chip inside a tooltip (`@samva/ui` `Kbd` in tooltip content). */
export const tooltipKbdClass =
  "pointer-events-none inline-flex h-5 min-w-5 items-center justify-center rounded-sm bg-background/20 px-1 font-sans text-xs font-medium text-background select-none dark:bg-background/10";

export const fieldClass = cn(
  "min-h-9 w-full rounded-lg border border-border bg-background px-2.5 text-[13px] text-foreground outline-none disabled:cursor-not-allowed disabled:bg-surface-inset disabled:text-muted-foreground",
  focusRing,
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
