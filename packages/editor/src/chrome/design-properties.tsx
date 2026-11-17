import {
  classNameEdit,
  literalReplacement,
  type SourceElement,
  type SourceProperty,
  type SourceReplacement,
} from "@samva/markup/edit";
import { inspectSourceFixtures } from "@samva/markup/edit";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";

import { useRenderedStyle } from "../canvas/rendered-style";
import { useEditorStore } from "../state/context";
import { Badge } from "../ui/badge";
import { Input } from "../ui/input";
import { NativeSelect, NativeSelectOption } from "../ui/native-select";
import { bindingName, bindingPath, fixtureSample, renderedSamples } from "./binding-label";
import { ColorField, Spinner } from "./color-field";
import { AlignCenter, AlignLeft, AlignRight, DataField } from "./editor-icons";
import { FontField } from "./font-field";
import { classTokens, propLabel } from "./friendly";
import { useThemePalette } from "./theme-tokens";
import { GroupLabel, Segmented, Tip } from "./ui";
import { cn } from "./ui-classes";

// Friendly controls for one selected element. Each reads the element's authored props and class
// list, and each change is a source edit the caller stages (or saves, for a shared partial):
// a literal prop through `literalReplacement`, a style through a whole-list `classNameEdit`.

/** Elements whose own text and type are what an author edits. */
const TEXT_TAGS = new Set([
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "span",
  "a",
  "li",
  "strong",
  "em",
  "Link",
  "Button",
  "Text",
  "Heading",
]);
/** Elements that hold other elements, styled by their background and padding. */
const BLOCK_TAGS = new Set([
  "Section",
  "Container",
  "Column",
  "Row",
  "div",
  "td",
  "table",
  "Box",
  "Card",
]);

const SPACING_STEPS = ["0", "1", "2", "3", "4", "5", "6", "8", "10", "12", "16"];
const WEIGHTS = [
  { value: "font-normal", label: "Regular" },
  { value: "font-medium", label: "Medium" },
  { value: "font-semibold", label: "Semibold" },
  { value: "font-bold", label: "Bold" },
] as const;
const SIZE = /^text-(\[\d+(?:\.\d+)?px\]|xs|sm|base|lg|xl|[2-9]xl)$/;
const NAMED_SIZES = ["xs", "sm", "base", "lg", "xl", "2xl", "3xl", "4xl", "5xl", "6xl"];
const ALIGN = /^text-(left|center|right|justify)$/;
const WEIGHT = /^font-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black)$/;
/** Font roles Tailwind and the theme vocabulary name, recognized even before the theme resolves. */
const KNOWN_FONT_ROLES = ["sans", "serif", "mono", "heading", "body", "display"];
const WEIGHT_NAMES: Readonly<Record<number, string>> = {
  100: "Thin",
  200: "Extra light",
  300: "Light",
  400: "Regular",
  500: "Medium",
  600: "Semibold",
  700: "Bold",
  800: "Extra bold",
  900: "Black",
};
const NAMED_SIZE_PX: Readonly<Record<string, number>> = {
  xs: 12,
  sm: 14,
  base: 16,
  lg: 18,
  xl: 20,
  "2xl": 24,
  "3xl": 30,
  "4xl": 36,
  "5xl": 48,
  "6xl": 60,
};

/** Class tokens without a variant prefix (`dark:`, `sm:`): the ones these controls own. */
const plain = (tokens: ReadonlyArray<string>) => tokens.filter((token) => !token.includes(":"));

function Field({
  label,
  children,
  hint,
  value,
  pending,
}: {
  readonly label: string;
  readonly children: ReactNode;
  readonly hint?: string | undefined;
  /** The current value, named beside the label. */
  readonly value?: string | undefined;
  /** This control's edit is still being written and rendered. */
  readonly pending?: boolean | undefined;
}) {
  return (
    <div
      data-slot="editor-design-field"
      data-pending={pending === true ? "" : undefined}
      className="flex flex-col gap-1.5"
    >
      <span className="flex items-center justify-between gap-2 text-xs">
        <span className="text-muted-foreground flex items-center gap-1.5">
          {label}
          {pending === true && <Spinner />}
        </span>
        {value !== undefined && (
          <span
            data-slot="editor-design-field-value"
            className="text-foreground truncate font-mono text-[11px]"
          >
            {value}
          </span>
        )}
      </span>
      {children}
      {hint !== undefined && <span className="text-muted-foreground text-[11px]">{hint}</span>}
    </div>
  );
}

