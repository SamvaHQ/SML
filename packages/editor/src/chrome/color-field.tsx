import { useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";

import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Check, ChevronDown } from "./editor-icons";
import {
  colorLabel,
  displayColor,
  hexOf,
  matchColor,
  isTransparent,
  sourceLabel,
  type PaletteColor,
} from "./theme-tokens";
import { cn } from "./ui-classes";

// One field per color property: the color in use (swatch, name, value) on the trigger, and a
// list grouped by where each color comes from. The list is a listbox, so arrow keys move through
// it and Enter or Space chooses.

/** One choice in a picker list. */
export interface PickerOption {
  readonly key: string;
  readonly testId: string;
  /** What the option is called; the listbox reads it. */
  readonly name: string;
  readonly detail?: string | undefined;
  readonly leading?: ReactNode;
  /** Style for the name, such as a font's own face. */
  readonly nameStyle?: CSSProperties | undefined;
  readonly selected: boolean;
  readonly onChoose: () => void;
}

export interface PickerGroup {
  readonly label: string;
  readonly options: ReadonlyArray<PickerOption>;
}

/** A grouped listbox with roving focus. */
export function PickerList({
  label,
  groups,
}: {
  readonly label: string;
  readonly groups: ReadonlyArray<PickerGroup>;
}) {
  const list = useRef<HTMLDivElement>(null);
  const options = groups.flatMap((group) => group.options);
  const focusIndex = Math.max(
    0,
    options.findIndex((option) => option.selected),
  );
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = [...(list.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])];
    const at = items.indexOf(event.target as HTMLElement);
    const next =
      event.key === "ArrowDown"
        ? Math.min(items.length - 1, at + 1)
        : event.key === "ArrowUp"
          ? Math.max(0, at - 1)
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? items.length - 1
              : null;
    if (next === null) return;
    event.preventDefault();
    items[next]?.focus();
  };
  // Each group's first option's position in the whole list, for roving focus.
  const starts = groups.map((_, at) =>
    groups.slice(0, at).reduce((count, group) => count + group.options.length, 0),
  );
  return (
    <div
      ref={list}
      role="listbox"
      aria-label={label}
      onKeyDown={move}
      className="samva-editor-scroll flex max-h-80 flex-col overflow-y-auto"
    >
      {groups.map((group, groupAt) =>
        group.options.length === 0 ? null : (
          <div key={group.label} role="group" aria-label={group.label} className="py-1">
            <div className="text-muted-foreground px-2 pt-1 pb-1 text-[11px] font-medium">
              {group.label}
            </div>
            {group.options.map((option, optionAt) => {
              const index = starts[groupAt]! + optionAt;
              return (
                <div
                  key={option.key}
                  role="option"
                  aria-selected={option.selected}
                  tabIndex={index === focusIndex ? 0 : -1}
                  data-testid={option.testId}
                  data-editor-control=""
                  onClick={option.onChoose}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      option.onChoose();
                    }
                  }}
                  className="hover:bg-muted focus-visible:bg-muted flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-[13px] outline-none"
                >
                  {option.leading}
                  <span className="min-w-0 flex-1 truncate" style={option.nameStyle}>
                    {option.name}
                  </span>
                  {option.detail !== undefined && (
                    <span className="text-muted-foreground shrink-0 font-mono text-[11px]">
                      {option.detail}
                    </span>
                  )}
                  <Check
                    className={cn(
                      "size-3.5 shrink-0",
                      option.selected ? "opacity-100" : "opacity-0",
                    )}
                  />
                </div>
              );
            })}
          </div>
        ),
      )}
    </div>
  );
}

/** A color's swatch, with its dark value beside it when the theme sets one. */
export function Swatch({
  value,
  dark,
}: {
  readonly value: string | null;
  readonly dark?: string | undefined;
}) {
  if (value === null) return null;
  const dot = (color: string, mode: "light" | "dark") => (
    <span
      key={mode}
      aria-hidden
      data-mode={mode}
      className="size-3.5 shrink-0 rounded-full border border-black/15 dark:border-white/20"
      style={{ background: color }}
    />
  );
  return (
    <span data-slot="editor-design-swatch" className="flex shrink-0 items-center gap-0.5">
      {dot(value, "light")}
      {dark !== undefined && dot(dark, "dark")}
    </span>
  );
}

/** Brand first, then the email's own overrides, then the starter theme. */
const sourceRank = (color: PaletteColor): number =>
  color.source.kind === "brand" ? 0 : color.source.kind === "project" ? 1 : 2;

/** 0 neutrals, 1 brand (primary, secondary, accent, destructive), 2 borders, 3 anything else. */
const colorGroup = (name: string): number => {
  const base = name.replace(/-foreground$/, "");
  if (["background", "foreground", "card", "popover", "muted"].includes(base)) return 0;
  if (["primary", "secondary", "accent", "destructive"].includes(base)) return 1;
  if (["border", "input", "ring"].includes(base)) return 2;
  return 3;
};

