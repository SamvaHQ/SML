import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import type { ReactElement, ReactNode } from "react";

import { cn } from "../lib/utils";
import { Badge } from "../ui/badge";
import { Kbd } from "../ui/kbd";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group";
import { Tooltip, TooltipContent } from "../ui/tooltip";
import { segmentedGroupClass, segmentedItemClass } from "./ui-classes";

// Editor compositions over the shadcn primitives in `../ui`. They add nothing a host must learn:
// a tooltip around one trigger, a segmented switch (shadcn's tabs look on a toggle group), and
// the small value and label shapes the inspector repeats.

/** A `{{variable}}` token, rendered as the mono `{{name}}` placeholder. */
export function VarChip({ name, className }: { name: string; className?: string | undefined }) {
  return (
    <Badge variant="outline" className={cn("rounded-md font-mono", className)}>
      {`{{${name}}}`}
    </Badge>
  );
}

/** The small uppercase label over a group of inspector rows. */
export function GroupLabel({ children }: { children: ReactNode }) {
  return (
    <div
      data-slot="editor-group-label"
      className="text-muted-foreground mb-2 flex items-center justify-between font-mono text-[10.5px] font-medium tracking-[0.08em] uppercase"
    >
      {children}
    </div>
  );
}

/** A read-only value in the inspector, such as a width, a tag or a source position. */
export function Value({
  children,
  className,
  testId,
}: {
  readonly children: ReactNode;
  readonly className?: string | undefined;
  readonly testId?: string | undefined;
}) {
  return (
    <Badge
      variant="outline"
      data-testid={testId}
      className={cn("h-6 max-w-44 justify-start rounded-md font-mono font-normal", className)}
    >
      <span className="truncate">{children}</span>
    </Badge>
  );
}

/**
 * A tooltip around one trigger. `shortcut` adds the key chord as a chip after the label. The
 * trigger keeps its own accessible name; the tooltip is the inspect layer, not the label.
 */
export function Tip({
  label,
  shortcut,
  side = "bottom",
  disabled,
  children,
}: {
  readonly label: ReactNode;
  readonly shortcut?: string | undefined;
  readonly side?: "top" | "bottom" | "left" | "right" | undefined;
  readonly disabled?: boolean | undefined;
  readonly children: ReactElement;
}) {
  return (
    <Tooltip disabled={disabled}>
      {/* The primitive trigger adds behaviour only, so the child keeps its own data-slot. */}
      <TooltipPrimitive.Trigger render={children} />
      <TooltipContent role="tooltip" side={side} sideOffset={6}>
        {label}
        {shortcut !== undefined && <Kbd>{shortcut}</Kbd>}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * A segmented switch: one value out of a few, drawn as shadcn's tabs list (a muted trough whose
 * selected option lifts onto the background) over Base UI's toggle group.
 */
export function Segmented<Value extends string>({
  ariaLabel,
  options,
  value,
  onChange,
  size = "default",
  className,
  testId,
}: {
  readonly ariaLabel: string;
  readonly options: ReadonlyArray<{
    readonly value: Value;
    readonly label: ReactNode;
    readonly title?: string | undefined;
    readonly testId?: string | undefined;
  }>;
  readonly value: Value;
  readonly onChange: (value: Value) => void;
  readonly size?: "sm" | "default" | undefined;
  readonly className?: string | undefined;
  readonly testId?: string | undefined;
}) {
  return (
    <ToggleGroup
      aria-label={ariaLabel}
      value={[value]}
      data-testid={testId}
      spacing={0}
      onValueChange={(values) => {
        const next = options.find((option) => option.value === values[0]);
        if (next !== undefined) onChange(next.value);
      }}
      className={cn(segmentedGroupClass, size === "sm" ? "h-7" : "h-8", className)}
    >
      {options.map((option) => {
        const item = (
          <ToggleGroupItem
            key={option.value}
            value={option.value}
            aria-label={option.title}
            data-testid={option.testId}
            data-editor-control=""
            className={segmentedItemClass}
          >
            {option.label}
          </ToggleGroupItem>
        );
        return option.title === undefined ? (
          item
        ) : (
          <Tip key={option.value} label={option.title}>
            {item}
          </Tip>
        );
      })}
    </ToggleGroup>
  );
}