function Group({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <section
      data-slot="editor-design-group"
      aria-label={title}
      className="border-border/70 flex flex-col gap-3 border-b py-3.5"
    >
      <GroupLabel>{title}</GroupLabel>
      {children}
    </section>
  );
}

/** A text field that commits on Enter or when focus leaves with a changed value. */
function CommitInput({
  value,
  onCommit,
  testId,
  ariaLabel,
  type = "text",
  disabled,
  placeholder,
  className,
}: {
  readonly value: string;
  readonly onCommit: (value: string) => void;
  readonly testId: string;
  readonly ariaLabel: string;
  readonly type?: "text" | "number" | undefined;
  readonly disabled?: boolean | undefined;
  readonly placeholder?: string | undefined;
  readonly className?: string | undefined;
}) {
  const [draft, setDraft] = useState(value);
  const commit = () => {
    if (draft !== value) onCommit(draft);
  };
  return (
    <Input
      type={type}
      aria-label={ariaLabel}
      data-testid={testId}
      value={draft}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") commit();
      }}
      className={cn("h-8 text-[13px] md:text-[13px]", className)}
    />
  );
}

/** A part of an element's content: text the author can type, or something it cannot (a chip). */
type Segment =
  | { readonly kind: "text"; readonly field: SourceProperty }
  | {
      readonly kind: "chip";
      /** What the chip says: a data field's spoken name, or a nested element's tag. */
      readonly label: string;
      /** The data path a binding reads (`input.product.shortName`); null for an element. */
      readonly path: ReadonlyArray<string> | null;
      /** The code as written, for the tooltip. */
      readonly code: string;
    };

