import { Menu } from "@base-ui/react/menu";
import { useShallow } from "zustand/react/shallow";

import type { DeviceMode } from "../canvas/device";
import { useEditorStore } from "../state/context";
import { DEVICE_WIDTH } from "../state/store";
import {
  ChevronDown,
  Mobile,
  Monitor,
  MoreHorizontal,
  OpenExternal,
  Refresh,
} from "./editor-icons";
import { usePreviewChrome } from "./preview-context";
import { Segmented, Tip } from "./ui";
import {
  cn,
  focusRing,
  iconButton,
  menuItemClass,
  menuLabelClass,
  menuPopupClass,
  softRaised,
} from "./ui-classes";
import { useEditorPortalContainer } from "./use-editor-portal";
import { VersionPicker } from "./version-picker";

/** A stable empty list, so a document with no fixtures never mints a fresh snapshot. */
const NO_FIXTURES: ReadonlyArray<string> = [];

/**
 * Which declared fixture the preview shows. Switching shows the same draft with other sample
 * data, so it changes what is on screen and never the template. Hidden when the host cannot
 * switch or the template declares one input. The email preview bar carries it; the message
 * channels show it in the toolbar.
 */
export function FixtureSelect({ testId }: { readonly testId: string }) {
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
      <label className="relative inline-flex min-w-0 items-center">
        <span className="sr-only">Fixture</span>
        <select
          data-testid={testId}
          data-editor-control=""
          value={fixture}
          disabled={busy}
          onChange={(event) => viewFixture(event.target.value)}
          className={cn(
            softRaised,
            "h-7 max-w-[10rem] min-w-0 appearance-none truncate rounded-md pr-6 pl-2 text-xs font-medium text-foreground outline-none disabled:opacity-50",
            focusRing,
          )}
        >
          {fixtures.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <ChevronDown className="text-muted-foreground pointer-events-none absolute right-1.5 size-3.5" />
      </label>
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

/**
 * The bar above the email canvas: which version and sample data the preview shows, at which
 * width, how large it is, and the controls to open or refresh it. A thin line runs along its
 * bottom while the host or the editor is producing a new preview. Below 28rem of pane width it
 * folds the size readout and secondary actions into a menu.
 */
export function PreviewBar() {
  const portalContainer = useEditorPortalContainer();
  const { device, working, canRefresh } = useEditorStore(
    useShallow((state) => ({
      device: state.previewDevice,
      working: state.fixtureBusy || state.pendingAuthoredSource !== null || state.previewRefreshing,
      canRefresh:
        state.doc !== null &&
        state.pendingAuthoredSource === null &&
        !state.conflict &&
        !state.lifecycleBusy,
    })),
  );
  const { setPreviewDevice, refreshPreview } = useEditorStore((state) => state.actions);
  const { hostBusy, openInNewTab } = usePreviewChrome();
  const size = useSizeReadout();
  const busy = working || hostBusy;

  return (
    <div
      data-testid="preview-bar"
      data-busy={busy ? "" : undefined}
      className="border-border bg-background @container/preview-bar relative flex h-11 shrink-0 items-center gap-1 border-b px-2"
    >
      <VersionPicker />
      <div className="flex min-w-0 flex-1 items-center justify-center gap-1.5">
        <Segmented
          ariaLabel="Preview width"
          value={device}
          onChange={(value) => setPreviewDevice(value as DeviceMode)}
          size="sm"
          options={[
            {
              value: "desktop",
              title: "Desktop width",
              testId: "canvas.device.desktop",
              label: <Monitor className="size-[13px]" />,
            },
            {
              value: "mobile",
              title: "Phone width",
              testId: "canvas.device.mobile",
              label: <Mobile className="size-[13px]" />,
            },
          ]}
        />
        <FixtureSelect testId="preview-bar.fixture" />
      </div>
      <Tip label={size.help}>
        <span
          tabIndex={0}
          data-testid="preview-bar.size"
          className={cn(
            "text-muted-foreground shrink-0 rounded-md px-1.5 text-xs tabular-nums outline-none @max-[28rem]/preview-bar:hidden",
            focusRing,
          )}
        >
          {size.text}
        </span>
      </Tip>
      {openInNewTab !== undefined && (
        <span className="inline-flex @max-[28rem]/preview-bar:hidden">
          <Tip label="Open in a new tab">
            <button
              type="button"
              aria-label="Open in a new tab"
              data-testid="preview-bar.open"
              data-editor-control=""
              onClick={openInNewTab}
              className={iconButton}
            >
              <OpenExternal className="size-3.5" />
            </button>
          </Tip>
        </span>
      )}
      <Tip label={canRefresh ? "Refresh the preview" : "Refresh waits for your latest edit"}>
        <button
          type="button"
          aria-label="Refresh the preview"
          data-testid="preview-bar.refresh"
          data-editor-control=""
          disabled={!canRefresh}
          onClick={refreshPreview}
          className={iconButton}
        >
          <Refresh className="size-3.5" />
        </button>
      </Tip>
      {/* Display lives on a wrapper: the button recipe sets its own. */}
      <span className="hidden @max-[28rem]/preview-bar:inline-flex">
        <Menu.Root>
          <Menu.Trigger
            aria-label="More preview options"
            data-testid="preview-bar.more"
            data-editor-control=""
            className={iconButton}
          >
            <MoreHorizontal className="size-3.5" />
          </Menu.Trigger>
          <Menu.Portal container={portalContainer}>
            <Menu.Positioner side="bottom" align="end" sideOffset={6} className="z-[120]">
              <Menu.Popup className={cn(menuPopupClass, "w-56")}>
                <div className={menuLabelClass}>Preview</div>
                <div className="text-muted-foreground px-1.5 pb-1.5 text-xs tabular-nums">
                  {size.text}
                </div>
                {openInNewTab !== undefined && (
                  <Menu.Item
                    className={menuItemClass}
                    data-editor-control=""
                    onClick={openInNewTab}
                  >
                    <OpenExternal className="size-3.5" />
                    Open in a new tab
                  </Menu.Item>
                )}
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
      </span>
      {busy && (
        <span
          role="progressbar"
          aria-label="Updating the preview"
          data-testid="preview-bar.progress"
          className="pointer-events-none absolute inset-x-0 -bottom-px h-0.5 overflow-hidden"
        >
          <span className="samva-editor-progress bg-accent-email absolute inset-y-0 w-2/5" />
        </span>
      )}
    </div>
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
      data-testid={stale !== null ? "canvas.preview-stale" : "canvas.fixture-error"}
      className="border-status-warning/35 bg-status-warning/10 text-foreground flex min-h-9 shrink-0 items-center gap-2 border-b px-3 py-1.5 text-xs"
    >
      <span className="bg-status-warning size-1.5 shrink-0 rounded-full" />
      <span className="min-w-0 flex-1">{message}</span>
      {stale !== null && showChecks !== undefined && (
        <button
          type="button"
          onClick={showChecks}
          data-testid="canvas.preview-stale.checks"
          data-editor-control=""
          className={cn(
            softRaised,
            "h-7 shrink-0 rounded-md px-2.5 text-xs font-medium",
            focusRing,
          )}
        >
          Show checks
        </button>
      )}
    </div>
  );
}
