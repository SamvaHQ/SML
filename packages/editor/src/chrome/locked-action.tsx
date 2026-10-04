import { Drawer } from "@base-ui/react/drawer";
import { useState, type ReactNode } from "react";

import type { Upsell } from "../host/types";
import { Xmark } from "./editor-icons";
import { IconBtn } from "./ui";
import { useEditorPortalContainer } from "./use-editor-portal";

export interface LockedActionProps {
  /** The action's name on the toolbar button, such as "Send". */
  readonly label: string;
  /** Drawn before the label. */
  readonly icon?: ReactNode | undefined;
  /** The sheet's heading, such as `Send “Welcome”`. */
  readonly title: string;
  /** Why the action is locked and how to unlock it. The reason also shows on hover. */
  readonly upsell: Upsell;
  /**
   * Runs instead of following the call to action's link, after the reason was shown. Omit to let
   * the link navigate.
   */
  readonly onAction?: (() => void) | undefined;
  readonly testId?: string | undefined;
}

/**
 * A toolbar action a host keeps visible while it is unavailable: the button opens a sheet that
 * says why and offers the way in. Contribute it to `toolbar.actions`.
 */
export function LockedAction({ label, icon, title, upsell, onAction, testId }: LockedActionProps) {
  const [open, setOpen] = useState(false);
  const portalContainer = useEditorPortalContainer();
  return (
    <>
      <IconBtn
        title={label}
        help={upsell.reason}
        testId={testId}
        onClick={() => setOpen(true)}
        className="h-[30px] px-2.5"
      >
        {icon}
        {label}
      </IconBtn>
      <Drawer.Root open={open} onOpenChange={setOpen} swipeDirection="right">
        <Drawer.Portal container={portalContainer}>
          <Drawer.Backdrop className="fixed inset-0 z-[110] bg-[var(--editor-backdrop,rgb(0_0_0/0.28))]" />
          <Drawer.Viewport className="pointer-events-none fixed inset-0 z-[111] flex justify-end">
            <Drawer.Popup className="samva-editor-shell border-border bg-background pointer-events-auto flex h-full w-[420px] max-w-[92vw] flex-col border-l shadow-[var(--shadow-floating)] outline-none">
              <Drawer.Description className="sr-only">{upsell.reason}</Drawer.Description>
              <div className="flex items-center justify-between px-5 pt-4 pb-3">
                <Drawer.Title className="text-[15px] font-semibold">{title}</Drawer.Title>
                <Drawer.Close
                  type="button"
                  aria-label={`Close ${label.toLowerCase()} panel`}
                  data-testid={testId === undefined ? undefined : `${testId}.close`}
                  className="text-muted-foreground hover:bg-muted hover:text-foreground rounded-md p-1.5"
                >
                  <Xmark className="size-[15px]" />
                </Drawer.Close>
              </div>
              <div className="flex min-h-0 flex-1 flex-col items-start gap-4 px-5 pt-6 pb-8">
                <div className="border-border-subtle bg-surface-inset text-muted-foreground rounded-lg border px-3.5 py-3 text-[13px]">
                  {upsell.reason}
                </div>
                <a
                  href={upsell.cta.href}
                  onClick={(event) => {
                    if (onAction === undefined) return;
                    event.preventDefault();
                    onAction();
                  }}
                  data-testid={testId === undefined ? undefined : `${testId}.cta`}
                  className="bg-primary text-primary-foreground inline-flex h-9 items-center rounded-[7px] px-4 font-medium transition-opacity hover:opacity-90"
                >
                  {upsell.cta.label}
                </a>
              </div>
            </Drawer.Popup>
          </Drawer.Viewport>
        </Drawer.Portal>
      </Drawer.Root>
    </>
  );
}
