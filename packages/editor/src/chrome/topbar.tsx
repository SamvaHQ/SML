import { useEffect, useRef, type ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";

import { useEditorStore } from "../state/context";
import { BrandChip, type EditorBrandSource } from "./brand-chip";
import { ChevronLeft, Download, Eye } from "./editor-icons";
import { downloadEmailHtml } from "./export-html";
import { IconBtn } from "./ui";
import { chromePrimary, cn, focusRing } from "./ui-classes";

export interface TopBarActions {
  readonly leading?: ReactNode | undefined;
  readonly extraActions?: ReactNode | undefined;
  readonly onBack?: (() => void) | undefined;
  readonly onUndo?: (() => void) | undefined;
  readonly onRedo?: (() => void) | undefined;
  readonly canUndo?: boolean | undefined;
  readonly canRedo?: boolean | undefined;
  readonly onPreview?: (() => void) | undefined;
  readonly onLifecycle?: (() => void) | undefined;
  /** Host-owned controls rendered beside the document name in place of the static channel badge. */
  readonly channelSwitcher?: ReactNode | undefined;
  /** Show an "Export HTML" button that downloads the rendered document, client-side. */
  readonly exportEnabled?: boolean | undefined;
  readonly onExport?: (() => void) | undefined;
  /** Allow the host to hide the metadata rename affordance when its writer has no metadata path. */
  readonly renameEnabled?: boolean | undefined;
  /** Host brand facts; the chip beside the document name shows the brand the theme imports. */
  readonly brand?: EditorBrandSource | undefined;
  /** Writes the default brand import into the theme and saves a version. */
  readonly onUseDefaultBrand?: (() => Promise<void>) | undefined;
}

/** A stable empty list, so a document with no fixtures never mints a fresh snapshot. */
const NO_FIXTURES: ReadonlyArray<string> = [];

/**
 * Which declared fixture the canvas is rendering. Switching re-renders the same
 * revision through the host, so it changes what is on screen and never the
 * template. Hidden when the host cannot re-render, or the template declares only
 * one input.
 */
function FixturePicker() {
  const { doc, fixtures, fixture, busy, available } = useEditorStore(
    useShallow((state) => ({
      doc: state.doc,
      fixtures: state.doc?.fixtures ?? NO_FIXTURES,
      fixture: state.doc?.fixture ?? null,
      busy: state.fixtureBusy,
      available: state.fixtureCapability?.status === "ready",
    })),
  );
  const { viewFixture } = useEditorStore((state) => state.actions);
  if (!available) return null;
  const showPicker = fixture !== null && fixtures.length >= 2;
  if (doc !== null && !showPicker) return null;
  return (
    <div className="w-[116px] shrink-0" data-testid="topbar.fixture-slot">
      {showPicker && (
        <label className="text-muted-foreground flex items-center text-[12px]">
          <span className="sr-only">Fixture</span>
          <select
            data-testid="topbar.fixture"
            value={fixture}
            disabled={busy}
            onChange={(event) => viewFixture(event.target.value)}
            title="Render another declared fixture"
            className={cn(
              "border-border bg-background text-foreground h-[30px] w-full rounded-[7px] border px-2 text-[12px] outline-none",
              focusRing,
            )}
          >
            {fixtures.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}

export function TopBar({
  leading,
  extraActions,
  onBack,
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
  onPreview,
  onLifecycle,
  channelSwitcher,
  exportEnabled,
  onExport,
  renameEnabled = true,
  brand,
  onUseDefaultBrand,
}: TopBarActions) {
  const {
    doc,
    render,
    pendingAuthoredSource,
    lifecycleCapability,
    editable,
    readonlyReason,
    renameActive,
    metadataError,
    layoutMode,
  } = useEditorStore(
    useShallow((state) => ({
      doc: state.doc,
      render: state.render,
      pendingAuthoredSource: state.pendingAuthoredSource,
      lifecycleCapability: state.lifecycleCapability,
      editable: state.editable,
      readonlyReason: state.readonlyReason,
      renameActive: state.renameActive,
      metadataError: state.metadataError,
      layoutMode: state.layoutMode,
    })),
  );
  const { rename, setRenameActive } = useEditorStore((state) => state.actions);
  const nameRef = useRef<HTMLSpanElement>(null);
  const name = doc?.name ?? "Untitled template";

  // Select the whole name when a rename starts (topbar rename button or a click).
  useEffect(() => {
    if (renameActive && nameRef.current) {
      nameRef.current.focus();
      const range = document.createRange();
      range.selectNodeContents(nameRef.current);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
  }, [renameActive]);

  // Export ships the render on screen, so it waits for one that matches the
  // authored source the editor currently holds.
  const canExport =
    exportEnabled === true &&
    doc?.channel === "email" &&
    render !== null &&
    pendingAuthoredSource === null;
  const compact = layoutMode === "compact" || layoutMode === "narrow";
  const standard = layoutMode === "standard";
  const handleExport = () => {
    if (!canExport || doc === null || render === null) return;
    downloadEmailHtml(render.html, doc.name);
    onExport?.();
  };

  return (
    <header
      className={cn(
        "z-30 flex min-w-0 flex-col border-b border-border bg-background/92 px-3 backdrop-blur-md",
        compact ? "h-[92px]" : "h-12",
      )}
    >
      <div className="flex h-12 min-w-0 shrink-0 items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-1">
          {leading !== undefined && <div className="mr-1 shrink-0">{leading}</div>}
          {onBack !== undefined && (
            <>
              <IconBtn
                title="Back to templates"
                className="gap-1.5"
                onClick={onBack}
                testId="topbar.back"
              >
                <ChevronLeft className="size-[15px]" />
                Templates
              </IconBtn>
              <div className="bg-border mx-1 h-[18px] w-px" />
            </>
          )}
          <div className="flex min-w-0 items-center gap-2">
            <span
              ref={nameRef}
              data-testid="topbar.name"
              contentEditable={editable && renameEnabled}
              suppressContentEditableWarning
              spellCheck={false}
              title={
                editable && renameEnabled
                  ? "Click to rename"
                  : (readonlyReason ?? "This template name is fixed.")
              }
              className={cn(
                "min-w-[128px] max-w-[280px] truncate rounded-md border border-transparent px-[7px] py-[3px] text-[13.5px] font-medium outline-none",
                "hover:bg-muted focus-visible:bg-background",
                focusRing,
              )}
              onFocus={() => {
                if (editable && renameEnabled) setRenameActive(true);
              }}
              onBlur={(event) => {
                if (!editable || !renameEnabled) return;
                setRenameActive(false);
                rename(event.currentTarget.textContent ?? "");
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  event.currentTarget.blur();
                }
                if (event.key === "Escape") {
                  event.currentTarget.textContent = name;
                  event.currentTarget.blur();
                }
              }}
            >
              {name}
            </span>
            {metadataError !== null && (
              <span role="alert" className="text-status-error truncate text-[11.5px]">
                {metadataError}
              </span>
            )}
            {channelSwitcher === undefined ? (
              <span className="border-border-subtle bg-surface-inset text-muted-foreground inline-flex items-center rounded-md border px-2 py-0.5 text-[10.5px] font-medium tracking-[0.04em] uppercase">
                {doc?.channel ?? "Template"}
              </span>
            ) : (
              <div
                className={cn(
                  "min-w-0 shrink-0",
                  compact && "[&_[data-channel-button]]:px-1.5 [&_[data-channel-label]]:hidden",
                )}
              >
                {channelSwitcher}
              </div>
            )}
            {!editable && doc !== null && (
              <span
                title={readonlyReason ?? "This template is read-only."}
                data-testid="topbar.readonly-badge"
                className="border-border-subtle bg-surface-inset text-muted-foreground inline-flex items-center rounded-md border px-2 py-0.5 text-[10.5px] font-medium"
              >
                Read-only
              </span>
            )}
            {brand !== undefined && doc?.channel === "email" && (
              <BrandChip source={brand} onUseDefault={onUseDefaultBrand} />
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-1">
          {!compact && onUndo !== undefined && (
            <IconBtn
              title="Undo"
              testId="topbar.undo"
              onClick={onUndo}
              disabled={!canUndo}
              className="h-[30px] px-2.5"
            >
              Undo
            </IconBtn>
          )}
          {!compact && onRedo !== undefined && (
            <IconBtn
              title="Redo"
              testId="topbar.redo"
              onClick={onRedo}
              disabled={!canRedo}
              className="h-[30px] px-2.5"
            >
              Redo
            </IconBtn>
          )}
          {!compact && <FixturePicker />}
          {!compact && <div className="bg-border mx-1 h-[18px] w-px" />}
          {!compact && (
            <IconBtn
              title="Preview template"
              testId="topbar.preview"
              onClick={onPreview}
              className="h-[30px] px-2.5"
            >
              <Eye className="size-[15px]" />
              {standard ? null : "Preview"}
            </IconBtn>
          )}
          {exportEnabled === true && !compact && (
            <IconBtn
              title={canExport ? "Export rendered HTML" : "Export waits for the latest render"}
              testId="topbar.export"
              onClick={handleExport}
              disabled={!canExport}
              className="h-[30px] px-2.5"
            >
              <Download className="size-[15px]" />
              {standard ? null : "Export HTML"}
            </IconBtn>
          )}
          {!compact && extraActions}
          {!compact && editable && lifecycleCapability !== undefined && (
            <button
              type="button"
              onClick={onLifecycle}
              data-testid="topbar.publish"
              title={
                lifecycleCapability.status === "locked"
                  ? lifecycleCapability.upsell.reason
                  : "Publish and view history"
              }
              className={cn(chromePrimary, "ml-0.5 h-[30px] px-3")}
            >
              Publish
            </button>
          )}
        </div>
      </div>

      {compact && (
        <div className="samva-editor-scroll border-border-subtle flex h-11 min-w-0 items-center gap-1 overflow-x-auto border-t">
          {extraActions}
          {onUndo !== undefined && (
            <IconBtn
              title="Undo"
              testId="topbar.undo"
              onClick={onUndo}
              disabled={!canUndo}
              className="h-10 shrink-0 px-2"
            >
              Undo
            </IconBtn>
          )}
          {onRedo !== undefined && (
            <IconBtn
              title="Redo"
              testId="topbar.redo"
              onClick={onRedo}
              disabled={!canRedo}
              className="h-10 shrink-0 px-2"
            >
              Redo
            </IconBtn>
          )}
          <FixturePicker />
          <IconBtn
            title="Preview template"
            testId="topbar.preview"
            onClick={onPreview}
            className="h-10 shrink-0 px-2"
          >
            <Eye className="size-[15px]" />
            Preview
          </IconBtn>
          {exportEnabled === true && (
            <IconBtn
              title={canExport ? "Export rendered HTML" : "Export waits for the latest render"}
              testId="topbar.export"
              onClick={handleExport}
              disabled={!canExport}
              className="h-10 shrink-0 px-2"
            >
              <Download className="size-[15px]" />
              Export
            </IconBtn>
          )}
          {editable && lifecycleCapability !== undefined && (
            <button
              type="button"
              onClick={onLifecycle}
              data-testid="topbar.publish"
              title={
                lifecycleCapability.status === "locked"
                  ? lifecycleCapability.upsell.reason
                  : "Publish and view history"
              }
              className={cn(chromePrimary, "h-10 shrink-0 px-2.5")}
            >
              Publish
            </button>
          )}
        </div>
      )}
    </header>
  );
}
