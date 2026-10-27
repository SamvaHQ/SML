import type { Button as ButtonPrimitive } from "@base-ui/react/button";
import type { ReactNode, Ref } from "react";

import { useEditorStore } from "../state/context";
import { Button } from "../ui/button";
import { Tip } from "./ui";

export interface EditorToolbarButtonProps extends Omit<ButtonPrimitive.Props, "children"> {
  /** Drawn before the label, and alone once the bar folds. */
  readonly icon: ReactNode;
  /** The action's name: the visible text, the accessible name and the folded tooltip. */
  readonly label: string;
  /** Use `default` for the host's primary action, matching Publish. Defaults to `ghost`. */
  readonly variant?: "default" | "ghost" | undefined;
  readonly ref?: Ref<HTMLButtonElement> | undefined;
}

/**
 * A host action that matches the top bar's own buttons: the same height, radius, type and
 * icon size as Preview, and icon-only with a tooltip exactly when the bar folds its labels
 * (every layout narrower than `wide`). Contribute it to `toolbar.actions`. It forwards its ref
 * and props to the button, so it also works as a Base UI `render` target, such as a popover's
 * trigger.
 */
export function EditorToolbarButton({
  icon,
  label,
  variant = "ghost",
  ref,
  ...props
}: EditorToolbarButtonProps) {
  const folded = useEditorStore((state) => state.layoutMode !== "wide");
  return (
    <Tip label={label} disabled={!folded}>
      <Button
        data-editor-control=""
        {...props}
        ref={ref}
        variant={variant}
        size={folded ? "icon-sm" : "sm"}
        aria-label={label}
      >
        {icon}
        {folded ? null : label}
      </Button>
    </Tip>
  );
}
