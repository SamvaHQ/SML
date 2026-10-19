import { ScrollArea } from "@base-ui/react/scroll-area";
import type { EditorDocument } from "@samva/editor/host";
import {
  emailDefinitionInstances,
  emailSelectionSiblings,
  type EmailElementSelection,
} from "@samva/markup/render";
import { useState } from "react";
import { useShallow } from "zustand/react/shallow";

import { useEditorStore } from "../state/context";
import { DEVICE_WIDTH } from "../state/store";
import { Button } from "../ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../ui/collapsible";
import { ChecksPanel } from "./checks-panel";
import { ChevronRight, SidebarRightHide } from "./editor-icons";
import { formatOrigin, selectionTextExcerpt } from "./email-outline";
import { authoredAncestry, friendlyName, occurrenceNote } from "./friendly";
import { SourceControls, FixtureSourceControls } from "./source-controls";
import { GroupLabel, Value, VarChip } from "./ui";
import { Tip } from "./ui";
import { cn, focusRing } from "./ui-classes";

/** Stable empty lists, so a selector that falls back never mints a fresh snapshot. */
const NO_FIXTURES: ReadonlyArray<string> = [];
const NO_VARIABLES: EditorDocument["variables"] = [];
const NO_SELECTIONS: ReadonlyArray<EmailElementSelection> = [];

function Row({
  label,
  title,
  children,
}: {
  label: string;
  title?: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <div title={title} className="mt-1.5 flex items-center justify-between gap-2 first:mt-0">
      <span className="text-muted-foreground shrink-0 text-xs">{label}</span>
      {children}
    </div>
  );
}

function VariablesGroup() {
  const variables = useEditorStore((state) => state.doc?.variables ?? NO_VARIABLES);
  if (variables.length === 0) return null;

  return (
    <div className="border-border-subtle border-b py-3">
      <GroupLabel>Variables</GroupLabel>
      <div className="flex flex-col gap-2">
        {variables.map((variable) => (
          <div key={variable.name} className="flex items-center gap-2 text-[12.5px]">
            <VarChip name={variable.name} className="shrink-0" />
            <span className="text-placeholder ml-auto text-[11px]">
              {variable.required ? "required" : "optional"}
            </span>
          </div>
        ))}
      </div>
      <p className="text-muted-foreground mt-2.5 text-[11.5px]">
        The preview shows the values of the fixture selected above it.
      </p>
    </div>
  );
}

function ChecksGroup() {
  return (
    <div className="py-3">
      <ChecksPanel />
    </div>
  );
}

function DocumentInspector({ checks }: { readonly checks: boolean }) {
  const { deviceWidth, entryFile, fixture, fixtures } = useEditorStore(
    useShallow((state) => ({
      deviceWidth: DEVICE_WIDTH[state.previewDevice],
      entryFile: state.doc?.origin.file ?? null,
      fixture: state.doc?.channel === "email" ? state.doc.fixture : null,
      fixtures: state.doc?.channel === "email" ? state.doc.fixtures : NO_FIXTURES,
    })),
  );

  return (
    <>
      <div className="border-border-subtle border-b py-3">
        <GroupLabel>Document</GroupLabel>
        <Row label="Width">
          <Value>
            {deviceWidth} <span className="text-placeholder text-[10.5px]">px</span>
          </Value>
        </Row>
        {entryFile !== null && (
          <Row label="Entry">
            <Value>{entryFile}</Value>
          </Row>
        )}
        {fixture !== null && (
          <Row label="Fixture" title={`${fixtures.length} declared`}>
            <Value>{fixture}</Value>
          </Row>
        )}
      </div>
      <FixtureSourceControls key={`${fixture}:${entryFile}`} />
      <VariablesGroup />
      {checks && <ChecksGroup />}
    </>
  );
}

/** A right-aligned text input styled to sit in the inspector's Row layout. */
function EnvInput({
  value,
  onChange,
  onCommit,
  placeholder,
  type = "text",
  testId,
}: {
  value: string;
  onChange: (value: string) => void;
  onCommit: () => void;
  placeholder?: string | undefined;
  type?: "text" | "email" | undefined;
  testId?: string | undefined;
}) {
  return (
    <input
      type={type}
      value={value}
      placeholder={placeholder}
      data-testid={testId}
      spellCheck={false}
      onChange={(event) => onChange(event.target.value)}
      onBlur={onCommit}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
      className={cn(
        "border-border bg-background text-foreground placeholder:text-placeholder h-7 max-w-none min-w-0 flex-1 rounded-[5px] border px-2.5 text-xs outline-none",
        focusRing,
      )}
    />
  );
}