/** `{input.product.shortName}` → a "Product short name" binding, `<Link …>…</Link>` → "Link". */
const chipOf = (code: string): Extract<Segment, { kind: "chip" }> | null => {
  const trimmed = code.trim();
  if (trimmed === "") return null;
  if (/^\{\s*(["'`])\s*\1\s*\}$/.test(trimmed) || /^\{\s*" "\s*\}$/.test(trimmed)) return null;
  const element = /^<([A-Za-z][\w.]*)/.exec(trimmed)?.[1];
  if (element !== undefined) return { kind: "chip", label: element, path: null, code: trimmed };
  const expression = trimmed.replace(/^\{|\}$/g, "").trim();
  const path = bindingPath(expression);
  return {
    kind: "chip",
    label: path === null ? "Worked out from the data" : bindingName(path),
    path,
    code: expression,
  };
};

/** The element's content in order: typed text between bindings and nested elements. */
const contentSegments = (
  source: string,
  target: SourceElement,
  inline: boolean,
): ReadonlyArray<Segment> => {
  const texts = target.properties
    .filter(
      (field) =>
        field.syntax === "child" && (field.name === "children" || field.name.startsWith("text.")),
    )
    .toSorted((a, b) => a.start - b.start);
  const start = target.contentStart;
  const end = target.contentEnd;
  if (start === null || end === null) {
    return texts.flatMap((field): Segment[] => {
      if (field.kind === "literal") return [{ kind: "text", field }];
      const chip = chipOf(`{${field.value}}`);
      return chip === null ? [] : [chip];
    });
  }
  const segments: Segment[] = [];
  let at = start;
  const gap = (until: number) => {
    const code = source.slice(at, until);
    const pattern = inline ? /\{[^{}]*\}|<[A-Za-z][\s\S]*?(?:\/>|<\/[^>]+>)/g : /\{[^{}]*\}/g;
    for (const part of code.match(pattern) ?? []) {
      const chip = chipOf(part);
      if (chip !== null) segments.push(chip);
    }
  };
  for (const field of texts) {
    gap(field.start);
    if (field.kind === "literal") segments.push({ kind: "text", field });
    else {
      const chip = chipOf(`{${field.value}}`);
      if (chip !== null) segments.push(chip);
    }
    at = field.end;
  }
  gap(end);
  return segments;
};

export interface DesignPropertiesProps {
  /** The source of the file the element is written in. */
  readonly source: string;
  /** The template entry, whose classes give the type scale and color names. */
  readonly entrySource: string;
  readonly target: SourceElement;
  /** The selected rendered instance, whose computed style the controls show. */
  readonly instancePath: string;
  readonly available: boolean;
  /**
   * The control whose edit is still being written and rendered (`"color.text"`, `"size"`,
   * `"text.<prop>"`, `"prop.<name>"`); it shows a spinner while every control stays usable.
   */
  readonly pendingField: string | null;
  /** Stage (or, for a partial, save) the edits under a label, naming the control that made them. */
  readonly commit: (edits: readonly SourceReplacement[], label: string, field: string) => void;
  readonly onRefused: (reason: string) => void;
}

const EMPTY_VARIABLES: ReadonlyArray<{
  readonly name: string;
  readonly sample?: string | undefined;
}> = [];

/** The active fixture's object source, for reading binding samples. */
function useFixtureSource(entrySource: string): string | null {
  const fixture = useEditorStore((state) => state.doc?.fixture ?? null);
  // A Babel parse of the whole entry: once per entry, not per render.
  const fixtures = useMemo(() => inspectSourceFixtures(entrySource), [entrySource]);
  return (fixtures.find((item) => item.name === fixture) ?? fixtures[0])?.source ?? null;
}

/**
 * The controls an author edits a selected element with: its text, its image description and
 * size, its colors from the theme, its type, its spacing and its alignment. Only what the element
 * supports is shown, and each shows what the element renders with.
 */
export function DesignProperties({
  source,
  entrySource,
  target,
  instancePath,
  available,
  pendingField,
  commit,
  onRefused,
}: DesignPropertiesProps) {
  const palette = useThemePalette(entrySource);
  const anchor = useRef<HTMLDivElement>(null);
  const rendered = useRenderedStyle(anchor, instancePath);
  const variables = useEditorStore(useShallow((state) => state.doc?.variables ?? EMPTY_VARIABLES));
  const fixtureSource = useFixtureSource(entrySource);
  const colors = palette.colors;
  const tag = target.tag;
  const textLike = TEXT_TAGS.has(tag);
  const block = BLOCK_TAGS.has(tag);
  const isImage = tag === "img" || tag === "Image";
  const className = target.properties.find((field) => field.name === "className");
  const classesEditable =
    !target.hasSpread &&
    (className === undefined ||
      (className.kind === "literal" && className.literalType === "string"));
  const tokens = plain(classTokens(className?.kind === "literal" ? className.value : ""));
  const allTokens = classTokens(className?.kind === "literal" ? className.value : "");
  const colorNames = new Set(colors.map((color) => color.name));
  const fontRoles = new Set([...KNOWN_FONT_ROLES, ...palette.fonts.map((font) => font.name)]);
  const pending = (field: string) => pendingField === field;

  const setClasses = (next: ReadonlyArray<string>, label: string, field: string) => {
    const result = classNameEdit(source, target, { kind: "set", value: next.join(" ") });
    if (!result.ok) onRefused(result.reason);
    else if (result.edits.length > 0) commit(result.edits, label, field);
  };
  /** Swap the tokens `owned` matches for `add`, keeping every other class and its order. */
  const swap = (
    owned: (token: string) => boolean,
    add: ReadonlyArray<string>,
    label: string,
    field: string,
  ) =>
    setClasses(
      [...allTokens.filter((token) => token.includes(":") || !owned(token)), ...add],
      label,
      field,
    );
  const setLiteral = (field: SourceProperty, value: string, label: string, control: string) => {
    const edit = literalReplacement(source, field, value);
    if (edit === null) onRefused(`That value doesn't fit ${propLabel(field.name)}.`);
    else commit([edit], label, control);
  };

  const segments = contentSegments(source, target, textLike);
  const prop = (name: string) => target.properties.find((field) => field.name === name);
  const literalProps = target.properties.filter(
    (field) =>
      field.syntax !== "child" &&
      field.name !== "className" &&
      !(isImage && ["alt", "width", "height", "src"].includes(field.name)),
  );

  // Samples: the fixture's literal where it has one, else the template's declared sample, else
  // what the element rendered with its typed text taken away.
  const fromRender =
    rendered === null ||
    segments.some((segment) => segment.kind === "chip" && segment.path === null)
      ? []
      : renderedSamples(
          rendered.text,
          segments.map((segment) => (segment.kind === "text" ? segment.field.value : null)),
        );
  const samples = segments.map((segment, index) => {
    if (segment.kind !== "chip" || segment.path === null) return null;
    const bindingIndex = segments.slice(0, index).filter((item) => item.kind === "chip").length;
    const named =
      segment.path.length > 1 && ["input", "props"].includes(segment.path[0]!)
        ? segment.path.slice(1)
        : segment.path;
    return (
      (fixtureSource === null ? null : fixtureSample(fixtureSource, segment.path)) ??
      (named.length === 1
        ? variables.find((variable) => variable.name === named[0])?.sample
        : undefined) ??
      fromRender[bindingIndex] ??
      null
    );
  });

  const colorToken = (prefix: "text" | "bg") =>
    tokens.find(
      (token) => token.startsWith(`${prefix}-`) && colorNames.has(token.slice(prefix.length + 1)),
    );
  const customColor = (prefix: "text" | "bg") =>
    tokens.find((token) => new RegExp(`^${prefix}-\\[#`).test(token));
  const isColor = (prefix: "text" | "bg") => (token: string) =>
    (token.startsWith(`${prefix}-`) && colorNames.has(token.slice(prefix.length + 1))) ||
    new RegExp(`^${prefix}-\\[#`).test(token);

  const size = tokens.find((token) => SIZE.test(token));
  const weight = tokens.find((token) => WEIGHT.test(token));
  const fontRole = tokens
    .find((token) => token.startsWith("font-") && fontRoles.has(token.slice(5)))
    ?.slice(5);
  const renderedSize = rendered === null || rendered.fontSize <= 0 ? null : rendered.fontSize;
  const renderedWeight = rendered === null ? null : rendered.fontWeight;
  const sizes = sizeScale(entrySource, size, renderedSize);
  const align = tokens.find((token) => ALIGN.test(token))?.slice(5) ?? "left";

  const axis = (kind: "p" | "m", sides: "x" | "y" | "t" | "b"): string => {
    const value = (prefix: string) =>
      tokens.find((token) => token.startsWith(`${prefix}-`))?.slice(prefix.length + 1);
    if (sides === "t" || sides === "b")
      return value(`${kind}${sides}`) ?? value(`${kind}y`) ?? value(kind) ?? "";
    const [a, b] = sides === "x" ? ["l", "r"] : ["t", "b"];
    const own = value(`${kind}${sides}`) ?? value(kind);
    if (own !== undefined) return own;
    const first = value(`${kind}${a}`);
    return first !== undefined && first === value(`${kind}${b}`) ? first : "";
  };
  const setAxis = (
    kind: "p" | "m",
    sides: "x" | "y" | "t" | "b",
    step: string,
    label: string,
    field: string,
  ) => {
    const others: Record<typeof sides, ReadonlyArray<string>> = {
      x: [`${kind}x`, `${kind}l`, `${kind}r`],
      y: [`${kind}y`, `${kind}t`, `${kind}b`],
      t: [`${kind}t`],
      b: [`${kind}b`],
    };
    const owned = others[sides];
    let next = allTokens.filter(
      (token) => token.includes(":") || !owned.some((prefix) => token.startsWith(`${prefix}-`)),
    );
    // A shorthand that also sets the other axis is split so that axis keeps its value.
    const both = next.find((token) => token.startsWith(`${kind}-`));
    const pair = sides === "y" || sides === "t" || sides === "b" ? "y" : "x";
    const opposite = pair === "x" ? "y" : "x";
    // An explicit class for a side the author set is kept rather than overridden by the split.
    const keep = (prefix: string, value: string) => {
      if (!next.some((token) => token.startsWith(`${prefix}-`))) next.push(`${prefix}-${value}`);
    };
    if (both !== undefined) {
      const value = both.slice(kind.length + 1);
      next = next.filter((token) => token !== both);
      keep(`${kind}${opposite}`, value);
      if (sides === "t") keep(`${kind}b`, value);
      if (sides === "b") keep(`${kind}t`, value);
    }
    const shared = next.find((token) => token.startsWith(`${kind}y-`));
    if ((sides === "t" || sides === "b") && shared !== undefined) {
      const value = shared.slice(kind.length + 2);
      next = next.filter((token) => token !== shared);
      keep(`${kind}${sides === "t" ? "b" : "t"}`, value);
    }
    if (step !== "") next.push(`${kind}${sides}-${step}`);
    setClasses(next, label, field);
  };

  const stepSelect = (
    kind: "p" | "m",
    sides: "x" | "y" | "t" | "b",
    label: string,
    field: string,
  ) => {
    const current = axis(kind, sides);
    const options =
      SPACING_STEPS.includes(current) || current === ""
        ? SPACING_STEPS
        : [current, ...SPACING_STEPS];
    return (
      <Field label={label} pending={pending(field)}>
        <NativeSelect
          size="sm"
          aria-label={label}
          data-testid={`design-properties.${field}`}
          value={current}
          disabled={!available}
          onChange={(event) =>
            setAxis(kind, sides, event.target.value, `Change ${label.toLowerCase()}`, field)
          }
          className="w-full"
        >
          <NativeSelectOption value="">None</NativeSelectOption>
          {options.map((step) => (
            <NativeSelectOption key={step} value={step}>
              {stepLabel(step)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Field>
    );
  };

  const colorField = (prefix: "text" | "bg", label: string, editLabel: string) => {
    const field = `color.${prefix === "text" ? "text" : "bg"}`;
    const current = colorToken(prefix);
    const custom = customColor(prefix);
    return (
      <Field label={label}>
        <ColorField
          label={label}
          testId={`design-properties.${field}`}
          colors={colors}
          token={
            current === undefined
              ? undefined
              : colors.find((color) => color.name === current.slice(prefix.length + 1))
          }
          custom={custom?.slice(prefix.length + 2, -1)}
          rendered={
            rendered === null ? null : prefix === "text" ? rendered.color : rendered.backgroundColor
          }
          disabled={!available}
          pending={pending(field)}
          onRefused={onRefused}
          onChoose={(choice) =>
            swap(
              isColor(prefix),
              choice === null
                ? []
                : "token" in choice
                  ? [`${prefix}-${choice.token}`]
                  : [`${prefix}-[${choice.hex}]`],
              editLabel,
              field,
            )
          }
        />
      </Field>
    );
  };

  const hasText = segments.some((segment) => segment.kind === "text");
  return (
    <div
      ref={anchor}
      data-slot="editor-design-properties-controls"
      data-testid="design-properties"
      className="flex flex-col"
    >
      {(textLike || segments.some((segment) => segment.kind === "text")) && segments.length > 0 && (
        <Group title="Content">
          <div
            data-testid="design-properties.content"
            className="flex flex-wrap items-center gap-1.5"
          >
            {segments.map((segment, index) =>
              segment.kind === "chip" ? (
                <Tip
                  key={`chip-${index}`}
                  label={
                    segment.path === null
                      ? `${segment.label}, written in Source.`
                      : `${segment.code} · Change it in Source.`
                  }
                >
                  <Badge
                    variant="secondary"
                    data-testid="design-properties.binding"
                    data-path={segment.path?.join(".")}
                    className="w-fit gap-1 rounded-md text-[12px] font-normal"
                  >
                    {segment.path !== null && <DataField className="size-3 shrink-0 opacity-70" />}
                    {segment.label}
                  </Badge>
                </Tip>
              ) : (
                <span
                  key={`${segment.field.name}`}
                  className="flex min-w-40 flex-1 items-center gap-1.5"
                >
                  <CommitInput
                    ariaLabel="Text"
                    testId={`design-properties.text.${segment.field.name}`}
                    value={segment.field.value}
                    disabled={!available}
                    onCommit={(value) =>
                      setLiteral(segment.field, value, "Edit text", `text.${segment.field.name}`)
                    }
                    className="flex-1"
                  />
                  {pending(`text.${segment.field.name}`) && <Spinner />}
                </span>
              ),
            )}
          </div>
          {segments.map((segment, index) =>
            segment.kind === "chip" && segment.path !== null ? (
              <p
                key={`hint-${index}`}
                data-testid="design-properties.binding-hint"
                className="text-muted-foreground text-[11px]"
              >
                {segment.label} is filled in from each send.
                {samples[index] !== null && <> Sample: “{samples[index]}”.</>}
              </p>
            ) : null,
          )}
          {!hasText && (
            <span className="text-muted-foreground text-[11px]">
              Change how it's written in Source.
            </span>
          )}
        </Group>
      )}
      {isImage && (
        <Group title="Image">
          {prop("alt")?.kind === "literal" && (
            <Field
              label="Description"
              hint="Read aloud, and shown when images are off."
              pending={pending("alt")}
            >
              <CommitInput
                ariaLabel="Image description"
                testId="design-properties.alt"
                value={prop("alt")?.value ?? ""}
                disabled={!available}
                onCommit={(value) =>
                  setLiteral(prop("alt")!, value, "Edit image description", "alt")
                }
              />
            </Field>
          )}
          <div className="grid grid-cols-2 gap-2">
            {(["width", "height"] as const).map((name) => {
              const field = prop(name);
              return field?.kind === "literal" ? (
                <Field key={name} label={`${propLabel(name)} (px)`} pending={pending(name)}>
                  <CommitInput
                    type="number"
                    ariaLabel={propLabel(name)}
                    testId={`design-properties.${name}`}
                    value={field.value}
                    disabled={!available}
                    onCommit={(value) => setLiteral(field, value, `Change image ${name}`, name)}
                  />
                </Field>
              ) : null;
            })}
          </div>
        </Group>
      )}
      {literalProps.length > 0 && (
        <Group title="Settings">
          <div className="grid grid-cols-2 gap-2">
            {literalProps.map((field) =>
              field.kind === "literal" ? (
                <Field
                  key={field.name}
                  label={withUnit(field)}
                  pending={pending(`prop.${field.name}`)}
                >
                  <CommitInput
                    type={field.literalType === "number" ? "number" : "text"}
                    ariaLabel={propLabel(field.name)}
                    testId={`design-properties.prop.${field.name}`}
                    value={field.value}
                    disabled={!available}
                    onCommit={(value) =>
                      setLiteral(
                        field,
                        value,
                        `Change ${propLabel(field.name).toLowerCase()}`,
                        `prop.${field.name}`,
                      )
                    }
                  />
                </Field>
              ) : (
                <Field key={field.name} label={withUnit(field)}>
                  <Badge
                    variant="secondary"
                    className="w-fit rounded-md font-mono text-[11px] font-normal"
                  >
                    {chipOf(`{${field.value}}`)?.label ?? field.value}
                  </Badge>
                </Field>
              ),
            )}
          </div>
        </Group>
      )}
      {(textLike || block) && !classesEditable && (
        <p data-testid="design-properties.computed" className="text-muted-foreground py-3 text-xs">
          This element's styles are worked out in the template, so they're changed in Source.
        </p>
      )}
      {(textLike || block) && classesEditable && (
        <>
          <Group title="Color">
            {colorField("text", "Text", "Change text color")}
            {block && colorField("bg", "Background", "Change background")}
          </Group>
          {textLike && (
            <Group title="Type">
              <Field label="Font">
                <FontField
                  testId="design-properties.font"
                  fonts={palette.fonts}
                  role={fontRole}
                  rendered={rendered?.fontFamily ?? null}
                  disabled={!available}
                  pending={pending("font")}
                  onChoose={(role) =>
                    swap(
                      (token) => token.startsWith("font-") && fontRoles.has(token.slice(5)),
                      role === null ? [] : [`font-${role}`],
                      "Change font",
                      "font",
                    )
                  }
                />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Size" pending={pending("size")}>
                  <NativeSelect
                    size="sm"
                    aria-label="Size"
                    data-testid="design-properties.size"
                    value={size ?? ""}
                    disabled={!available}
                    onChange={(event) =>
                      swap(
                        (token) => SIZE.test(token),
                        event.target.value === "" ? [] : [event.target.value],
                        "Change text size",
                        "size",
                      )
                    }
                    className="w-full"
                  >
                    <NativeSelectOption value="">
                      {renderedSize === null
                        ? "Default"
                        : `${formatPx(renderedSize)} px${size === undefined ? " · theme" : ""}`}
                    </NativeSelectOption>
                    {sizes.map((token) => (
                      <NativeSelectOption key={token} value={token}>
                        {sizeLabel(token)}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </Field>
                <Field label="Weight" pending={pending("weight")}>
                  <NativeSelect
                    size="sm"
                    aria-label="Weight"
                    data-testid="design-properties.weight"
                    value={weight ?? ""}
                    disabled={!available}
                    onChange={(event) =>
                      swap(
                        (token) => WEIGHT.test(token),
                        event.target.value === "" ? [] : [event.target.value],
                        "Change text weight",
                        "weight",
                      )
                    }
                    className="w-full"
                  >
                    <NativeSelectOption value="">
                      {renderedWeight === null
                        ? "Default"
                        : `${weightName(renderedWeight)}${weight === undefined ? " · theme" : ""}`}
                    </NativeSelectOption>
                    {[
                      ...(weight !== undefined && !WEIGHTS.some((option) => option.value === weight)
                        ? [{ value: weight, label: weightName(weightOfClass(weight)) }]
                        : []),
                      ...WEIGHTS,
                    ].map((option) => (
                      <NativeSelectOption key={option.value} value={option.value}>
                        {option.label}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </Field>
              </div>
            </Group>
          )}
          <Group title="Layout">
            <Field label="Alignment" pending={pending("align")}>
              <Segmented
                ariaLabel="Alignment"
                testId="design-properties.align"
                size="sm"
                value={align as "left" | "center" | "right"}
                onChange={(value) =>
                  available &&
                  swap((token) => ALIGN.test(token), [`text-${value}`], "Change alignment", "align")
                }
                options={[
                  {
                    value: "left",
                    title: "Align left",
                    label: <AlignLeft className="size-3.5" />,
                    testId: "design-properties.align.left",
                  },
                  {
                    value: "center",
                    title: "Align center",
                    label: <AlignCenter className="size-3.5" />,
                    testId: "design-properties.align.center",
                  },
                  {
                    value: "right",
                    title: "Align right",
                    label: <AlignRight className="size-3.5" />,
                    testId: "design-properties.align.right",
                  },
                ]}
              />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              {block ? (
                <>
                  {stepSelect("p", "x", "Padding sides", "padding-x")}
                  {stepSelect("p", "y", "Padding top and bottom", "padding-y")}
                </>
              ) : (
                <>
                  {stepSelect("m", "t", "Space above", "margin-top")}
                  {stepSelect("m", "b", "Space below", "margin-bottom")}
                </>
              )}
            </div>
          </Group>
        </>
      )}
    </div>
  );
}

/** A pixel setting names its unit: "Width (px)". */
const withUnit = (field: SourceProperty): string =>
  field.literalType === "number" && /width|height|padding|radius|size|margin|gap/i.test(field.name)
    ? `${propLabel(field.name)} (px)`
    : propLabel(field.name);

/** A size class in pixels: `text-[28px]` → 28, `text-2xl` → 24. */
const sizeRank = (token: string): number => {
  const px = /\[(\d+(?:\.\d+)?)px\]/.exec(token)?.[1];
  if (px !== undefined) return Number(px);
  return NAMED_SIZE_PX[token.slice(5)] ?? 0;
};

const formatPx = (px: number): string => `${Math.round(px * 10) / 10}`;

const sizeLabel = (token: string): string => `${formatPx(sizeRank(token))} px`;

/**
 * The sizes Size offers, small to large: Tailwind's scale, the pixel sizes the entry already
 * uses, the element's own class and the size it renders at. One class per pixel size, preferring
 * the element's class, then the entry's, then Tailwind's name.
 */
const sizeScale = (
  entrySource: string,
  current: string | undefined,
  renderedPx: number | null,
): ReadonlyArray<string> => {
  const byPx = new Map<number, string>();
  const offer = (token: string) => byPx.set(sizeRank(token), token);
  for (const name of NAMED_SIZES) offer(`text-${name}`);
  for (const match of entrySource.matchAll(/text-\[(\d+(?:\.\d+)?)px\]/g))
    offer(`text-[${match[1]}px]`);
  if (renderedPx !== null && !byPx.has(renderedPx)) offer(`text-[${formatPx(renderedPx)}px]`);
  if (current !== undefined) offer(current);
  return [...byPx].toSorted(([a], [b]) => a - b).map(([, token]) => token);
};

/** 700 → "Bold"; an in-between weight by its number. */
const weightName = (weight: number): string => WEIGHT_NAMES[weight] ?? `${weight}`;

const weightOfClass = (token: string): number => {
  const names: Record<string, number> = {
    thin: 100,
    extralight: 200,
    light: 300,
    normal: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
    extrabold: 800,
    black: 900,
  };
  return names[token.slice(5)] ?? 400;
};

/** Tailwind's spacing step as pixels (4px a step), or the arbitrary value as written. */
const stepLabel = (step: string): string => {
  const arbitrary = /^\[(.+)\]$/.exec(step)?.[1];
  if (arbitrary !== undefined) return arbitrary;
  const number = Number(step);
  return Number.isFinite(number) ? `${number * 4} px` : step;
};
