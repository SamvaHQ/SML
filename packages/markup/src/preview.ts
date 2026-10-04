import type { RenderedIrEmail, RenderOptions, TemplateIr } from "./ir";
import { renderIr } from "./render-ir";
import type { JsxSourceLocation } from "./source-locations";

// A rendered email is what a visual editor points at, and source is what it edits. These are the
// two ends of that mapping. The compiler records the source span of every node it lowers, the
// renderer reports where each element landed in the HTML, and this module joins the two: an
// instance path names one rendered element, and its origin is the authored element that produced
// it. Nothing runs to learn this; a node that did not render (an untaken branch) has no selection,
// and the fixture that takes the branch does.

/**
 * The attribute a preview stamps so a click in a rendered document resolves to exactly one
 * rendered element. A delivered message never carries it.
 */
export const INSTANCE_PATH_ATTRIBUTE = "data-samva-instance";

/** Where one element sits in the emitted document, with the authoring that produced it. */
export interface EmittedPosition {
  readonly start: number;
  readonly end: number;
  readonly origins: ReadonlyArray<JsxSourceLocation>;
  /**
   * Dot-separated element indices from the document root, assigned in document order. It is the
   * identity of one rendered instance.
   */
  readonly instancePath: string;
  readonly tag: string;
  /** False when a compiler primitive generated this element. */
  readonly authored: boolean;
}

/** One rendered element, and the authoring it came from. */
export interface EmailElementSelection {
  /**
   * Dot-separated element indices from the document root. It is the identity of one rendered
   * instance, which is what tells two iterations of the same authored element apart: their
   * origins are identical.
   */
  readonly instancePath: string;
  readonly tag: string;
  /**
   * The authored JSX element. Empty when the compiler generated this element with no authoring
   * behind it, the hidden preheader block for instance.
   */
  readonly origins: ReadonlyArray<JsxSourceLocation>;
  /**
   * False when a compiler primitive generated this element. `origins[0]` is then the authoring
   * element that asked for it rather than this element itself, so the wrapper selects the
   * primitive the author wrote.
   */
  readonly authored: boolean;
  /** 1-based position among the rendered elements sharing this origin and tag. */
  readonly occurrence: number;
  /**
   * How many rendered elements share that origin and tag. Above one, one piece of authoring
   * produced several rendered elements (a loop, or a primitive that generates a repeated cell),
   * so an edit there changes all of them.
   */
  readonly occurrences: number;
  /** Absent for the document root. */
  readonly parentPath?: string;
  /** Offset range in the rendered HTML this selection was taken from. */
  readonly start: number;
  readonly end: number;
}

/** A render of one fixture for an editor: the delivered content plus the identity of every element. */
export interface IrPreview {
  readonly subject: string;
  readonly preheader: string | undefined;
  /** Carries `INSTANCE_PATH_ATTRIBUTE` on every element. Preview-only. */
  readonly html: string;
  readonly text: string;
  /** Every rendered element in document order. */
  readonly selections: readonly EmailElementSelection[];
}

const locationKey = (origin: JsxSourceLocation): string =>
  `${origin.fileName}:${origin.lineNumber}:${origin.columnNumber}`;

const originKey = (selection: {
  readonly origins: readonly JsxSourceLocation[];
  readonly tag: string;
}): string => `${selection.tag}\u0000${selection.origins.map(locationKey).join("\u0000")}`;

const parentOf = (instancePath: string): string | undefined => {
  const cut = instancePath.lastIndexOf(".");
  return cut === -1 ? undefined : instancePath.slice(0, cut);
};

/**
 * Turn one render's positions into selections, in document order. `occurrence` and `occurrences`
 * count the rendered elements that share an authored origin and tag.
 */