/**
 * The Defaults layer: From (name + email) and Reply-To (comma-separated) edited as
 * inputs. Each commits a metadata patch on blur — which returns the current rev
 * unchanged and emits no change event, so the write path here also updates local
 * state (via the store's `saveMetadata` action). Seeded once per mount; the panel
 * remounts on selection change, so no external resync is needed.
 */
function EnvelopeDefaults() {
  const doc = useEditorStore((state) => state.doc);
  const metadataError = useEditorStore((state) => state.metadataError);
  const { saveMetadata } = useEditorStore((state) => state.actions);
  const from = doc?.metadata.fromDefault;
  const [fromName, setFromName] = useState(from?.name ?? "");
  const [fromEmail, setFromEmail] = useState(from?.email ?? "");
  const [replyTo, setReplyTo] = useState((doc?.metadata.replyToDefault ?? []).join(", "));

  const commitFrom = () => {
    const email = fromEmail.trim();
    // Blank email clears the default — never persist { email: "" }.
    saveMetadata({
      fromDefault: email.length === 0 ? null : { email, name: fromName.trim() || undefined },
    });
  };
  const commitReplyTo = () => {
    const entries = replyTo
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    saveMetadata({ replyToDefault: entries.length === 0 ? null : entries });
  };

  return (
    <div className="py-3">
      <GroupLabel>Defaults · per send</GroupLabel>
      <Row label="From name">
        <EnvInput
          value={fromName}
          onChange={setFromName}
          onCommit={commitFrom}
          placeholder="Sender name"
        />
      </Row>
      <Row label="From email">
        <EnvInput
          type="email"
          value={fromEmail}
          onChange={setFromEmail}
          onCommit={commitFrom}
          placeholder="you@domain.com"
          testId="inspector.envelope.from-email"
        />
      </Row>
      <Row label="Reply-To">
        <EnvInput
          type="email"
          value={replyTo}
          onChange={setReplyTo}
          onCommit={commitReplyTo}
          placeholder="Comma-separated"
        />
      </Row>
      {metadataError !== null && (
        <p role="alert" className="text-status-error mt-2 text-[11.5px]">
          {metadataError}
        </p>
      )}
    </div>
  );
}

function EnvelopeInspector() {
  const metadataEditable = useEditorStore((state) => state.metadataEditable);
  const render = useEditorStore((state) => state.render);

  return (
    <>
      <div className="border-border-subtle text-muted-foreground border-b py-2.5 text-[11px] leading-relaxed">
        Subject and preview text come from the template code and the fixture on screen. From /
        Reply-To are template defaults, overridden per send.
      </div>
      <div className="border-border-subtle border-b py-3">
        <GroupLabel>Rendered</GroupLabel>
        <Row label="Subject">
          <Value>{render?.subject ?? "No subject"}</Value>
        </Row>
        <Row label="Preview">
          <Value>{render?.preheader ?? "No preview text"}</Value>
        </Row>
      </div>
      {metadataEditable ? (
        <EnvelopeDefaults />
      ) : (
        <p className="text-muted-foreground py-3 text-xs">
          This host does not edit sender defaults.
        </p>
      )}
    </>
  );
}

/**
 * What one rendered element is: the authoring that produced it, the component
 * call sites enclosing it, and how many other rendered elements share it.
 * Source controls name their scope and apply revision-bound authored edits.
 */
