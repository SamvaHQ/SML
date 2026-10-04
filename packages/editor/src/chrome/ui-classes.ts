import { clsx } from "clsx";

export function cn(...inputs: (string | false | null | undefined)[]) {
  return clsx(inputs);
}

/**
 * House focus ring. Routes through the room `--ring` token, which every editor host
 * (dashboard `.surface-app`, warm marketing) maps to amber.
 */
export const focusRing =
  "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

/**
 * Editor chrome primary CTA in the raised material (`--editor-raised-*`). Hover and an open
 * popup hold one fill step; pressing moves it 1px down into an inset; disabled flattens. The
 * caller supplies height and horizontal padding.
 */
export const chromePrimary = cn(
  "inline-flex items-center justify-center gap-1.5 rounded-[7px] font-medium transition-all outline-none disabled:pointer-events-none disabled:opacity-50",
  "bg-[var(--editor-raised-bg)] text-[color:var(--editor-raised-fg)] shadow-[var(--editor-raised-shadow)]",
  "hover:bg-[var(--editor-raised-bg-hover)] aria-expanded:bg-[var(--editor-raised-bg-hover)] data-popup-open:bg-[var(--editor-raised-bg-hover)]",
  "active:translate-y-px active:shadow-[var(--editor-raised-shadow-pressed)] disabled:shadow-none data-disabled:shadow-none",
  focusRing,
);

/**
 * The tab-option treatment for every editor switcher (the `Segmented` lineage).
 * A resting option is quiet muted text; the selected one raises off its trough or
 * row as a chip (`--editor-chip-*`). The transparent resting border holds both states
 * at the same height, and motion moves color, border, and shadow together. Geometry
 * (height, padding, font size) stays with the caller.
 *
 * Base UI spells "selected" three ways — `data-pressed` on a toggle, `data-active` on a
 * tab, and `aria-pressed` where a toggle keeps its button semantics — so each key is
 * written out in full for Tailwind to extract.
 */
export const tabOptionClass = cn(
  "inline-flex items-center justify-center gap-1.5 rounded-md border border-transparent font-medium whitespace-nowrap text-muted-foreground outline-none",
  "hover:bg-muted hover:text-foreground",
  "transition-[color,background-color,border-color,box-shadow] duration-150 ease-out",
  focusRing,
  "data-[pressed]:border-[color:var(--editor-chip-border)] data-[pressed]:bg-[var(--editor-chip-bg)] data-[pressed]:text-[color:var(--editor-chip-fg)] data-[pressed]:shadow-[var(--editor-chip-shadow)]",
  "data-active:border-[color:var(--editor-chip-border)] data-active:bg-[var(--editor-chip-bg)] data-active:text-[color:var(--editor-chip-fg)] data-active:shadow-[var(--editor-chip-shadow)]",
  "aria-pressed:border-[color:var(--editor-chip-border)] aria-pressed:bg-[var(--editor-chip-bg)] aria-pressed:text-[color:var(--editor-chip-fg)] aria-pressed:shadow-[var(--editor-chip-shadow)]",
);

export const fieldClass = cn(
  "min-h-9 w-full rounded-lg border border-border bg-background px-2.5 text-[13px] text-foreground outline-none disabled:cursor-not-allowed disabled:bg-surface-inset disabled:text-muted-foreground",
  focusRing,
);
