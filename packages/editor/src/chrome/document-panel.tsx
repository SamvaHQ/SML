import { inspectSourceElement, literalReplacement } from "@samva/markup/edit";
import type { SourceReplacement } from "@samva/markup/edit";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";

import { useRenderedStyle } from "../canvas/rendered-style";
import type { ThemeFontToken } from "../host/types";
import { useEditorStore } from "../state/context";
import { DEVICE_WIDTH } from "../state/store";
import { pendingDesignEdit } from "../state/store";
import { Button } from "../ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../ui/collapsible";
import { ColorField } from "./color-field";
import { ChevronRight } from "./editor-icons";
import { FixtureSelect } from "./preview-bar";
import { FixtureSourceControls } from "./source-controls";
import { fontFamilyName, renderedScheme, useThemePalette } from "./theme-tokens";
import { GroupLabel, Value } from "./ui";

// What the inspector shows when nothing is selected: the email as a reader sees it (its page and
// fonts), the sample data it previews with, and, one step away, where it is written.

/** The page background a template gets when it sets none. */
const DEFAULT_PAGE_BACKGROUND = "var(--color-background)";
const COLOR_VARIABLE = /^var\(--color-([a-z0-9-]+)\)$/i;
const PAGE_BACKGROUND = "color.bg";

/** A stable empty list, so a selector that falls back never mints a fresh snapshot. */
const NO_FIXTURES: ReadonlyArray<string> = [];

function Group({
  title,
  testId,
  children,
}: {
  readonly title: string;
  readonly testId?: string | undefined;
  readonly children: ReactNode;
}) {
  return (
    <section
      data-slot="editor-document-group"
      data-testid={testId}
      aria-label={title}
      className="border-border/70 flex flex-col gap-3 border-b py-3.5"
    >
      <GroupLabel>{title}</GroupLabel>
      {children}
    </section>
  );
}

function Line({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-muted-foreground text-xs">{label}</span>
      {children}
    </div>
  );
}