export const emailSelections = (
  positions: readonly EmittedPosition[],
): readonly EmailElementSelection[] => {
  const counts = new Map<string, number>();
  for (const position of positions) {
    const key = originKey(position);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const seen = new Map<string, number>();
  const ordered = [...positions].toSorted((left, right) =>
    left.start === right.start ? right.end - left.end : left.start - right.start,
  );
  return ordered.map((position) => {
    const key = originKey(position);
    const occurrence = (seen.get(key) ?? 0) + 1;
    seen.set(key, occurrence);
    const parentPath = parentOf(position.instancePath);
    return {
      instancePath: position.instancePath,
      tag: position.tag,
      origins: position.origins,
      authored: position.authored,
      occurrence,
      occurrences: counts.get(key) ?? 1,
      ...(parentPath === undefined ? {} : { parentPath }),
      start: position.start,
      end: position.end,
    };
  });
};

interface Placed {
  readonly start: number;
  readonly end: number;
  readonly tag: string;
  readonly src: string | undefined;
  readonly origins: readonly JsxSourceLocation[];
  path: string;
  parent: Placed | undefined;
}

/**
 * Render one fixture with an instance path stamped on every element, and the selection each path
 * resolves to. The selections come from the spans the compiler recorded, so a click on the canvas
 * lands on the exact node of the source that produced it.
 */
export const renderIrPreview = (
  ir: TemplateIr,
  input: unknown,
  options: Omit<RenderOptions, "positions"> = {},
): IrPreview => {
  const rendered: RenderedIrEmail = renderIr(ir, input, { ...options, positions: true });
  const sources = ir.sources ?? [];
  const ordered = (rendered.positions ?? [])
    .map((position): Placed => {
      const src = position.src;
      const origins: readonly JsxSourceLocation[] =
        src === undefined
          ? []
          : [{ fileName: sources[src[2] ?? 0] ?? "", lineNumber: src[0], columnNumber: src[1] }];
      return {
        start: position.start,
        end: position.end,
        tag: position.tag,
        src: src === undefined ? undefined : src.join(":"),
        origins,
        path: "",
        parent: undefined,
      };
    })
    .toSorted((left, right) =>
      left.start === right.start ? right.end - left.end : left.start - right.start,
    );

  // Ranges nest properly, so a stack of open elements yields each element's parent and the index
  // it holds among its siblings.
  const open: Placed[] = [];
  const childCount = new Map<Placed | undefined, number>();
  for (const element of ordered) {
    while (open.length > 0 && open[open.length - 1]!.end <= element.start) open.pop();
    const parent = open[open.length - 1];
    const index = childCount.get(parent) ?? 0;
    childCount.set(parent, index + 1);
    element.parent = parent;
    element.path = parent === undefined ? String(index) : `${parent.path}.${index}`;
    open.push(element);
  }

  // Stamp the attribute after each opening tag name, then move every offset by what was inserted
  // before it.
  const inserts = ordered.map((element) => ({
    at: element.start + 1 + element.tag.length,
    text: ` ${INSTANCE_PATH_ATTRIBUTE}="${element.path}"`,
  }));
  inserts.sort((left, right) => left.at - right.at);
  let html = "";
  let cursor = 0;
  for (const insert of inserts) {
    html += rendered.html.slice(cursor, insert.at) + insert.text;
    cursor = insert.at;
  }
  html += rendered.html.slice(cursor);
  const shift = (offset: number): number => {
    let moved = 0;
    for (const insert of inserts) {
      if (insert.at > offset) break;
      moved += insert.text.length;
    }
    return offset + moved;
  };

  const positions = ordered.map((element): EmittedPosition => ({
    start: shift(element.start),
    end: shift(element.end),
    origins: element.origins,
    instancePath: element.path,
    tag: element.tag,
    // A primitive lowers to several elements that all carry the call site's span; the outermost
    // stands for what the author wrote and the ones inside it are generated.
    authored:
      element.src !== undefined &&
      (element.parent === undefined || element.parent.src !== element.src),
  }));
  const selections = emailSelections(positions);
  return {
    subject: rendered.subject,
    preheader: rendered.preheader,
    html,
    text: rendered.text,
    selections,
  };
};

/** Look selections up by the instance path a rendered document carries. */
export const emailSelectionIndex = (
  selections: readonly EmailElementSelection[],
): ReadonlyMap<string, EmailElementSelection> =>
  new Map(selections.map((selection) => [selection.instancePath, selection]));

/**
 * The authoring element a selection edits. For an authored element that is the element itself; for
 * a generated wrapper it is the primitive that asked for it. Undefined only where the compiler
 * generated markup with no authoring behind it, which nothing can edit in place.
 */
export const emailAuthoringTarget = (
  selection: EmailElementSelection,
): JsxSourceLocation | undefined => selection.origins[0];

/** Root-first ancestry of a selection, itself last. */
export const emailSelectionAncestry = (
  index: ReadonlyMap<string, EmailElementSelection>,
  instancePath: string,
): readonly EmailElementSelection[] => {
  const chain: EmailElementSelection[] = [];
  let current = index.get(instancePath);
  while (current !== undefined) {
    chain.unshift(current);
    current = current.parentPath === undefined ? undefined : index.get(current.parentPath);
  }
  return chain;
};

/**
 * Every rendered instance produced by the same authored element, in document order. One entry
 * means it rendered once; several mean it repeated.
 */
export const emailSelectionSiblings = (
  selections: readonly EmailElementSelection[],
  selection: EmailElementSelection,
): readonly EmailElementSelection[] => {
  const key = originKey(selection);
  return selections.filter((candidate) => originKey(candidate) === key);
};

/**
 * Every rendered instance of the same authored element. A partial edited at its definition changes
 * all of these, which is the scope a control has to name before it applies.
 */
export const emailDefinitionInstances = (
  selections: readonly EmailElementSelection[],
  selection: EmailElementSelection,
): readonly EmailElementSelection[] => {
  const authoring = selection.origins[0];
  const key = `${selection.tag}\u0000${authoring === undefined ? "" : locationKey(authoring)}`;
  return selections.filter((candidate) => {
    const origin = candidate.origins[0];
    return `${candidate.tag}\u0000${origin === undefined ? "" : locationKey(origin)}` === key;
  });
};
