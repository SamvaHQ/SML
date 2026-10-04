import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";

import { useEditorStore } from "../state/context";
import { Palette } from "./editor-icons";
import {
  brandChipView,
  themeBrandImport,
  type EditorBrand,
  type EditorProjectTheme,
  type ThemeBrandImport,
} from "./theme-brand";
import { cn, focusRing } from "./ui-classes";

/**
 * Host-owned brand facts for the topbar chip. The host owns the organization's
 * brands and navigation; the editor reads the theme through `readTheme` after
 * every revision and never edits a brand.
 */
export interface EditorBrandSource {
  /** The project's `theme.css` and whether it holds a `starter.css`, from the open draft. */
  readonly readTheme: () => Promise<EditorProjectTheme>;
  /** The organization's brands; null while they load. */
  readonly brands: ReadonlyArray<EditorBrand> | null;
  /** Where a brand's page lives. `navigate` replaces a full page load on a plain click. */
  readonly brandLink: (slug: string) => {
    readonly href: string;
    readonly navigate?: (() => void) | undefined;
  };
  /** Host-owned node beside the chip, for a standing fact about the brand. */
  readonly status?: ReactNode | undefined;
}

const chipClass = cn(
  "border-border-subtle bg-surface-inset text-muted-foreground inline-flex h-[22px] min-w-0 max-w-[180px] items-center gap-1 rounded-md border px-2 text-[11.5px] font-medium outline-none",
  focusRing,
);

const plainClick = (event: MouseEvent) =>
  event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;

/**
 * The brand the project's theme imports, linking to that brand's page. With no
 * import it says so and, when the editor can save, offers the organization's
 * default brand in one click; `onUseDefault` writes the import and saves.
 */
export function BrandChip({
  source,
  onUseDefault,
}: {
  readonly source: EditorBrandSource;
  readonly onUseDefault?: (() => Promise<void>) | undefined;
}) {
  const revision = useEditorStore((state) => state.doc?.rev ?? null);
  const canWrite = useEditorStore(
    (state) => state.editable && state.lifecycleCapability?.status === "ready",
  );
  const readTheme = useRef(source.readTheme);
  useEffect(() => {
    readTheme.current = source.readTheme;
  });
  const [imported, setImported] = useState<ThemeBrandImport | null | undefined>(undefined);
  const [using, setUsing] = useState<"idle" | "busy" | "error">("idle");

  // Every revision can change the theme (an agent edit, a restore, this chip's own write). The
  // last answer stays on screen until the next one lands.
  useEffect(() => {
    if (revision === null) return;
    let cancelled = false;
    readTheme.current().then(
      (theme) => {
        if (!cancelled) setImported(themeBrandImport(theme.theme ?? ""));
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [revision]);

  const view = brandChipView(imported, source.brands);
  if (view.kind === "pending") return source.status ?? null;

  let chip: ReactNode;
  if (view.kind === "brand") {
    const { name, slug } = view.brand;
    const link = source.brandLink(slug);
    chip = (
      <a
        href={link.href}
        aria-label={`Brand: ${name}`}
        title={`Open ${name}`}
        data-testid="topbar.brand"
        onClick={(event) => {
          if (link.navigate === undefined || !plainClick(event)) return;
          event.preventDefault();
          link.navigate();
        }}
        className={cn(chipClass, "hover:bg-muted hover:text-foreground")}
      >
        <Palette className="size-3.5 shrink-0" />
        <span className="truncate">{name}</span>
      </a>
    );
  } else if (view.kind === "missing") {
    chip = (
      <span
        data-testid="topbar.brand-missing"
        title={
          view.slug === null
            ? "This organization has no default brand."
            : `This organization has no brand “${view.slug}”.`
        }
        className={cn(chipClass, "text-status-warning")}
      >
        <Palette className="size-3.5 shrink-0" />
        <span className="truncate">Brand not found</span>
      </span>
    );
  } else {
    const defaultBrand = view.defaultBrand;
    const applyDefault =
      canWrite && onUseDefault !== undefined && defaultBrand !== null
        ? () => {
            setUsing("busy");
            onUseDefault().then(
              () => setUsing("idle"),
              () => setUsing("error"),
            );
          }
        : undefined;
    chip = (
      <>
        <span data-testid="topbar.brand-none" className={chipClass}>
          <Palette className="size-3.5 shrink-0" />
          <span className="truncate">No brand</span>
        </span>
        {applyDefault !== undefined && defaultBrand !== null && (
          <button
            type="button"
            data-testid="topbar.brand-use"
            onClick={applyDefault}
            disabled={using === "busy"}
            aria-busy={using === "busy"}
            title={`Theme this template with ${defaultBrand.name}`}
            className={cn(
              "text-foreground hover:bg-muted inline-flex h-[22px] max-w-[180px] items-center rounded-md px-1.5 text-[11.5px] font-medium outline-none disabled:opacity-50",
              focusRing,
            )}
          >
            <span className="truncate">Use {defaultBrand.name}</span>
          </button>
        )}
        {using === "error" && defaultBrand !== null && (
          <span role="alert" className="text-status-error truncate text-[11.5px]">
            Couldn’t use {defaultBrand.name}
          </span>
        )}
      </>
    );
  }

  return (
    <div className="flex min-w-0 shrink items-center gap-1">
      {chip}
      {source.status}
    </div>
  );
}
