import {
  classNameEdit,
  literalReplacement,
  type SourceElement,
  type SourceProperty,
  type SourceReplacement,
} from "@samva/markup/edit";
import { useEffect, useState, type ReactNode } from "react";

import { useEditorStore } from "../state/context";
import { Badge } from "../ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../ui/collapsible";
import { Input } from "../ui/input";
import { NativeSelect, NativeSelectOption } from "../ui/native-select";
import { Toggle } from "../ui/toggle";
import { AlignCenter, AlignLeft, AlignRight, ChevronRight } from "./editor-icons";
import { classTokens, propLabel, themeColors, usedColorTokens, type ThemeColor } from "./friendly";
import { THEME_PATH } from "./theme-brand";
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

/** Class tokens without a variant prefix (`dark:`, `sm:`): the ones these controls own. */
const plain = (tokens: ReadonlyArray<string>) => tokens.filter((token) => !token.includes(":"));

/** The theme's colors, read from the project's theme file when the host can read it. */
function useThemeColors(entrySource: string): ReadonlyArray<ThemeColor> {
  const capability = useEditorStore((state) => state.lifecycleCapability);
  const [theme, setTheme] = useState<ReadonlyArray<ThemeColor> | null>(null);
  useEffect(() => {
    if (capability?.status !== "ready") return;
    let cancelled = false;
    void capability.api.inspect().then(
      (state) => {
        const file = state.files.find((entry) => entry.path === THEME_PATH);
        if (!cancelled && file?.content != null) setTheme(themeColors(file.content));
      },
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [capability]);
  if (theme !== null && theme.length > 0) return theme;
  return usedColorTokens(entrySource).map((name) => ({ name, value: undefined }));
}

function Field({
  label,
  children,
  hint,
  value,
}: {
  readonly label: string;
  readonly children: ReactNode;
  readonly hint?: string | undefined;
  /** The current value, named beside the label. */
  readonly value?: string | undefined;
}) {
  return (
    <div data-slot="editor-design-field" className="flex flex-col gap-1.5">
      <span className="flex items-baseline justify-between gap-2 text-xs">
        <span className="text-muted-foreground">{label}</span>
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
  | { readonly kind: "chip"; readonly label: string };

/** "{input.firstName}" → "firstName", `<Link …>…</Link>` → "Link". */
const chipLabel = (code: string): string | null => {
  const trimmed = code.trim();
  if (trimmed === "") return null;
  if (/^\{\s*(["'`])\s*\1\s*\}$/.test(trimmed) || /^\{\s*" "\s*\}$/.test(trimmed)) return null;
  const element = /^<([A-Za-z][\w.]*)/.exec(trimmed)?.[1];
  if (element !== undefined) return element;
  const expression = trimmed.replace(/^\{|\}$/g, "").trim();
  return expression.split(".").at(-1) ?? expression;
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
    return texts.map((field) =>
      field.kind === "literal"
        ? { kind: "text", field }
        : { kind: "chip", label: chipLabel(`{${field.value}}`) ?? field.value },
    );
  }
  const segments: Segment[] = [];
  let at = start;
  const gap = (until: number) => {
    const code = source.slice(at, until);
    const pattern = inline ? /\{[^{}]*\}|<[A-Za-z][\s\S]*?(?:\/>|<\/[^>]+>)/g : /\{[^{}]*\}/g;
    for (const part of code.match(pattern) ?? []) {
      const label = chipLabel(part);
      if (label !== null) segments.push({ kind: "chip", label });
    }
  };
  for (const field of texts) {
    gap(field.start);
    segments.push(
      field.kind === "literal"
        ? { kind: "text", field }
        : { kind: "chip", label: chipLabel(`{${field.value}}`) ?? field.value },
    );
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
  readonly available: boolean;
  /** Stage (or, for a partial, save) the edits under a label. */
  readonly commit: (edits: readonly SourceReplacement[], label: string) => void;
  readonly onRefused: (reason: string) => void;
}

/**
 * The controls an author edits a selected element with: its text, its image description and
 * size, its colors from the theme, its type, its spacing and its alignment. Only what the element
 * supports is shown.
 */
export function DesignProperties({
  source,
  entrySource,
  target,
  available,
  commit,
  onRefused,
}: DesignPropertiesProps) {
  const colors = useThemeColors(entrySource);
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

  const setClasses = (next: ReadonlyArray<string>, label: string) => {
    const result = classNameEdit(source, target, { kind: "set", value: next.join(" ") });
    if (!result.ok) onRefused(result.reason);
    else if (result.edits.length > 0) commit(result.edits, label);
  };
  /** Swap the tokens `owned` matches for `add`, keeping every other class and its order. */
  const swap = (owned: (token: string) => boolean, add: ReadonlyArray<string>, label: string) =>
    setClasses(
      [...allTokens.filter((token) => token.includes(":") || !owned(token)), ...add],
      label,
    );
  const setLiteral = (field: SourceProperty, value: string, label: string) => {
    const edit = literalReplacement(source, field, value);
    if (edit === null) onRefused(`That value doesn't fit ${propLabel(field.name)}.`);
    else commit([edit], label);
  };

  const segments = contentSegments(source, target, textLike);
  const prop = (name: string) => target.properties.find((field) => field.name === name);
  const literalProps = target.properties.filter(
    (field) =>
      field.syntax !== "child" &&
      field.name !== "className" &&
      !(isImage && ["alt", "width", "height", "src"].includes(field.name)),
  );

  const colorToken = (prefix: "text" | "bg") =>
    tokens.find(
      (token) => token.startsWith(`${prefix}-`) && colorNames.has(token.slice(prefix.length + 1)),
    );
  const customColor = (prefix: "text" | "bg") =>
    tokens.find((token) => new RegExp(`^${prefix}-\\[#`).test(token));
  const isColor = (prefix: "text" | "bg") => (token: string) =>
    (token.startsWith(`${prefix}-`) && colorNames.has(token.slice(prefix.length + 1))) ||
    new RegExp(`^${prefix}-\\[#`).test(token);

  const sizes = [
    ...new Set([
      ...[...entrySource.matchAll(/text-\[(\d+(?:\.\d+)?)px\]/g)].map(
        (match) => `text-[${match[1]}px]`,
      ),
      ...NAMED_SIZES.filter((name) =>
        new RegExp(`(?:^|[\\s"'\`])text-${name}(?=[\\s"'\`])`).test(entrySource),
      ).map((name) => `text-${name}`),
    ]),
  ].toSorted((a, b) => sizeRank(a) - sizeRank(b));
  const size = tokens.find((token) => SIZE.test(token));
  const weight = tokens.find((token) => WEIGHT.test(token));
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
  const setAxis = (kind: "p" | "m", sides: "x" | "y" | "t" | "b", step: string, label: string) => {
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
    setClasses(next, label);
  };

  const stepSelect = (
    kind: "p" | "m",
    sides: "x" | "y" | "t" | "b",
    label: string,
    testId: string,
  ) => {
    const current = axis(kind, sides);
    const options =
      SPACING_STEPS.includes(current) || current === ""
        ? SPACING_STEPS
        : [current, ...SPACING_STEPS];
    return (
      <Field label={label}>
        <NativeSelect
          size="sm"
          aria-label={label}
          data-testid={testId}
          value={current}
          disabled={!available}
          onChange={(event) =>
            setAxis(kind, sides, event.target.value, `Change ${label.toLowerCase()}`)
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

  const colorPicker = (prefix: "text" | "bg", label: string, testId: string) => {
    const current = colorToken(prefix);
    const custom = customColor(prefix);
    return (
      <Field
        label={label}
        value={
          current !== undefined
            ? current.slice(prefix.length + 1)
            : custom !== undefined
              ? custom.slice(prefix.length + 2, -1)
              : "Not set"
        }
      >
        <div
          data-slot="editor-design-swatches"
          data-testid={testId}
          className="flex flex-wrap gap-1"
        >
          {colors.map((color) => {
            const token = `${prefix}-${color.name}`;
            const selected = current === token;
            return (
              <Toggle
                key={color.name}
                variant="outline"
                size="sm"
                aria-label={`${label}: ${color.name}`}
                pressed={selected}
                data-testid={`${testId}.${color.name}`}
                disabled={!available}
                onPressedChange={() =>
                  swap(isColor(prefix), selected ? [] : [token], `Change ${label.toLowerCase()}`)
                }
                className="text-foreground aria-pressed:border-ring aria-pressed:ring-ring/30 h-6 min-w-0 gap-1.5 rounded-md pr-2 pl-1 text-[11px] font-normal aria-pressed:ring-2"
              >
                <span
                  aria-hidden
                  className="size-3.5 shrink-0 rounded-[4px] border border-black/10 dark:border-white/15"
                  style={{
                    background:
                      color.value ??
                      "repeating-linear-gradient(45deg, var(--muted), var(--muted) 3px, transparent 3px, transparent 6px)",
                  }}
                />
                {color.name}
              </Toggle>
            );
          })}
        </div>
        <Collapsible>
          <CollapsibleTrigger
            data-testid={`${testId}.custom-toggle`}
            className="text-muted-foreground hover:text-foreground group/custom flex items-center gap-1 text-[11px] outline-none"
          >
            <ChevronRight className="size-3 transition-transform group-data-[panel-open]/custom:rotate-90" />
            Custom color
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-1.5">
            <CommitInput
              ariaLabel={`${label} hex`}
              testId={`${testId}.custom`}
              value={custom?.slice(prefix.length + 2, -1) ?? ""}
              placeholder="#b4532a"
              disabled={!available}
              onCommit={(value) => {
                const hex = value.trim();
                if (hex !== "" && !/^#[0-9a-f]{3,8}$/i.test(hex)) {
                  onRefused("A custom color is a hex value such as #b4532a.");
                  return;
                }
                swap(
                  isColor(prefix),
                  hex === "" ? [] : [`${prefix}-[${hex}]`],
                  `Change ${label.toLowerCase()}`,
                );
              }}
            />
          </CollapsibleContent>
        </Collapsible>
      </Field>
    );
  };

  const hasText = segments.some((segment) => segment.kind === "text");
  return (
    <div
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
                  label="Filled in from the data each send. Change it in Source."
                >
                  <Badge
                    variant="secondary"
                    data-testid="design-properties.binding"
                    className="w-fit rounded-md font-mono text-[11px] font-normal"
                  >
                    {segment.label}
                  </Badge>
                </Tip>
              ) : (
                <CommitInput
                  key={`${segment.field.name}`}
                  ariaLabel="Text"
                  testId={`design-properties.text.${segment.field.name}`}
                  value={segment.field.value}
                  disabled={!available}
                  onCommit={(value) => setLiteral(segment.field, value, "Edit text")}
                  className="min-w-40 flex-1"
                />
              ),
            )}
            {!hasText && (
              <span className="text-muted-foreground text-[11px]">
                This content comes from the data. Change how it's written in Source.
              </span>
            )}
          </div>
        </Group>
      )}
      {isImage && (
        <Group title="Image">
          {prop("alt")?.kind === "literal" && (
            <Field label="Description" hint="Read aloud, and shown when images are off.">
              <CommitInput
                ariaLabel="Image description"
                testId="design-properties.alt"
                value={prop("alt")?.value ?? ""}
                disabled={!available}
                onCommit={(value) => setLiteral(prop("alt")!, value, "Edit image description")}
              />
            </Field>
          )}
          <div className="grid grid-cols-2 gap-2">
            {(["width", "height"] as const).map((name) => {
              const field = prop(name);
              return field?.kind === "literal" ? (
                <Field key={name} label={propLabel(name)}>
                  <CommitInput
                    type="number"
                    ariaLabel={propLabel(name)}
                    testId={`design-properties.${name}`}
                    value={field.value}
                    disabled={!available}
                    onCommit={(value) => setLiteral(field, value, `Change image ${name}`)}
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
                <Field key={field.name} label={propLabel(field.name)}>
                  <CommitInput
                    type={field.literalType === "number" ? "number" : "text"}
                    ariaLabel={propLabel(field.name)}
                    testId={`design-properties.prop.${field.name}`}
                    value={field.value}
                    disabled={!available}
                    onCommit={(value) =>
                      setLiteral(field, value, `Change ${propLabel(field.name).toLowerCase()}`)
                    }
                  />
                </Field>
              ) : (
                <Field key={field.name} label={propLabel(field.name)}>
                  <Badge
                    variant="secondary"
                    className="w-fit rounded-md font-mono text-[11px] font-normal"
                  >
                    {chipLabel(`{${field.value}}`) ?? field.value}
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
            {colorPicker("text", "Text color", "design-properties.color.text")}
            {block && colorPicker("bg", "Background", "design-properties.color.bg")}
          </Group>
          {textLike && (
            <Group title="Type">
              <div className="grid grid-cols-2 gap-2">
                <Field label="Size">
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
                      )
                    }
                    className="w-full"
                  >
                    <NativeSelectOption value="">Default</NativeSelectOption>
                    {[...new Set([...(size === undefined ? [] : [size]), ...sizes])].map(
                      (token) => (
                        <NativeSelectOption key={token} value={token}>
                          {sizeLabel(token)}
                        </NativeSelectOption>
                      ),
                    )}
                  </NativeSelect>
                </Field>
                <Field label="Weight">
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
                      )
                    }
                    className="w-full"
                  >
                    <NativeSelectOption value="">Default</NativeSelectOption>
                    {WEIGHTS.map((option) => (
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
            <Field label="Alignment">
              <Segmented
                ariaLabel="Alignment"
                testId="design-properties.align"
                size="sm"
                value={align as "left" | "center" | "right"}
                onChange={(value) =>
                  available &&
                  swap((token) => ALIGN.test(token), [`text-${value}`], "Change alignment")
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
                  {stepSelect("p", "x", "Padding sides", "design-properties.padding-x")}
                  {stepSelect("p", "y", "Padding top and bottom", "design-properties.padding-y")}
                </>
              ) : (
                <>
                  {stepSelect("m", "t", "Space above", "design-properties.margin-top")}
                  {stepSelect("m", "b", "Space below", "design-properties.margin-bottom")}
                </>
              )}
            </div>
          </Group>
        </>
      )}
    </div>
  );
}

/** Order type sizes small to large: named steps, then pixel sizes by value. */
const sizeRank = (token: string): number => {
  const px = /\[(\d+(?:\.\d+)?)px\]/.exec(token)?.[1];
  if (px !== undefined) return Number(px);
  const named: Record<string, number> = {
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
  return named[token.slice(5)] ?? 0;
};

const sizeLabel = (token: string): string => `${sizeRank(token)} px`;

/** Tailwind's spacing step as pixels (4px a step), or the arbitrary value as written. */
const stepLabel = (step: string): string => {
  const arbitrary = /^\[(.+)\]$/.exec(step)?.[1];
  if (arbitrary !== undefined) return arbitrary;
  const number = Number(step);
  return Number.isFinite(number) ? `${number * 4} px` : step;
};
