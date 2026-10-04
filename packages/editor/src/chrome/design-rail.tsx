import { Toggle } from "@base-ui/react/toggle";
import { ToggleGroup } from "@base-ui/react/toggle-group";
import { useId, type ComponentType } from "react";

import { useEditorStore } from "../state/context";
import type { DesignRailView } from "../state/store";
import { useContribution, type ContributionFor } from "./contributions";
import { Files, Layers, Sliders } from "./editor-icons";
import { Inspector } from "./inspector";
import { LayersPane } from "./left-rail";
import { ReadonlyInspector } from "./readonly-inspector";
import { cn, tabOptionClass } from "./ui-classes";

const OPTION_CLASS = cn(
  "flex flex-1 items-center justify-center gap-1.5 px-2 text-[12px]",
  tabOptionClass,
);

/** The Design rail's views, each with its label and affordance glyph. */
const DESIGN_VIEWS: Record<
  DesignRailView,
  {
    readonly label: string;
    readonly Icon: ComponentType<{ className?: string }>;
  }
> = {
  layers: { label: "Layers", Icon: Layers },
  inspector: { label: "Inspector", Icon: Sliders },
  review: { label: "Review", Icon: Files },
};

/** Tab order for the rail's switcher; Review appears only once a host docks one. */
const DESIGN_VIEW_ORDER: ReadonlyArray<DesignRailView> = ["layers", "inspector", "review"];

function DesignRailPanel({
  view,
  sourceEditable,
  review,
}: {
  readonly view: DesignRailView;
  readonly sourceEditable: boolean;
  readonly review: ContributionFor<"rail.review"> | null;
}) {
  if (view === "layers")
    return (
      <div className="samva-editor-scroll h-full overflow-y-auto px-2 pt-2.5 pb-5">
        <LayersPane />
      </div>
    );
  if (view === "review" && review !== null)
    return (
      <div className="samva-editor-scroll h-full overflow-y-auto px-2 pt-2.5 pb-5">
        {review.content}
      </div>
    );
  if (sourceEditable) return <Inspector embedded />;
  return <ReadonlyInspector embedded />;
}

/** One Design pane with navigation between the rendered tree and contextual properties. */
export function DesignRail({ focused = false }: { readonly focused?: boolean | undefined }) {
  const sourceEditable = useEditorStore((state) => state.sourceEditable);
  const rightWidth = useEditorStore((state) => state.rightWidth);
  const designView = useEditorStore((state) => state.designView);
  const setDesignView = useEditorStore((state) => state.actions.setDesignView);
  const review = useContribution("rail.review") ?? null;
  // The host's review surface is the rail's third view. A view value with no
  // surface behind it is a dead end (no pressed tab, empty panel), so the
  // selection falls back to Layers until the host docks one.
  const view = designView === "review" && review === null ? ("layers" as const) : designView;
  const base = useId();
  const panelId = `${base}-panel`;

  return (
    <aside
      aria-label="Design"
      data-testid="design-rail"
      data-editor-rail="right"
      style={focused ? undefined : { width: rightWidth }}
      className={cn(
        "bg-background flex h-full min-h-0 min-w-0 flex-col overflow-hidden",
        focused ? "w-full flex-1" : "shrink-0 border-l border-border",
      )}
    >
      <div className="border-border-subtle flex min-h-11 shrink-0 items-center border-b px-2 py-1.5">
        <ToggleGroup
          role="tablist"
          aria-label="Design view"
          value={[view]}
          onValueChange={(values) => {
            const next = values[0];
            if (next === "layers" || next === "inspector") setDesignView(next);
            if (next === "review" && review !== null) setDesignView("review");
          }}
          className="bg-muted flex flex-1 gap-0.5 rounded-lg p-0.5"
        >
          {DESIGN_VIEW_ORDER.filter((entry) => entry !== "review" || review !== null).map(
            (entry) => {
              const { Icon, label } = DESIGN_VIEWS[entry];
              return (
                <Toggle
                  key={entry}
                  id={`${base}-tab-${entry}`}
                  type="button"
                  role="tab"
                  aria-selected={view === entry}
                  aria-controls={panelId}
                  aria-pressed={undefined}
                  value={entry}
                  data-testid={`design.tab.${entry}`}
                  className={OPTION_CLASS}
                >
                  <Icon className="size-[14px]" />
                  {label}
                  {entry === "review" && review?.badge}
                </Toggle>
              );
            },
          )}
        </ToggleGroup>
      </div>
      <div
        role="tabpanel"
        id={panelId}
        aria-labelledby={`${base}-tab-${view}`}
        className="min-h-0 flex-1"
      >
        <DesignRailPanel view={view} sourceEditable={sourceEditable} review={review} />
      </div>
    </aside>
  );
}
