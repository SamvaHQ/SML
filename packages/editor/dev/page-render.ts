import type { PageRender } from "@samva/editor/host";
import { emailSelections, INSTANCE_PATH_ATTRIBUTE, type EmittedPosition } from "@samva/markup/edit";
import { render as renderMessage } from "@samva/markup/render";

// `@samva/markup` stamps `data-samva-instance` on the email preview but offers no web equivalent,
// so this host stamps the page itself from the offsets the web render reports: the same nesting
// walk, so a path means the same thing in both frames.

interface Placed {
  readonly start: number;
  readonly end: number;
  readonly tag: string;
  readonly src: string | undefined;
  readonly origins: EmittedPosition["origins"];
  path: string;
  parent: Placed | undefined;
}

type CompiledTemplate = Parameters<typeof renderMessage>[0];

export const renderPage = (
  template: CompiledTemplate,
  input: unknown,
  revision: string,
): PageRender => {
  const page = renderMessage(template, input, { target: "web" });
  const sources = template.sources ?? [];
  const ordered = page.positions
    .map((position): Placed => {
      const src = position.src;
      return {
        start: position.start,
        end: position.end,
        tag: position.tag,
        src: src === undefined ? undefined : src.join(":"),
        origins:
          src === undefined
            ? []
            : [{ fileName: sources[src[2] ?? 0] ?? "", lineNumber: src[0], columnNumber: src[1] }],
        path: "",
        parent: undefined,
      };
    })
    .toSorted((left, right) =>
      left.start === right.start ? right.end - left.end : left.start - right.start,
    );
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
  const inserts = ordered
    .map((element) => ({
      at: element.start + 1 + element.tag.length,
      text: ` ${INSTANCE_PATH_ATTRIBUTE}="${element.path}"`,
    }))
    .toSorted((left, right) => left.at - right.at);
  let body = "";
  let cursor = 0;
  for (const insert of inserts) {
    body += page.html.slice(cursor, insert.at) + insert.text;
    cursor = insert.at;
  }
  body += page.html.slice(cursor);
  const shift = (offset: number): number => {
    let moved = 0;
    for (const insert of inserts) {
      if (insert.at > offset) break;
      moved += insert.text.length;
    }
    return offset + moved;
  };
  const selections = emailSelections(
    ordered.map((element) => ({
      start: shift(element.start),
      end: shift(element.end),
      origins: element.origins,
      instancePath: element.path,
      tag: element.tag,
      authored:
        element.src !== undefined &&
        (element.parent === undefined || element.parent.src !== element.src),
    })),
  );
  // The shell wraps the body fragment in the host's document, carrying the page's own styles.
  const html = `<!doctype html><html lang="${page.headHints.lang ?? "en"}"><head><meta charset="utf-8"><title>${page.headHints.title ?? ""}</title><style>${page.headHints.styles}</style></head><body>${body}</body></html>`;
  const headerLength = html.length - body.length - "</body></html>".length;
  return {
    kind: "page",
    revision,
    html,
    selections: selections.map((selection) => ({
      ...selection,
      start: selection.start + headerLength,
      end: selection.end + headerLength,
    })),
  };
};
