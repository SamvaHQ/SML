import { Switch } from "@base-ui/react/switch";
import { Toggle as BaseToggle } from "@base-ui/react/toggle";
import { ToggleGroup } from "@base-ui/react/toggle-group";
import { Tooltip } from "@base-ui/react/tooltip";
import type { ReactNode } from "react";

import { cn, focusRing, tabOptionClass } from "./ui-classes";
import { useEditorPortalContainer } from "./use-editor-portal";

/** A `{{variable}}` token, rendered as the mono `{{name}}` placeholder. */
export function VarChip({ name, className }: { name: string; className?: string | undefined }) {
  return (
    <span
      className={cn(
        "inline-flex items-baseline rounded-md bg-accent-teal/20 px-1.5 py-px font-mono text-[0.82em] font-medium text-foreground ring-1 ring-inset ring-accent-teal/20",
        className,
      )}
    >
      {`{{${name}}}`}
    </span>
  );
}

export function GroupLabel({ children }: { children: ReactNode }) {
  return (
    <div className="text-muted-foreground mb-2 flex items-center justify-between text-[10.5px] font-semibold tracking-[0.06em] uppercase">
      {children}
    </div>
  );
}

export function IconBtn({
  children,
  className,
  title,
  help = title,
  pressed,
  onClick,
  disabled,
  testId,
}: {
  children: ReactNode;
  className?: string | undefined;
  title: string;
  help?: string | undefined;
  pressed?: boolean | undefined;
  onClick?: (() => void) | undefined;
  disabled?: boolean | undefined;
  testId?: string | undefined;
}) {
  const portalContainer = useEditorPortalContainer();
  return (
    <Tooltip.Root disabled={disabled}>
      <Tooltip.Trigger
        render={
          <button
            type="button"
            aria-label={title}
            aria-pressed={pressed}
            disabled={disabled}
            data-testid={testId}
            onClick={onClick}
            className={cn(
              "inline-flex h-7.5 items-center gap-1.5 rounded-[7px] px-2.5 text-muted-foreground outline-none transition-all hover:bg-muted hover:text-foreground active:translate-y-px disabled:opacity-40",
              "aria-pressed:bg-[var(--editor-pressed-bg)] aria-pressed:shadow-[var(--editor-pressed-shadow)]",
              "aria-pressed:text-accent-foreground",
              focusRing,
              className,
            )}
          />
        }
      >
        {children}
      </Tooltip.Trigger>
      <Tooltip.Portal container={portalContainer}>
        <Tooltip.Positioner side="bottom" sideOffset={5} className="z-[200]">
          <Tooltip.Popup
            role="tooltip"
            className="bg-foreground text-background rounded-md px-2 py-1 text-[11px] shadow-[var(--shadow-md)]"
          >
            {help}
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

/** A compact, mutually-exclusive Base UI toggle group (device, scheme, text role). */
export function Segmented({
  ariaLabel,
  options,
  value,
  onChange,
  size = "md",
  testId,
}: {
  ariaLabel: string;
  options: {
    value: string;
    label: ReactNode;
    title?: string | undefined;
    testId?: string | undefined;
  }[];
  value: string;
  onChange: (value: string) => void;
  size?: "sm" | "md" | undefined;
  testId?: string | undefined;
}) {
  const portalContainer = useEditorPortalContainer();
  return (
    <ToggleGroup
      aria-label={ariaLabel}
      value={[value]}
      data-testid={testId}
      onValueChange={(values) => {
        const next = values[0];
        if (next !== undefined) onChange(next);
      }}
      className={cn(
        "bg-muted inline-flex gap-0.5 rounded-lg p-0.5",
        size === "sm" && "rounded-[7px]",
      )}
    >
      {options.map((opt) => {
        const control = (
          <BaseToggle
            key={opt.value}
            type="button"
            aria-label={opt.title}
            data-testid={opt.testId}
            value={opt.value}
            className={cn(
              tabOptionClass,
              size === "sm" ? "h-6 px-2 text-xs" : "h-7 px-2.5 text-xs",
            )}
          >
            {opt.label}
          </BaseToggle>
        );
        if (opt.title === undefined) return control;
        return (
          <Tooltip.Root key={opt.value}>
            <Tooltip.Trigger render={control} />
            <Tooltip.Portal container={portalContainer}>
              <Tooltip.Positioner side="bottom" sideOffset={5} className="z-[200]">
                <Tooltip.Popup
                  role="tooltip"
                  className="bg-foreground text-background rounded-md px-2 py-1 text-[11px] shadow-[var(--shadow-md)]"
                >
                  {opt.title}
                </Tooltip.Popup>
              </Tooltip.Positioner>
            </Tooltip.Portal>
          </Tooltip.Root>
        );
      })}
    </ToggleGroup>
  );
}

export function Toggle({
  label,
  pressed,
  onChange,
  disabled,
  testId,
}: {
  label: string;
  pressed: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean | undefined;
  testId?: string | undefined;
}) {
  return (
    <Switch.Root
      aria-label={label}
      checked={pressed}
      disabled={disabled}
      onCheckedChange={onChange}
      data-testid={testId}
      className={cn(
        "inline-flex h-[18px] w-[30px] rounded-full p-0.5 outline-none transition-colors disabled:opacity-40",
        focusRing,
        pressed ? "bg-accent-email" : "bg-border",
      )}
    >
      <Switch.Thumb
        className={cn(
          "block size-3.5 rounded-full bg-background shadow-[var(--shadow-md)] transition-transform",
          pressed && "translate-x-3",
        )}
      />
    </Switch.Root>
  );
}

/** A read-only mono value chip in the inspector; `overridden` flags a mobile style override. */
export function MonoCtl({
  children,
  className,
  overridden,
  testId,
}: {
  children: ReactNode;
  className?: string | undefined;
  overridden?: boolean | undefined;
  testId?: string | undefined;
}) {
  return (
    <span
      data-testid={testId}
      className={cn(
        "inline-flex h-7 max-w-[170px] items-center gap-1.5 overflow-hidden rounded-[7px] border border-border bg-background px-2.5 font-mono text-xs whitespace-nowrap text-foreground",
        overridden && "border-accent-email/40 bg-sel-soft ring-1 ring-accent-email/20",
        className,
      )}
      title={overridden ? "Overridden on mobile" : undefined}
    >
      {children}
      {overridden && (
        <span className="text-accent-email ml-auto text-[9px] font-semibold tracking-wide uppercase">
          M
        </span>
      )}
    </span>
  );
}
