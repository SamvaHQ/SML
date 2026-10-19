import type { ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";

import { cn } from "../lib/utils";
import { useEditorStore } from "../state/context";
import { DEVICE_WIDTH } from "../state/store";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { NativeSelect, NativeSelectOption } from "../ui/native-select";
import { Mobile, Monitor, MoreHorizontal, OpenExternal, Refresh } from "./editor-icons";
import { usePart, type PartProps } from "./part";
import { usePreviewChrome } from "./preview-context";
import { Segmented, Tip } from "./ui";
import { VersionPicker } from "./version-picker";

/** A stable empty list, so a document with no fixtures never mints a fresh snapshot. */
const NO_FIXTURES: ReadonlyArray<string> = [];

/**
 * Which declared fixture the preview shows. Switching shows the same draft with other sample
 * data, so it changes what is on screen and never the template. Hidden when the host cannot
 * switch or the template declares one input. The email preview bar carries it; the message
 * channels show it in the toolbar.
 */
export function FixtureSelect({
  testId,
  className,
}: {
  readonly testId: string;
  readonly className?: string | undefined;
}) {
  const { fixtures, fixture, busy, available } = useEditorStore(
    useShallow((state) => ({
      fixtures: state.doc?.fixtures ?? NO_FIXTURES,
      fixture: state.doc?.fixture ?? null,
      busy: state.fixtureBusy,
      available: state.fixtureCapability?.status === "ready",
    })),
  );
  const { viewFixture } = useEditorStore((state) => state.actions);
  if (!available || fixture === null || fixtures.length < 2) return null;
  return (
    <Tip label="Sample data the preview shows">
      {/* A select draws no ::after, so its wrapper carries the touch target. */}
      <span data-editor-control="" className="inline-flex min-w-0">
        <NativeSelect
          size="sm"
          aria-label="Fixture"
          data-slot="editor-fixture-select"
          data-testid={testId}
          value={fixture}
          disabled={busy}
          onChange={(event) => viewFixture(event.target.value)}
          className={cn("max-w-40 min-w-0 [&_select]:text-xs [&_select]:font-medium", className)}
        >
          {fixtures.map((name) => (
            <NativeSelectOption key={name} value={name}>
              {name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </span>
    </Tip>
  );
}

/**
 * The size of what the author is looking at. A host that knows the size of the email as sent
 * reports it; without one, the readout says it measures the preview, which can be larger.
 */
function useSizeReadout(): { readonly text: string; readonly help: string } {
  const { sizeKb, sizeSource, deviceWidth, rendered } = useEditorStore(
    useShallow((state) => ({
      sizeKb: state.sizeKb,
      sizeSource: state.sizeSource,
      deviceWidth: DEVICE_WIDTH[state.previewDevice],
      rendered: state.render !== null,
    })),
  );
  // Without a preview there is nothing to weigh; a 0 KB readout would read as an empty email.
  if (!rendered) return { text: `${deviceWidth} px`, help: "Width shown" };
  return sizeSource === "sent"
    ? {
        text: `${deviceWidth} px · ${sizeKb} KB`,
        help: "Width shown, and the size of the email as sent",
      }
    : {
        text: `${deviceWidth} px · ${sizeKb} KB preview`,
        help: "Width shown, and the size of this preview. The email as sent can be smaller.",
      };
}

/** The state an `EditorPreviewBar` exposes. */
export interface PreviewBarState extends Record<string, unknown> {
  /** A new preview is on its way: the host is working, an edit is unanswered, or a refresh. */
  readonly busy: boolean;
}

/**
 * The bar above the email canvas: which version and sample data the preview shows, at which
 * width, how large it is, and the controls to open or refresh it, on one row of 28px controls.
 * A thin line runs along its bottom while a new preview is on its way. Below 28rem of pane width
 * it folds the size readout and Open in a new tab into its menu; `viewMenu` adds menu rows (the
 * work pane's views, on a phone).
 */
export function EditorPreviewBar({
  viewMenu,
  ...props
}: PartProps<"div", PreviewBarState> & {
  /** Extra rows for the bar's menu, which then shows at every width. */
  readonly viewMenu?: ReactNode | undefined;
}) {
  const { device, working, canRefresh } = useEditorStore(
    useShallow((state) => ({
      device: state.previewDevice,
      working: state.fixtureBusy || state.pendingAuthoredSource !== null || state.previewRefreshing,
      canRefresh:
        state.doc !== null &&
        state.pendingAuthoredSource === null &&
        !state.metadataSaving &&
        !state.conflict &&
        !state.lifecycleBusy,
    })),
  );
  const { setPreviewDevice, refreshPreview } = useEditorStore((state) => state.actions);
  const { hostBusy, openInNewTab } = usePreviewChrome();
  const size = useSizeReadout();
  const busy = working || hostBusy;

  return usePart<PreviewBarState>(
    "editor-preview-bar",
    { "data-testid": "preview-bar", ...props },
    {
      state: { busy },
      className:
        "border-border bg-background @container/preview-bar relative flex h-11 shrink-0 items-center gap-1.5 border-b px-2",
      props: {
        children: (
          <>
            <VersionPicker />
            <div
              data-slot="editor-preview-bar-center"
              className="flex min-w-0 flex-1 items-center justify-center gap-1.5"
            >
              <Segmented
                ariaLabel="Preview width"
                value={device}
                onChange={setPreviewDevice}
                size="sm"
                options={[
                  {
                    value: "desktop",
                    title: "Desktop width",
                    testId: "canvas.device.desktop",
                    label: <Monitor className="size-3.5" />,
                  },
                  {
                    value: "mobile",
                    title: "Phone width",
                    testId: "canvas.device.mobile",
                    label: <Mobile className="size-3.5" />,
                  },
                ]}
              />
              <FixtureSelect testId="preview-bar.fixture" />
            </div>
            <Tip label={size.help}>
              <span
                tabIndex={0}
                data-slot="editor-preview-bar-size"
                data-testid="preview-bar.size"
                className="text-muted-foreground focus-visible:ring-ring/50 shrink-0 rounded-md px-1.5 text-xs leading-7 tabular-nums outline-none focus-visible:ring-3 @max-[28rem]/preview-bar:hidden"
              >
                {size.text}
              </span>
            </Tip>
            {openInNewTab !== undefined && (
              <span className="inline-flex @max-[28rem]/preview-bar:hidden">
                <Tip label="Open in a new tab">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Open in a new tab"
                    data-testid="preview-bar.open"
                    data-editor-control=""
                    onClick={openInNewTab}
                    className="text-muted-foreground"
                  >
                    <OpenExternal />
                  </Button>
                </Tip>
              </span>
            )}
            <Tip label={canRefresh ? "Refresh the preview" : "Refresh waits for your latest edit"}>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Refresh the preview"
                data-testid="preview-bar.refresh"
                data-editor-control=""
                disabled={!canRefresh}
                onClick={refreshPreview}
                className="text-muted-foreground"
              >
                <Refresh />
              </Button>
            </Tip>
            {/* Display lives on a wrapper: the button recipe sets its own. */}
            <span
              className={cn(
                "inline-flex",
                viewMenu === undefined && "hidden @max-[28rem]/preview-bar:inline-flex",
              )}
            >
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="More preview options"
                      data-testid="preview-bar.more"
                      data-editor-control=""
                      className="text-muted-foreground"
                    />
                  }
                >
                  <MoreHorizontal />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-60">
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>Preview</DropdownMenuLabel>
                    <div className="text-muted-foreground px-1.5 pb-1.5 text-xs tabular-nums">
                      {size.text}
                    </div>
                    {openInNewTab !== undefined && (
                      <DropdownMenuItem data-editor-control="" onClick={openInNewTab}>
                        <OpenExternal />
                        Open in a new tab
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuGroup>
                  {viewMenu !== undefined && (
                    <>
                      <DropdownMenuSeparator />
                      {viewMenu}
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </span>
            {busy && (
              <span
                role="progressbar"
                aria-label="Updating the preview"
                data-slot="editor-preview-bar-progress"
                data-testid="preview-bar.progress"
                className="pointer-events-none absolute inset-x-0 -bottom-px h-0.5 overflow-hidden"
              >
                <span className="samva-editor-progress bg-primary absolute inset-y-0 w-2/5" />
              </span>
            )}
          </>
        ),
      },
    },
  );
}

/**
 * One line under the preview bar when the preview on screen is not the latest draft: the last
 * preview that worked is kept, and the reason sits beside a way to the checks.
 */
export function PreviewNotice() {
  const { stale, fixtureError } = useEditorStore(
    useShallow((state) => ({
      stale:
        state.doc?.channel === "email" && state.doc.preview.status === "stale"
          ? state.doc.preview.reason
          : null,
      fixtureError: state.fixtureError,
    })),
  );
  const { showChecks } = usePreviewChrome();
  const message =
    stale !== null
      ? `Showing the last preview that worked. Your latest edit has a problem: ${stale}`
      : fixtureError;
  if (message === null) return null;
  return (
    <div
      role="status"
      data-slot="editor-preview-notice"
      data-testid={stale !== null ? "canvas.preview-stale" : "canvas.fixture-error"}
      className="border-status-warning/35 bg-status-warning/10 text-foreground flex min-h-9 shrink-0 items-center gap-2 border-b px-3 py-1.5 text-xs"
    >
      <span className="bg-status-warning size-1.5 shrink-0 rounded-full" />
      <span className="min-w-0 flex-1">{message}</span>
      {stale !== null && showChecks !== undefined && (
        <Button
          variant="outline"
          size="sm"
          onClick={showChecks}
          data-testid="canvas.preview-stale.checks"
          data-editor-control=""
          className="bg-background shrink-0"
        >
          Show checks
        </Button>
      )}
    </div>
  );
}