export interface ColorFieldProps {
  /** "Text" or "Background". */
  readonly label: string;
  readonly testId: string;
  readonly colors: ReadonlyArray<PaletteColor>;
  /** The palette color the element's class sets, if any. */
  readonly token: PaletteColor | undefined;
  /** The arbitrary hex the element's class sets, if any. */
  readonly custom: string | undefined;
  /** The color the element renders in, when the canvas can tell. */
  readonly rendered: string | null;
  readonly disabled: boolean;
  readonly pending: boolean;
  /** Set the class to a palette color, a hex, or nothing (inherit). */
  readonly onChoose: (choice: { readonly token: string } | { readonly hex: string } | null) => void;
  readonly onRefused: (reason: string) => void;
}

/** One color property: what is applied, and the theme's colors to change it to. */
export function ColorField({
  label,
  testId,
  colors,
  token,
  custom,
  rendered,
  disabled,
  pending,
  onChoose,
  onRefused,
}: ColorFieldProps) {
  const [open, setOpen] = useState(false);
  const [hex, setHex] = useState(custom ?? "");
  const [editingCustom, setEditingCustom] = useState(false);
  const renderedColor = rendered === null || isTransparent(rendered) ? null : rendered;
  const inherited = token === undefined && custom === undefined;
  const renderedMatch = renderedColor === null ? undefined : matchColor(colors, renderedColor);
  const applied: {
    readonly name: string;
    readonly value: string | null;
    readonly dark?: string | undefined;
  } =
    token !== undefined
      ? { name: colorLabel(token), value: token.value, dark: token.dark }
      : custom !== undefined
        ? { name: "Custom", value: custom }
        : renderedMatch !== undefined
          ? {
              name: `Inherited · ${colorLabel(renderedMatch)}`,
              value: renderedMatch.value,
              dark: renderedMatch.dark,
            }
          : { name: "Inherited", value: renderedColor === null ? null : hexOf(renderedColor) };

  const choose = (choice: Parameters<ColorFieldProps["onChoose"]>[0]) => {
    setOpen(false);
    setEditingCustom(false);
    onChoose(choice);
  };
  const ordered = colors.toSorted(
    (a, b) => sourceRank(a) - sourceRank(b) || colorGroup(a.name) - colorGroup(b.name),
  );
  const groups = new Map<string, PickerOption[]>();
  for (const color of ordered) {
    const group = sourceLabel(color.source);
    const options = groups.get(group) ?? [];
    options.push({
      key: color.name,
      testId: `${testId}.${color.name}`,
      name: colorLabel(color),
      detail: color.value === null ? undefined : displayColor(color.value),
      leading: <Swatch value={color.value} dark={color.dark} />,
      selected: token?.name === color.name,
      onChoose: () => choose({ token: color.name }),
    });
    groups.set(group, options);
  }
  const other: PickerOption[] = [
    {
      key: "none",
      testId: `${testId}.none`,
      name:
        inherited && renderedMatch !== undefined
          ? `Inherited · ${colorLabel(renderedMatch)}`
          : "Inherited",
      selected: inherited,
      onChoose: () => choose(null),
    },
    {
      key: "custom",
      testId: `${testId}.custom`,
      name: "Custom colour…",
      detail: custom,
      selected: custom !== undefined,
      onChoose: () => setEditingCustom(true),
    },
  ];
  const commitHex = () => {
    const value = hex.trim();
    if (value === "") return choose(null);
    if (!/^#[0-9a-f]{3,8}$/i.test(value)) {
      onRefused("A custom color is a hex value such as #b4532a.");
      return;
    }
    choose({ hex: value });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            aria-label={`${label}: ${applied.name}`}
            data-testid={testId}
            data-editor-control=""
            data-inherited={inherited ? "" : undefined}
            disabled={disabled}
            className="h-8 w-full justify-start gap-2 px-2 font-normal"
          />
        }
      >
        <Swatch value={applied.value} dark={applied.dark} />
        <span className="min-w-0 flex-1 truncate text-left text-[13px]">{applied.name}</span>
        {applied.value !== null && (
          <span className="text-muted-foreground shrink-0 font-mono text-[11px]">
            {displayColor(applied.value)}
          </span>
        )}
        {pending ? (
          <Spinner />
        ) : (
          <ChevronDown className="text-muted-foreground size-3.5 shrink-0" />
        )}
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="start"
        sideOffset={4}
        data-testid={`${testId}.list`}
        className="w-(--anchor-width) min-w-64 gap-0 p-1"
      >
        <PickerList
          label={label}
          groups={[
            ...[...groups].map(([group, options]) => ({ label: group, options })),
            { label: "Other", options: other },
          ]}
        />
        {editingCustom && (
          <div className="border-border flex items-center gap-1.5 border-t px-1 pt-1.5 pb-0.5">
            <Input
              autoFocus
              aria-label={`${label} hex`}
              data-testid={`${testId}.custom-hex`}
              value={hex}
              placeholder="#b4532a"
              onChange={(event) => setHex(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") commitHex();
              }}
              className="h-7 font-mono text-[12px] md:text-[12px]"
            />
            <Button size="sm" data-editor-control="" onClick={commitHex} className="h-7">
              Set
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** The mark on a control whose edit is still being written and rendered. */
export function Spinner({ className }: { readonly className?: string | undefined }) {
  return (
    <span
      role="status"
      aria-label="Updating"
      data-slot="editor-design-field-pending"
      className={cn(
        "border-muted-foreground/40 border-t-foreground inline-block size-3 shrink-0 animate-spin rounded-full border-[1.5px]",
        className,
      )}
    />
  );
}
