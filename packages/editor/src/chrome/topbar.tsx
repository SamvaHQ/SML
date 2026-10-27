import { useEffect, useRef, type ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";

import { cn } from "../lib/utils";
import { useEditorStore } from "../state/context";
import type { EditorLayoutMode } from "../state/store";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Separator } from "../ui/separator";
import { BrandChip, type EditorBrandSource } from "./brand-chip";
import { useContribution } from "./contributions";
import { ChevronLeft, Download, Eye, MoreHorizontal } from "./editor-icons";
import { downloadEmailHtml } from "./export-html";
import { EditorPaneSwitch } from "./pane-switch";
import { usePart, type PartProps } from "./part";
import { FixtureSelect } from "./preview-bar";
import type { EditorBrand } from "./theme-brand";
import { Tip } from "./ui";
import { chipClass } from "./ui-classes";

/** The state an `EditorTopBar` exposes. */
export interface TopBarState extends Record<string, unknown> {
  /** The layout the editor frame's width resolved to. */
  readonly layout: EditorLayoutMode;
}

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
  /** Writes the chosen brand's import into the theme and saves a version. */
  readonly onUseBrand?: ((brand: EditorBrand) => Promise<void>) | undefined;
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
  onUseBrand,
  part,
}: TopBarActions & {
  /** The part's own props: `className`, `render` and attributes from the host. */
  readonly part?: PartProps<"header", TopBarState> | undefined;
}) {
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
  // An email shows its fixture in the preview bar; the message channels have no preview bar.
  const messageChannel = doc !== null && doc.channel !== "email";
  // The shell opens on the email workspace before the document arrives, so the email chrome is
  // drawn from mount and the bar keeps its geometry when the document lands.
  const emailChrome = !messageChannel;
  const handleExport = () => {
    if (!canExport || doc === null || render === null) return;
    downloadEmailHtml(render.html, doc.name);
    onExport?.();
  };

  const docked = useContribution("rail.assistant") !== undefined;
  const narrow = layoutMode === "narrow";
  // Undo, Redo, Preview and Export fold into one menu once the bar cannot hold them as buttons.
  const folded = compact;
  const canPublish =
    lifecycleCapability?.status === "ready" && lifecycleCapability.api.publish !== undefined;
  const lifecycle =
    editable && lifecycleCapability !== undefined ? (
      <Tip
        label={
          lifecycleCapability.status === "locked"
            ? lifecycleCapability.upsell.reason
            : canPublish
              ? "Publish and view history"
              : "View saved versions"
        }
      >
        <Button
          variant={canPublish ? "default" : "ghost"}
          size="sm"
          onClick={onLifecycle}
          data-testid={canPublish ? "topbar.publish" : "topbar.history"}
          data-editor-control=""
        >
          {canPublish ? "Publish" : "Saved versions"}
        </Button>
      </Tip>
    ) : null;

  return usePart<TopBarState>(
    "editor-top-bar",
    { ...part },
    {
      state: { layout: layoutMode },
      tag: "header",
      className:
        "border-border bg-background z-30 flex h-12 min-w-0 shrink-0 items-center gap-2 border-b px-3",
      props: {
        children: (
          <>
            <div
              data-slot="editor-top-bar-title"
              className="flex min-w-0 flex-1 items-center gap-1.5"
            >
              {leading !== undefined && <div className="shrink-0">{leading}</div>}
              {onBack !== undefined && (
                <>
                  <Tip label="Back to templates">
                    <Button
                      variant="ghost"
                      size={narrow ? "icon-sm" : "sm"}
                      onClick={onBack}
                      aria-label="Back to templates"
                      data-testid="topbar.back"
                      data-editor-control=""
                      className="text-muted-foreground"
                    >
                      <ChevronLeft />
                      {narrow ? null : "Templates"}
                    </Button>
                  </Tip>
                  <Separator orientation="vertical" className="mx-0.5 h-4!" />
                </>
              )}
              <span
                ref={nameRef}
                data-testid="topbar.name"
                data-slot="editor-top-bar-name"
                contentEditable={editable && renameEnabled}
                suppressContentEditableWarning
                spellCheck={false}
                title={
                  editable && renameEnabled
                    ? "Click to rename"
                    : (readonlyReason ?? "This template name is fixed.")
                }
                className={cn(
                  "min-w-0 truncate rounded-md px-1.5 py-1 text-sm font-medium whitespace-nowrap outline-none",
                  narrow ? "max-w-full" : "max-w-72 min-w-24",
                  "hover:bg-muted focus-visible:ring-ring/50 focus-visible:bg-background focus-visible:ring-3",
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
                <span role="alert" className="text-destructive truncate text-xs">
                  {metadataError}
                </span>
              )}
              {narrow ? null : channelSwitcher === undefined ? (
                <span data-slot="editor-top-bar-channel" className={cn(chipClass, "capitalize")}>
                  {doc?.channel ?? "email"}
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
                <Badge
                  variant="secondary"
                  title={readonlyReason ?? "This template is read-only."}
                  data-testid="topbar.readonly-badge"
                >
                  Read-only
                </Badge>
              )}
              {brand !== undefined && emailChrome && !narrow && (
                <BrandChip source={brand} onUseBrand={onUseBrand} />
              )}
            </div>

            {docked && layoutMode !== "wide" && emailChrome && (
              <EditorPaneSwitch
                compact={narrow}
                className={narrow ? "shrink-0" : "w-56 shrink-0"}
              />
            )}

            <div
              data-slot="editor-top-bar-actions"
              className={cn("flex shrink-0 items-center justify-end gap-1", !folded && "flex-1")}
            >
              {!folded && onUndo !== undefined && (
                <Button
                  variant="ghost"
                  size="sm"
                  data-testid="topbar.undo"
                  data-editor-control=""
                  onClick={onUndo}
                  disabled={!canUndo}
                >
                  Undo
                </Button>
              )}
              {!folded && onRedo !== undefined && (
                <Button
                  variant="ghost"
                  size="sm"
                  data-testid="topbar.redo"
                  data-editor-control=""
                  onClick={onRedo}
                  disabled={!canRedo}
                >
                  Redo
                </Button>
              )}
              {!folded && messageChannel && <FixtureSelect testId="topbar.fixture" />}
              {!folded && <Separator orientation="vertical" className="mx-1 h-4!" />}
              {!narrow && (
                <Tip label="Preview template">
                  <Button
                    variant="ghost"
                    size={standard || folded ? "icon-sm" : "sm"}
                    aria-label="Preview template"
                    data-testid="topbar.preview"
                    data-editor-control=""
                    onClick={onPreview}
                  >
                    <Eye />
                    {standard || folded ? null : "Preview"}
                  </Button>
                </Tip>
              )}
              {!folded && exportEnabled === true && (
                <Tip
                  label={canExport ? "Export rendered HTML" : "Export waits for the latest render"}
                >
                  <Button
                    variant="ghost"
                    size={standard ? "icon-sm" : "sm"}
                    aria-label="Export HTML"
                    data-testid="topbar.export"
                    data-editor-control=""
                    onClick={handleExport}
                    disabled={!canExport}
                  >
                    <Download />
                    {standard ? null : "Export HTML"}
                  </Button>
                </Tip>
              )}
              {!narrow && extraActions}
              {folded && messageChannel && <FixtureSelect testId="topbar.fixture" />}
              {folded && (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="More actions"
                        data-testid="topbar.more"
                        data-editor-control=""
                      />
                    }
                  >
                    <MoreHorizontal />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    {onUndo !== undefined && (
                      <DropdownMenuItem
                        data-testid="topbar.undo"
                        data-editor-control=""
                        disabled={!canUndo}
                        onClick={onUndo}
                      >
                        Undo
                      </DropdownMenuItem>
                    )}
                    {onRedo !== undefined && (
                      <DropdownMenuItem
                        data-testid="topbar.redo"
                        data-editor-control=""
                        disabled={!canRedo}
                        onClick={onRedo}
                      >
                        Redo
                      </DropdownMenuItem>
                    )}
                    {narrow && <DropdownMenuSeparator />}
                    {narrow && (
                      <DropdownMenuItem data-testid="topbar.preview" onClick={onPreview}>
                        <Eye />
                        Preview template
                      </DropdownMenuItem>
                    )}
                    {exportEnabled === true && (
                      <DropdownMenuItem
                        data-testid="topbar.export"
                        data-editor-control=""
                        disabled={!canExport}
                        onClick={handleExport}
                      >
                        <Download />
                        Export HTML
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              {narrow && extraActions}
              {lifecycle}
            </div>
          </>
        ),
      },
    },
  );
}