function ElementInspector({ selection }: { selection: EmailElementSelection }) {
  const selections = useEditorStore((state) => state.render?.selections ?? NO_SELECTIONS);
  const html = useEditorStore((state) => state.render?.html ?? "");
  const { select } = useEditorStore((state) => state.actions);
  const authoring = selection.origins[0];
  const enclosing = selection.origins.slice(1);
  const siblings = emailSelectionSiblings(selections, selection);
  const definitionInstances = emailDefinitionInstances(selections, selection);

  return (
    <div data-slot="editor-element-inspector" data-instance-path={selection.instancePath}>
      {siblings.length > 1 && (
        <div data-slot="editor-element-copies" className="border-border/70 border-b py-3">
          <GroupLabel>Copies</GroupLabel>
          <p className="text-muted-foreground mb-2 text-[11.5px]">
            A loop or a repeated block draws this {siblings.length} times; an edit changes every
            copy.
          </p>
          <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
            {siblings.map((sibling, index) => (
              <li key={sibling.instancePath}>
                <button
                  type="button"
                  data-testid={`inspector.iteration.${sibling.instancePath}`}
                  aria-current={sibling.instancePath === selection.instancePath || undefined}
                  onClick={() => select(sibling.instancePath)}
                  className={cn(
                    "hover:bg-muted flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[12.5px]",
                    sibling.instancePath === selection.instancePath &&
                      "bg-muted text-foreground font-medium",
                  )}
                >
                  <span className="text-muted-foreground w-4 tabular-nums">{index + 1}</span>
                  <span className="min-w-0 flex-1 truncate">
                    {selectionTextExcerpt(sibling, html) ?? `Copy ${index + 1}`}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <SourceControls
        key={`${selection.instancePath}:${selection.start}:${selection.end}`}
        selection={selection}
      />

      <Collapsible data-slot="editor-element-details" className="py-1">
        <CollapsibleTrigger
          data-testid="inspector.details-toggle"
          className="text-muted-foreground hover:text-foreground group/details flex w-full items-center gap-1.5 py-2 font-mono text-[10.5px] font-medium tracking-[0.08em] uppercase outline-none"
        >
          <ChevronRight className="size-3 transition-transform group-data-[panel-open]/details:rotate-90" />
          Where it's written
        </CollapsibleTrigger>
        <CollapsibleContent keepMounted className="pb-3 data-[closed]:hidden">
          {authoring === undefined ? (
            <p className="text-muted-foreground text-[11.5px]">
              The renderer produced this element with no authoring on the stack, so nothing in the
              template points at it.
            </p>
          ) : (
            <>
              <Row label="Written at">
                <Value testId="inspector.authoring.origin">{formatOrigin(authoring)}</Value>
              </Row>
              <Row
                label="Kind"
                title={
                  selection.authored
                    ? "This element was written in the template."
                    : "A compiler primitive produced this element; the authoring above is the call that asked for it."
                }
              >
                <Value testId="inspector.element.provenance">
                  {selection.authored ? "Authored" : "Generated"}
                </Value>
              </Row>
              <Row label="Rendered as">
                <Value testId="inspector.element.tag">{selection.tag}</Value>
              </Row>
              <p
                data-testid="inspector.authoring.occurrence"
                className="text-muted-foreground mt-2 text-[11.5px]"
              >
                {selection.occurrences > 1
                  ? `This authoring renders ${selection.occurrences} elements here; this is number ${selection.occurrence}.`
                  : "This authoring renders one element here."}
              </p>
              {definitionInstances.length > siblings.length && (
                <p
                  data-testid="inspector.authoring.definition-scope"
                  className="text-muted-foreground mt-1 text-[11.5px]"
                >
                  {definitionInstances.length} elements across the whole render come from it,
                  through more than one call site.
                </p>
              )}
            </>
          )}
          {enclosing.length > 0 && (
            <div className="mt-3">
              <span className="text-muted-foreground text-xs">Inside, innermost first</span>
              <ol className="m-0 mt-1 flex list-none flex-col gap-1 p-0">
                {enclosing.map((origin, index) => (
                  <li
                    key={`${formatOrigin(origin)}:${index}`}
                    data-testid={`inspector.call-site.${index}`}
                    className="text-foreground font-mono text-[11.5px] break-all"
                  >
                    {formatOrigin(origin)}
                  </li>
                ))}
              </ol>
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

/** The contextual inspector: which scope is selected, and what that scope is. */
export function Inspector({
  embedded = false,
  checks = true,
}: {
  readonly embedded?: boolean | undefined;
  /** Show the checks in document scope. Off where the layout gives checks a tab of their own. */
  readonly checks?: boolean | undefined;
} = {}) {
  const { outline, selection, rightCollapsed, rightWidth, layoutMode } = useEditorStore(
    useShallow((state) => ({
      outline: state.outline,
      selection: state.selection,
      rightCollapsed: state.rightCollapsed,
      rightWidth: state.rightWidth,
      layoutMode: state.layoutMode,
    })),
  );
  const { select, selectDocument, toggleRight } = useEditorStore((state) => state.actions);

  const selected =
    selection.kind === "element" ? (outline?.index.get(selection.instancePath) ?? null) : null;
  // Document scope covers both an empty selection and one that no longer
  // resolves, so the panel falls back to Document rather than rendering blank.
  const scope =
    selection.kind === "envelope" ? "envelope" : selected === null ? "document" : "element";
  const authoredSource = useEditorStore((state) => state.doc?.origin.authoredSource ?? "");
  // Only the blocks the author wrote, the nearest two, so the trail stays one short line.
  const crumbs =
    selected === null || outline === null
      ? []
      : authoredAncestry(outline, selected.instancePath)
          .slice(-2)
          .map((entry) => ({
            instancePath: entry.instancePath,
            label: friendlyName(entry, authoredSource),
          }));
  const repeat = selected === null ? undefined : occurrenceNote(selected);
  const overlay = !embedded && (layoutMode === "compact" || layoutMode === "narrow");

  return (
    <aside
      aria-label="Inspector"
      data-testid="inspector"
      aria-hidden={!embedded && rightCollapsed ? true : undefined}
      inert={!embedded && rightCollapsed ? true : undefined}
      data-editor-rail="right"
      style={{
        width: embedded ? "100%" : rightCollapsed ? 0 : rightWidth,
        maxWidth: overlay ? "calc(100% - 48px)" : undefined,
      }}
      className={cn(
        "flex h-full shrink-0 flex-col overflow-hidden bg-background transition-[width,transform,box-shadow] duration-180 ease-out",
        !embedded && "border-l border-border",
        overlay && "absolute inset-y-0 right-0 z-40 shadow-[var(--shadow-floating)]",
        !embedded && rightCollapsed && "border-l-0",
      )}
    >
      <div
        className="flex h-full min-w-0 flex-col"
        style={{ width: embedded ? "100%" : rightWidth, maxWidth: "100%" }}
      >
        <div className="border-border bg-background/95 sticky top-0 z-10 border-b backdrop-blur-md">
          <div className="flex min-h-10 items-center gap-2 px-3 py-2">
            <div className="text-muted-foreground flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden text-xs">
              {scope === "document" ? (
                <span className="text-foreground truncate px-1 font-semibold">Document</span>
              ) : scope === "envelope" ? (
                <span className="text-foreground truncate px-1 font-semibold">Envelope</span>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={selectDocument}
                    data-testid="inspector.document"
                    className="hover:bg-muted hover:text-foreground shrink-0 rounded px-1"
                  >
                    Email
                  </button>
                  {crumbs.map((crumb) => (
                    <span key={crumb.instancePath} className="contents">
                      <ChevronRight className="text-placeholder size-3 shrink-0" />
                      <button
                        type="button"
                        onClick={() => select(crumb.instancePath)}
                        className="hover:bg-muted hover:text-foreground max-w-[88px] truncate rounded px-1"
                      >
                        {crumb.label}
                      </button>
                    </span>
                  ))}
                  <ChevronRight className="text-placeholder size-3 shrink-0" />
                  <span
                    data-testid="inspector.element-name"
                    className="text-foreground truncate px-1 font-semibold"
                  >
                    {selected === null ? "" : friendlyName(selected, authoredSource)}
                  </span>
                </>
              )}
            </div>
            {selected !== null && (repeat !== undefined || !selected.authored) && (
              <span
                data-testid="inspector.selection-badge"
                className="bg-muted text-muted-foreground shrink-0 rounded-md px-1.5 py-0.5 text-[10.5px] font-medium tabular-nums"
              >
                {selected.authored ? repeat : "Generated"}
              </span>
            )}
            {!embedded && (
              <Tip label="Collapse inspector" side="bottom">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Collapse inspector"
                  data-testid="inspector.collapse"
                  onClick={toggleRight}
                  className="text-muted-foreground ml-auto"
                >
                  <SidebarRightHide />
                </Button>
              </Tip>
            )}
          </div>
        </div>

        <ScrollArea.Root data-samva-scroll-area="inspector" className="relative min-h-0 flex-1">
          <ScrollArea.Viewport className="size-full">
            <div className="samva-inspector-content pb-4">
              {scope === "document" && <DocumentInspector checks={checks} />}
              {scope === "envelope" && <EnvelopeInspector />}
              {selected !== null && <ElementInspector selection={selected} />}
            </div>
          </ScrollArea.Viewport>
          <ScrollArea.Scrollbar
            orientation="vertical"
            className="absolute top-0 right-0 bottom-0 flex w-2.5 touch-none p-0.5 select-none"
          >
            <ScrollArea.Thumb className="relative flex-1 rounded-full bg-[var(--editor-scrollbar-thumb)] hover:bg-[var(--editor-scrollbar-thumb-hover)]" />
          </ScrollArea.Scrollbar>
        </ScrollArea.Root>
      </div>
    </aside>
  );
}
