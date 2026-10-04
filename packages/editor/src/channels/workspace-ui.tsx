import { Toggle } from "@base-ui/react/toggle";
import { ToggleGroup } from "@base-ui/react/toggle-group";
import type { EmailDiagnostic } from "@samva/markup/diagnostics";
import { smsSegmentInfo } from "@samva/markup/render";
import type { ReactNode } from "react";
import { useId } from "react";

import { cn, tabOptionClass } from "../chrome/ui-classes";
import { workspaceTabId } from "./workspace-tabs";

export type WorkspaceView = "visual" | "source";

const TAB_CLASS = cn(tabOptionClass, "h-7 px-2.5 text-[12px] capitalize");

/**
 * The Visual/Source switch above every channel workspace. Rendered as the tabs
 * pattern: a `tablist` of `tab`s announcing `aria-selected`, each controlling
 * the workspace's view panel. By default the panel is rendered right below from
 * `children`; pass `panelId` to point the tabs at a panel the workspace already
 * renders (the agent workspace's preview pane), and `idBase` so that panel can
 * name itself from the tab through {@link workspaceTabId} rather than restating
 * the label. IDs are instance-scoped (`useId` when no `idBase` is given), so two
 * embedded editors on one page never cross-reference.
 */
export function WorkspaceTabs({
  value,
  onChange,
  children,
  panelId,
  idBase,
}: {
  readonly value: WorkspaceView;
  readonly onChange: (view: WorkspaceView) => void;
  /** The tabpanel content, rendered as this switcher's own panel. Omit with `panelId`. */
  readonly children?: ReactNode;
  /** An existing tabpanel elsewhere in the workspace. Omit to render one from `children`. */
  readonly panelId?: string | undefined;
  /** An instance-scoped id prefix the caller already owns. Defaults to this mount's own. */
  readonly idBase?: string | undefined;
}) {
  const generatedBase = useId();
  const base = idBase ?? generatedBase;
  const ownPanelId = `${base}-view-panel`;
  return (
    <>
      <ToggleGroup
        role="tablist"
        aria-label="Workspace view"
        value={[value]}
        onValueChange={(values) => {
          const next = values[0];
          if (next === "visual" || next === "source") onChange(next);
        }}
        className="border-border bg-background flex h-10 shrink-0 items-center gap-1 border-b px-3"
      >
        {(["visual", "source"] as const).map((view) => (
          <Toggle
            key={view}
            id={workspaceTabId(base, view)}
            type="button"
            role="tab"
            aria-selected={value === view}
            aria-controls={panelId ?? ownPanelId}
            aria-pressed={undefined}
            value={view}
            data-testid={`workspace.tab.${view}`}
            className={TAB_CLASS}
          >
            {view}
          </Toggle>
        ))}
      </ToggleGroup>
      {panelId === undefined && (
        <div
          role="tabpanel"
          id={ownPanelId}
          aria-labelledby={workspaceTabId(base, value)}
          className="flex min-h-0 min-w-0 flex-1 flex-col"
        >
          {children}
        </div>
      )}
    </>
  );
}

export function Field({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <label className="grid gap-1.5 text-[12.5px]">
      <span className="text-foreground font-medium">{label}</span>
      {children}
    </label>
  );
}

export function LockedRegion({ summary }: { readonly summary: string }) {
  return (
    <div className="border-border bg-surface-inset rounded-lg border border-dashed px-3 py-2">
      <p className="text-foreground truncate font-mono text-[11.5px]">{summary}</p>
      <p className="text-muted-foreground mt-0.5 text-[11px]">
        Locked structure. Preserved as is. Edit it in Source.
      </p>
    </div>
  );
}

/** A locked expression shown inline, where a full {@link LockedRegion} would crowd the row. */
export function LockedChip({ summary }: { readonly summary: string }) {
  return (
    <span
      title="Locked expression. Edit it in Source."
      data-testid="channel-workspace.locked-chip"
      className="border-border bg-surface-inset text-muted-foreground inline-flex max-w-full shrink-0 truncate rounded-md border border-dashed px-1.5 py-0.5 font-mono text-[11.5px]"
    >
      {summary}
    </span>
  );
}

export function Diagnostics({
  diagnostics,
}: {
  readonly diagnostics: ReadonlyArray<Pick<EmailDiagnostic, "code" | "message">>;
}) {
  if (diagnostics.length === 0) return null;
  return (
    <ul className="grid gap-2">
      {diagnostics.map((diagnostic, index) => (
        <li
          key={`${diagnostic.code}-${index}`}
          className="border-status-error/30 bg-status-error/5 text-status-error rounded-lg border px-3 py-2 text-[12px]"
        >
          {diagnostic.message}
        </li>
      ))}
    </ul>
  );
}

/** The input fields a channel body reads. */
export function VariableList({ variables }: { readonly variables: ReadonlyArray<string> }) {
  if (variables.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {variables.map((variable) => (
        <span
          key={variable}
          className="border-border-subtle bg-surface-inset rounded-full border px-2 py-0.5 font-mono text-[11px]"
        >
          {variable}
        </span>
      ))}
    </div>
  );
}

/** The encoding, length and segment count of a rendered SMS. */
export function SmsCounter({
  text,
  className,
}: {
  readonly text: string;
  readonly className?: string | undefined;
}) {
  const info = smsSegmentInfo(text);
  return (
    <p data-testid="sms-counter" className={cn("text-muted-foreground", className)}>
      {info.encoding.toUpperCase()} · {info.characterCount} character
      {info.characterCount === 1 ? "" : "s"} · {info.segmentCount} segment
      {info.segmentCount === 1 ? "" : "s"}
    </p>
  );
}

/** A refused form edit, with the reason. */
export function EditRefusal({ reason }: { readonly reason: string | null }) {
  if (reason === null) return null;
  return (
    <p
      role="alert"
      data-testid="channel-workspace.edit-refusal"
      className="border-status-error/30 bg-status-error/5 text-status-error rounded-lg border px-3 py-2 text-[12px]"
    >
      {reason}
    </p>
  );
}
