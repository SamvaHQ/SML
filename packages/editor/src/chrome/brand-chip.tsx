import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
} from "react";

import { useEditorStore } from "../state/context";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Check, ChevronDown, Palette } from "./editor-icons";
import {
  brandChipView,
  themeBrandImport,
  type EditorBrand,
  type EditorProjectTheme,
  type ThemeBrandImport,
} from "./theme-brand";
import { chipClass, chipTriggerClass, cn } from "./ui-classes";

/**
 * Host-owned brand facts for the topbar chip. The host owns the organization's
 * brands and navigation; the editor reads the theme through `readTheme` after
 * every revision and writes the chosen brand's import into `theme.css` through
 * the host's `lifecycle` and `versions` capabilities.
 */
export interface EditorBrandSource {
  /** The project's `theme.css` and whether it holds a `starter.css`, from the open draft. */
  readonly readTheme: () => Promise<EditorProjectTheme>;
  /** The organization's brands; null while they load. */
  readonly brands: ReadonlyArray<EditorBrand> | null;
  /**
   * Where the organization manages its brands, offered as "Manage brands" in the chip's menu;
   * omit to hide the row. `navigate` replaces a full page load on a plain click.
   */
  readonly manageLink?:
    | (() => {
        readonly href: string;
        readonly navigate?: (() => void) | undefined;
      })
    | undefined;
  /** Host-owned node beside the chip, for a standing fact about the brand. */
  readonly status?: ReactNode | undefined;
}

const plainClick = (event: MouseEvent) =>
  event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;

function Swatch({ brand }: { readonly brand: EditorBrand | null }) {
  if (brand?.color === undefined) return <Palette className="size-3.5 shrink-0" />;
  const style: CSSProperties = { backgroundColor: brand.color };
  return (
    <span
      aria-hidden="true"
      data-slot="editor-brand-swatch"
      style={style}
      className="ring-foreground/15 size-3 shrink-0 rounded-full ring-1"
    />
  );
}

/**
 * The brand the project's theme imports, as one chip with a menu: the organization's brands to
 * switch to (a check marks the current one, a tag marks the default), and the host's "Manage
 * brands" link. `onUseBrand` writes the import and saves.
 */
export function BrandChip({
  source,
  onUseBrand,
}: {
  readonly source: EditorBrandSource;
  readonly onUseBrand?: ((brand: EditorBrand) => Promise<void>) | undefined;
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
  const [using, setUsing] = useState<{
    readonly state: "idle" | "busy" | "error";
    readonly name: string;
  }>({ state: "idle", name: "" });

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

  if (view.kind === "pending") {
    // The chip holds its place while the theme and brands load, so the top bar does not move
    // when the answer lands.
    return (
      <div className="flex min-w-0 shrink items-center gap-1">
        <span data-testid="topbar.brand-pending" aria-busy="true" className={chipClass}>
          <Palette className="size-3.5 shrink-0" />
          <span className="truncate">Brand</span>
        </span>
        {source.status}
      </div>
    );
  }

  const current = view.kind === "brand" ? view.brand : null;
  const defaultBrand = view.kind === "none" ? view.defaultBrand : null;
  // The organization's default leads the list; the rest keep the host's order.
  const choices =
    defaultBrand === null
      ? view.brands
      : [defaultBrand, ...view.brands.filter(({ slug }) => slug !== defaultBrand.slug)];
  const applied = view.kind === "brand";
  const choose =
    canWrite && onUseBrand !== undefined
      ? (brand: EditorBrand) => {
          setUsing({ state: "busy", name: brand.name });
          onUseBrand(brand).then(
            () => setUsing({ state: "idle", name: brand.name }),
            () => setUsing({ state: "error", name: brand.name }),
          );
        }
      : undefined;
  const manage = source.manageLink?.();
  const hasMenu = choices.length > 0 || manage !== undefined;

  let label = "No brand";
  let testId = "topbar.brand-none";
  let title: string | undefined;
  if (view.kind === "brand") {
    label = view.brand.name;
    testId = "topbar.brand";
    title = `Brand: ${view.brand.name}`;
  } else if (view.kind === "missing") {
    label = "Brand not found";
    testId = "topbar.brand-missing";
    title =
      view.slug === null
        ? "This organization has no default brand."
        : `This organization has no brand “${view.slug}”.`;
  }
  const busy = using.state === "busy";

  const content = (
    <>
      <Swatch brand={current} />
      <span className="truncate">{label}</span>
    </>
  );
  const toneClass = view.kind === "missing" ? "text-status-warning" : undefined;

  return (
    <div className="flex min-w-0 shrink items-center gap-1">
      {hasMenu ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            data-testid={testId}
            data-editor-control=""
            aria-label={title ?? label}
            title={title}
            aria-busy={busy || undefined}
            className={cn(chipTriggerClass, toneClass)}
          >
            {content}
            <ChevronDown className="size-3 shrink-0" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56" data-testid="topbar.brand-menu">
            {choices.length > 0 && (
              <DropdownMenuGroup>
                {!applied && <DropdownMenuLabel>Apply a brand</DropdownMenuLabel>}
                {choices.map((brand) => {
                  const isCurrent = current?.slug === brand.slug;
                  // The default row of an unthemed template is the one-click choice.
                  const isUse = !applied && brand.slug === defaultBrand?.slug;
                  return (
                    <DropdownMenuItem
                      key={brand.slug}
                      data-testid={isUse ? "topbar.brand-use" : `topbar.brand-option.${brand.slug}`}
                      aria-current={isCurrent || undefined}
                      disabled={choose === undefined || busy}
                      onClick={() => {
                        if (!isCurrent) choose?.(brand);
                      }}
                    >
                      <Swatch brand={brand} />
                      <span className="min-w-0 flex-1 truncate">{brand.name}</span>
                      {brand.isDefault && brand.name.trim().toLowerCase() !== "default" && (
                        <span
                          data-slot="editor-brand-default-tag"
                          className="text-muted-foreground shrink-0 text-xs"
                        >
                          Default
                        </span>
                      )}
                      {isCurrent && <Check className="text-muted-foreground size-3.5" />}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuGroup>
            )}
            {manage !== undefined && (
              <>
                {choices.length > 0 && <DropdownMenuSeparator />}
                <DropdownMenuItem
                  data-testid="topbar.brand-manage"
                  render={<a href={manage.href} />}
                  onClick={(event) => {
                    if (manage.navigate === undefined || !plainClick(event)) return;
                    event.preventDefault();
                    manage.navigate();
                  }}
                >
                  Manage brands
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <span data-testid={testId} title={title} className={cn(chipClass, toneClass)}>
          {content}
        </span>
      )}
      {using.state === "error" && (
        <span role="alert" className="text-status-error truncate text-xs">
          Couldn’t use {using.name}
        </span>
      )}
      {source.status}
    </div>
  );
}