function Disclosure({
  title,
  testId,
  children,
}: {
  readonly title: string;
  readonly testId: string;
  readonly children: ReactNode;
}) {
  return (
    <Collapsible data-slot="editor-document-disclosure" className="border-border/70 border-b">
      <CollapsibleTrigger
        data-testid={`${testId}-toggle`}
        data-editor-control=""
        className="text-muted-foreground hover:text-foreground group/disclosure flex w-full items-center gap-1.5 py-3 text-xs outline-none"
      >
        <ChevronRight className="size-3 transition-transform group-data-[panel-open]/disclosure:rotate-90" />
        {title}
      </CollapsibleTrigger>
      <CollapsibleContent keepMounted data-testid={testId} className="pb-3 data-[closed]:hidden">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * Why the preview cannot build, with a way back. It shows when no preview is on screen and the
 * last edit's refusal or the build's own error says why, so the panel never drops to its
 * resting state without a word.
 */
function BuildFailure() {
  const { reason, canUndo } = useEditorStore(
    useShallow((state) => ({
      reason:
        state.doc?.channel === "email" && state.render === null
          ? (state.sourceEditError ??
            state.doc.diagnostics.find((diagnostic) => diagnostic.severity === "error")?.message ??
            null)
          : null,
      canUndo: state.sourceEditable && state.undoHistory.length > 0,
    })),
  );
  const { undo } = useEditorStore((state) => state.actions);
  if (reason === null) return null;
  return (
    <div
      role="alert"
      data-slot="editor-document-error"
      data-testid="inspector.document.error"
      className="border-status-error/35 bg-status-error/10 text-status-error mt-3 flex flex-col gap-2 rounded-lg border p-2.5 text-xs"
    >
      <p className="font-medium">The preview can't build.</p>
      <p className="text-foreground break-words">{reason}</p>
      {canUndo && (
        <Button
          variant="outline"
          size="sm"
          data-testid="inspector.document.undo"
          data-editor-control=""
          onClick={undo}
          className="bg-background w-fit"
        >
          Undo last change
        </Button>
      )}
    </div>
  );
}

/**
 * The email's page background, written as the `backgroundColor` of the authored `Email`. It is
 * edited like any other Design colour (a theme colour as `var(--color-…)`, or a hex), and shown
 * read-only where the source does not hold it as a literal in this template.
 */
function PageBackground() {
  const { doc, outline, revision, editable, hostBusy, pending, pendingEdit } = useEditorStore(
    useShallow((state) => ({
      doc: state.doc,
      outline: state.outline,
      revision: state.render?.revision,
      editable: state.sourceEditable,
      hostBusy: state.hostBusy,
      pending: state.pendingAuthoredSource,
      pendingEdit: pendingDesignEdit(state),
    })),
  );
  const { applySourceEdit } = useEditorStore((state) => state.actions);
  const source = doc?.origin.authoredSource ?? "";
  const palette = useThemePalette(source);
  const anchor = useRef<HTMLDivElement>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const root = outline?.roots[0];
  const body = useMemo(
    () =>
      outline === null
        ? undefined
        : [...outline.index.values()].find((selection) => selection.tag === "body"),
    [outline],
  );
  const rendered = useRenderedStyle(anchor, body?.instancePath ?? root?.instancePath ?? null);
  const origin = root?.selection.origins[0];
  const file = doc?.origin.file;
  const target = useMemo(
    () =>
      origin === undefined || origin.fileName !== file
        ? null
        : inspectSourceElement(source, origin.fileName, origin),
    [source, origin, file],
  );
  if (doc === null || doc.origin.kind !== "tsx" || root === undefined) return null;

  const field =
    target?.tag === "Email"
      ? target.properties.find((p) => p.name === "backgroundColor")
      : undefined;
  const writable =
    target?.tag === "Email" &&
    !target.hasSpread &&
    (field === undefined || (field.kind === "literal" && field.literalType === "string"));
  const value = field?.kind === "literal" ? field.value : DEFAULT_PAGE_BACKGROUND;
  const tokenName = COLOR_VARIABLE.exec(value)?.[1];
  const token =
    tokenName === undefined
      ? undefined
      : palette.colors.find((color) => color.name === tokenName.toLowerCase());
  const custom = tokenName === undefined && field !== undefined ? value : undefined;

  const current = pending === null && revision === doc.rev;
  const pendingHere =
    pendingEdit !== null &&
    pendingEdit.instancePath === root.instancePath &&
    pendingEdit.originIndex === 0;
  const available = writable && editable && !hostBusy && (current || pendingHere);

  const choose = (choice: { readonly token: string } | { readonly hex: string } | null) => {
    if (target === null) return;
    const next =
      choice === null
        ? DEFAULT_PAGE_BACKGROUND
        : "token" in choice
          ? `var(--color-${choice.token})`
          : choice.hex;
    const edit: SourceReplacement | null =
      field !== undefined
        ? literalReplacement(source, field, next)
        : {
            start: target.attributeInsertion,
            end: target.attributeInsertion,
            before: "",
            after: ` backgroundColor="${next}"`,
          };
    if (edit === null) {
      setRefusal("That colour doesn't fit the page background.");
      return;
    }
    setRefusal(null);
    applySourceEdit({
      revision: revision ?? "",
      source,
      edits: [edit],
      design: { label: "Change page background", field: PAGE_BACKGROUND },
      target: { instancePath: root.instancePath, originIndex: 0 },
    });
  };

  return (
    <div ref={anchor} className="flex flex-col gap-1.5">
      <span className="text-muted-foreground text-xs">Background</span>
      <ColorField
        label="Background"
        testId="inspector.document.background"
        colors={palette.colors}
        token={token}
        custom={custom}
        rendered={rendered?.backgroundColor ?? null}
        scheme={
          rendered === null
            ? "light"
            : renderedScheme(
                palette.colors,
                [rendered.backgroundColor],
                rendered.prefersDark ? "dark" : "light",
              )
        }
        disabled={!available}
        pending={pendingHere && pendingEdit?.field === PAGE_BACKGROUND}
        onChoose={choose}
        onRefused={setRefusal}
      />
      {refusal !== null && (
        <p
          role="alert"
          data-testid="inspector.document.background-error"
          className="text-status-error text-xs"
        >
          {refusal}
        </p>
      )}
    </div>
  );
}

/** Font roles worth naming in one line: the heading and body faces first, each family once. */
const fontLine = (fonts: ReadonlyArray<ThemeFontToken>): string => {
  const rank = (font: ThemeFontToken) =>
    font.name === "heading" ? 0 : font.name === "sans" || font.name === "body" ? 1 : 2;
  const families = fonts
    .filter((font) => font.name !== "mono")
    .toSorted((a, b) => rank(a) - rank(b))
    .map((font) => fontFamilyName(font.family));
  return [...new Set(families)].join(" · ");
};

function PageFonts() {
  const source = useEditorStore((state) => state.doc?.origin.authoredSource ?? "");
  const { fonts } = useThemePalette(source);
  const line = fontLine(fonts);
  if (line === "") return null;
  const brand = fonts.find((font) => font.source.kind === "brand")?.source;
  return (
    <Line label="Fonts">
      <div
        data-testid="inspector.document.fonts"
        className="border-input bg-background flex min-h-8 items-center justify-between gap-2 rounded-lg border px-2.5 py-1 text-xs"
      >
        <span className="min-w-0 truncate">{line}</span>
        {brand?.kind === "brand" && (
          <span className="text-muted-foreground shrink-0 text-[11px]">from {brand.name}</span>
        )}
      </div>
    </Line>
  );
}

function PreviewWith() {
  const { fixture, fixtures, available } = useEditorStore(
    useShallow((state) => ({
      fixture: state.doc?.channel === "email" ? state.doc.fixture : null,
      fixtures: state.doc?.channel === "email" ? state.doc.fixtures : NO_FIXTURES,
      available: state.fixtureCapability?.status === "ready",
    })),
  );
  if (fixture === null) return null;
  return (
    <Group title="Preview with" testId="inspector.document.preview">
      {available && fixtures.length > 1 ? (
        <FixtureSelect testId="inspector.document.fixture" className="w-full max-w-none" />
      ) : (
        <Value testId="inspector.document.fixture">{fixture}</Value>
      )}
    </Group>
  );
}

function WhereItIsWritten() {
  const { deviceWidth, entryFile } = useEditorStore(
    useShallow((state) => ({
      deviceWidth: DEVICE_WIDTH[state.previewDevice],
      entryFile: state.doc?.origin.file ?? null,
    })),
  );
  return (
    <Disclosure title="Where it's written" testId="inspector.document.written">
      {entryFile !== null && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground shrink-0 text-xs">Entry</span>
          <Value testId="inspector.document.entry">{entryFile}</Value>
        </div>
      )}
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <span className="text-muted-foreground shrink-0 text-xs">Width</span>
        <Value testId="inspector.document.width">
          {deviceWidth} <span className="text-placeholder text-[10.5px]">px</span>
        </Value>
      </div>
    </Disclosure>
  );
}

/** The inspector's resting state: the email as a whole, ahead of its variables and checks. */
export function DocumentPanel() {
  const { sampleData, fixture, entryFile } = useEditorStore(
    useShallow((state) => ({
      sampleData:
        state.doc?.channel === "email" &&
        state.doc.origin.kind === "tsx" &&
        state.doc.fixture !== null,
      fixture: state.doc?.channel === "email" ? state.doc.fixture : null,
      entryFile: state.doc?.origin.file ?? null,
    })),
  );
  return (
    <div data-slot="editor-document-panel" data-testid="inspector.document-panel">
      <div className="border-border/70 border-b pb-3.5">
        <BuildFailure />
        <p data-testid="inspector.document.hint" className="text-muted-foreground mt-3 text-xs">
          Click any part of the email to change it.
        </p>
      </div>
      <Group title="Page" testId="inspector.document.page">
        <PageBackground />
        <PageFonts />
      </Group>
      <PreviewWith />
      {sampleData && (
        <Disclosure title="Edit sample data" testId="inspector.document.sample-data">
          <FixtureSourceControls key={`${fixture}:${entryFile}`} />
        </Disclosure>
      )}
      <WhereItIsWritten />
    </div>
  );
}
