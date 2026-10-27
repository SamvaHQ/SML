/* oxlint-disable samva/no-hand-rolled-object-guard -- Target lowering discriminates validated JSON IR without evaluating its expressions. */
import type {
  CompiledElement,
  CompiledNode,
  CompiledStyle,
  CompiledValue,
} from "../compiled-template";
import type { BrandPlugin } from "../email/brand-plugin";
import { emailElement } from "../email/elements";
import {
  isValueNode,
  type SemanticComponent,
  type SemanticProp,
  type WebCssRule,
  type WebPresentation,
} from "../ir/nodes";

/** Web-only defaults live below project utilities; explicit props are emitted separately. */
export const webBaseStyles = (
  rootBackground: "template" | "transparent",
): readonly WebCssRule[] => [
  {
    at: "layer sml-web-components",
    children: [
      {
        selector: ":where(.sml-web-email,.sml-web-email *)",
        style: [["box-sizing", "border-box"]],
      },
      {
        selector: ".sml-web-email",
        style: [
          ["color", "var(--color-foreground)"],
          ["font-family", "var(--font-sans)"],
          ...(rootBackground === "transparent"
            ? []
            : ([["background-color", "var(--color-background)"]] as const)),
          ["padding-inline", "16px"],
        ],
      },
      {
        selector: ".sml-web-section",
        style: [
          ["width", "100%"],
          ["margin-inline", "auto"],
        ],
      },
      {
        selector: ".sml-web-columns",
        style: [
          ["display", "grid"],
          ["grid-auto-flow", "column"],
          ["grid-auto-columns", "minmax(0,1fr)"],
          ["grid-template-columns", "var(--sml-web-columns,none)"],
          ["width", "100%"],
          ["margin-inline", "auto"],
        ],
      },
      { selector: ".sml-web-column", style: [["min-width", "0"]] },
      {
        selector: ".sml-web-button",
        style: [
          ["display", "inline-flex"],
          ["align-items", "center"],
          ["justify-content", "center"],
          ["box-sizing", "border-box"],
          ["background-color", "var(--color-primary)"],
          ["color", "var(--color-primary-foreground)"],
          ["font-family", "var(--font-sans)"],
          ["border-radius", "var(--radius)"],
          ["font-size", "16px"],
          ["font-weight", "bold"],
          ["line-height", "1.2"],
          ["padding-inline", "16px"],
          ["text-align", "center"],
          ["text-decoration", "none"],
          ["max-width", "100%"],
        ],
      },
      {
        selector: ".sml-web-link",
        style: [
          ["color", "var(--color-primary)"],
          ["text-decoration", "underline"],
        ],
      },
      {
        selector: ".sml-web-divider",
        style: [
          ["border", "0"],
          ["border-top", "1px solid var(--color-border)"],
        ],
      },
      {
        selector: ".sml-web-image",
        style: [
          ["display", "block"],
          ["max-width", "100%"],
          ["height", "auto"],
        ],
      },
      { selector: ".sml-web-logo-dark", style: [["display", "none"]] },
      {
        selector: ".sml-web-footer",
        style: [
          ["padding", "32px 16px"],
          ["font-size", "0.75rem"],
          ["color", "var(--color-muted-foreground)"],
          ["text-align", "center"],
        ],
      },
      { selector: ".sml-web-footer address", style: [["font-style", "normal"]] },
      {
        at: "media (max-width:599px)",
        children: [
          {
            selector: ".sml-web-columns-stack",
            style: [
              ["grid-auto-flow", "row"],
              ["grid-template-columns", "minmax(0,1fr)"],
            ],
          },
          {
            selector: ".sml-web-columns-stack > .sml-web-column",
            style: [
              ["width", "100%!important"],
              ["max-width", "100%!important"],
            ],
          },
        ],
      },
      {
        at: "media (prefers-color-scheme:dark)",
        children: [
          { selector: ".sml-web-logo-light", style: [["display", "none"]] },
          { selector: ".sml-web-logo-dark", style: [["display", "block"]] },
        ],
      },
    ],
  },
];

/** Only the semantic web tags added by lowering extend the shared serializer vocabulary. */
export const webElement = (tag: string) =>
  ["main", "section", "footer", "address"].includes(tag) ? emailElement("div") : emailElement(tag);

export interface WebHeadValues {
  readonly title?: CompiledValue;
  readonly titleNodes?: readonly CompiledNode[];
  readonly lang?: CompiledValue;
  readonly dir?: CompiledValue;
}

const value = (prop: SemanticProp | undefined): CompiledValue | undefined =>
  typeof prop === "object" && prop !== null && "object" in prop ? undefined : prop;

const choose = (
  prop: CompiledValue,
  expected: string,
  yes: string,
  no: CompiledValue,
): CompiledValue => ({ if: { cmp: "eq", args: [prop, expected] }, then: yes, else: no });

const styleFields = (
  prop: SemanticProp | undefined,
): readonly (readonly [string, CompiledValue])[] => {
  if (typeof prop !== "object" || prop === null || !("object" in prop)) return [];
  return Object.entries(prop.object).flatMap(([key, field]) => {
    const resolved = value(field);
    return resolved === undefined ? [] : [[key, resolved] as const];
  });
};

const layoutStyle = (entries: readonly (readonly [string, CompiledValue])[]) =>
  entries.filter(
    ([property]) =>
      !/^(?:mso|borderCollapse$|borderSpacing$|tableLayout$|border-collapse$|border-spacing$|table-layout$)/i.test(
        property,
      ),
  );

/** Lower identity and layout only. Shared renderer evaluation resolves all bindings and loops. */
export const lowerWebNodes = (
  nodes: readonly CompiledNode[],
  plugin: BrandPlugin,
  reject: (message: string) => never,
  presentation?: WebPresentation,
): {
  readonly nodes: readonly CompiledNode[];
  readonly headHints: ReadonlyMap<CompiledElement, WebHeadValues>;
  readonly stylesheets: ReadonlyMap<CompiledNode, readonly WebCssRule[]>;
  readonly gridTracks: ReadonlyMap<CompiledValue, readonly (CompiledValue | undefined)[]>;
} => {
  const headHints = new Map<CompiledElement, WebHeadValues>();
  const stylesheets = new Map<CompiledNode, readonly WebCssRule[]>();
  // Track dimensions must resolve individually in the renderer's current loop scope.
  const gridTracks = new Map<CompiledValue, readonly (CompiledValue | undefined)[]>();
  let stylesheet = 0;
  const titleNodes = (list: readonly CompiledNode[]): CompiledNode[] =>
    list.flatMap((node): CompiledNode[] => {
      if (isValueNode(node)) return [];
      if ("if" in node) {
        const then = titleNodes(node.then);
        const otherwise = titleNodes(node.else ?? []);
        return then.length === 0 && otherwise.length === 0
          ? []
          : [
              {
                ...node,
                then,
                ...(node.else === undefined ? {} : { else: otherwise }),
              },
            ];
      }
      if ("each" in node) {
        const children = titleNodes(node.children);
        return children.length === 0 ? [] : [{ ...node, children }];
      }
      if ("type" in node && node.type === "component") return [];
      if ("type" in node || "el" in node) {
        const tag = "type" in node ? node.tag : node.el;
        if (tag === "title") return [...(node.children ?? [])];
        if (tag === "head") return titleNodes(node.children ?? []);
      }
      return [];
    });
  const walk = (list: readonly CompiledNode[], sizedTracks = false): CompiledNode[] =>
    list.flatMap((node): CompiledNode[] => {
      if (isValueNode(node)) return [node];
      if ("type" in node && node.type === "component") return component(node, sizedTracks);
      if ("type" in node || "el" in node) {
        const tag = "type" in node ? node.tag : node.el;
        if (tag === "head") return walk(node.children ?? []);
        if (tag === "title" || tag === "meta") return [];
        if (tag === "style") {
          const marker: CompiledElement = { el: "style" };
          const rules = presentation?.stylesheets?.[stylesheet++];
          if (rules === undefined)
            return reject("Authored styles require a compiler-parsed web stylesheet.");
          stylesheets.set(marker, rules);
          return [marker];
        }
        if (["script", "link"].includes(tag))
          return reject("Web bodies cannot contain raw text or shell metadata elements.");
        const mapped = tag === "html" ? "main" : tag === "body" ? "div" : tag;
        const attrs =
          tag === "html"
            ? Object.fromEntries(
                Object.entries(node.attrs ?? {}).filter(([key]) => !key.startsWith("xmlns")),
              )
            : tag === "body"
              ? Object.fromEntries(
                  Object.entries(node.attrs ?? {}).filter(([key]) => key !== "bgcolor"),
                )
              : node.attrs;
        const output: CompiledElement = {
          el: mapped,
          ...(attrs === undefined ? {} : { attrs }),
          ...(node.style === undefined ? {} : { style: node.style }),
          ...(node.src === undefined ? {} : { src: node.src }),
          ...(node.children === undefined ? {} : { children: walk(node.children) }),
        };
        if (tag === "html")
          headHints.set(output, {
            ...(node.attrs?.lang === undefined ? {} : { lang: node.attrs.lang }),
            ...(node.attrs?.dir === undefined ? {} : { dir: node.attrs.dir }),
            titleNodes: titleNodes(node.children ?? []),
          });
        if (tag === "body" && node.attrs?.bgcolor !== undefined)
          return [
            {
              el: "div",
              style: [["backgroundColor", node.attrs.bgcolor]],
              children: [output],
              ...(node.src === undefined ? {} : { src: node.src }),
            },
          ];
        return [output];
      }
      if ("each" in node) return [{ ...node, children: walk(node.children, sizedTracks) }];
      if ("if" in node)
        return [
          {
            ...node,
            then: walk(node.then, sizedTracks),
            ...(node.else === undefined ? {} : { else: walk(node.else, sizedTracks) }),
          },
        ];
      if ("preheader" in node) return [];
      return reject("Raw email compatibility markup cannot be rendered to the web.");
    });

  const component = (node: SemanticComponent, sizedTracks: boolean): CompiledNode[] => {
    const p = node.props ?? {};
    const get = (key: string) => {
      const field = p[key];
      if (typeof field === "object" && field !== null && "object" in field)
        return reject(`Component prop ${key} must be a scalar expression.`);
      return field;
    };
    for (const key of ["style", "tableStyle"]) {
      const field = p[key];
      if (
        field !== undefined &&
        (typeof field !== "object" || field === null || !("object" in field))
      )
        return reject(`Component ${key} must contain named declarations.`);
      if (
        typeof field === "object" &&
        field !== null &&
        "object" in field &&
        Object.values(field.object).some(
          (v) => typeof v === "object" && v !== null && "object" in v,
        )
      )
        return reject("Style declarations cannot contain nested objects.");
    }
    const attrs: Record<string, CompiledValue> = {};
    const css = new Map<string, CompiledValue>();
    const set = (key: string, v: CompiledValue | undefined) => {
      if (v !== undefined) css.set(key, v);
    };
    const copy = (...keys: string[]) => {
      for (const key of keys) {
        const v = get(key);
        if (v !== undefined) attrs[key] = v;
      }
    };
    const style = (...keys: string[]) => {
      for (const key of keys) set(key, get(key));
    };
    const alignment = (v: CompiledValue | undefined) => {
      if (v === undefined) return;
      set("marginLeft", choose(v, "right", "auto", choose(v, "center", "auto", "0")));
      set("marginRight", choose(v, "left", "auto", choose(v, "center", "auto", "0")));
    };
    let tag: string;
    let own = `sml-web-${node.name.toLowerCase()}`;
    const fixedTracks =
      node.name === "Columns" &&
      (node.children?.length ?? 0) > 0 &&
      node.children!.every(
        (kid) =>
          typeof kid === "object" &&
          kid !== null &&
          "type" in kid &&
          kid.type === "component" &&
          kid.name === "Column",
      );
    let kids = walk(node.children ?? [], fixedTracks);
    if ((node.children?.length ?? 0) === 0) {
      const content = get("children");
      if (content !== undefined) kids = [content];
    }
    const child = (
      el: string,
      children: readonly CompiledNode[],
      extra: Partial<CompiledElement> = {},
    ): CompiledElement => ({
      el,
      children,
      ...extra,
      ...(node.src === undefined ? {} : { src: node.src }),
    });
    switch (node.name) {
      case "Email":
        tag = "main";
        own += " sml-email";
        copy("lang", "dir");
        style("backgroundColor");
        set("paddingInline", get("gutter"));
        break;
      case "Section":
        tag = "section";
        set("maxWidth", get("width"));
        set("backgroundColor", get("bgcolor"));
        alignment(get("align"));
        for (const [key, field] of layoutStyle(styleFields(p.tableStyle))) set(key, field);
        break;
      case "Columns":
        tag = "div";
        if (get("stack") !== false) own += " sml-web-columns-stack";
        set("maxWidth", get("width"));
        set("gap", get("gap"));
        alignment(get("align"));
        if (typeof p.per === "number") set("--sml-web-columns", `repeat(${p.per},minmax(0,1fr))`);
        else if (fixedTracks) {
          const widths = node.children!.map((kid) => {
            if (
              typeof kid !== "object" ||
              kid === null ||
              !("type" in kid) ||
              kid.type !== "component"
            )
              return undefined;
            return value(kid.props?.width);
          });
          const tracks: CompiledValue = {
            concat: widths.flatMap((width, index) => [
              ...(index === 0 ? [] : [" "]),
              width ?? "minmax(0,1fr)",
            ]),
          };
          gridTracks.set(tracks, widths);
          set("--sml-web-columns", tracks);
        }
        // `each`/`per` are already normalized into child loops and chunk wrappers by the compiler.
        // Repeating props.each here would multiply the authored children a second time.
        break;
      case "Column": {
        tag = "div";
        const width = get("width");
        // The parent already used these props to size its grid tracks. Applying a percentage
        // again to the item would shrink the content within its own track a second time.
        if (!sizedTracks) set("width", width);
        set("textAlign", get("align"));
        if (get("valign") !== undefined)
          set(
            "alignSelf",
            choose(
              get("valign")!,
              "middle",
              "center",
              choose(get("valign")!, "bottom", "end", "start"),
            ),
          );
        break;
      }
      case "Button":
        tag = "a";
        own += " sml-button";
        copy("href");
        style(
          "width",
          "height",
          "backgroundColor",
          "color",
          "borderRadius",
          "borderColor",
          "borderWidth",
          "fontSize",
          "fontFamily",
        );
        set("paddingInline", get("paddingX"));
        if (get("borderColor") !== undefined) set("borderStyle", "solid");
        alignment(get("align"));
        if (get("align") !== undefined) {
          set("display", "flex");
          set("width", get("width") ?? "fit-content");
        }
        break;
      case "Spacer":
        tag = "div";
        attrs["aria-hidden"] = "true";
        style("height");
        kids = [];
        break;
      case "Divider":
        tag = "hr";
        own += " sml-divider";
        set("borderTopColor", get("color"));
        set("borderTopWidth", get("thickness"));
        break;
      case "Image":
        tag = "img";
        copy("src", "alt", "width", "height");
        alignment(get("align"));
        break;
      case "Link":
        tag = "a";
        own += " sml-link";
        copy("href", "target", "rel");
        break;
      case "BrandLogo": {
        const brand = node.brand!;
        if (brand.assets?.logoUrl === undefined) return [];
        const alt = get("alt") ?? brand.footer?.companyName ?? "";
        const image = (src: string, dark: boolean) =>
          child("img", [], {
            attrs: {
              src,
              alt,
              width: get("width") ?? 120,
              class: {
                concat: [
                  `sml-web-image${brand.assets?.logoDarkUrl === undefined ? "" : dark ? " sml-web-logo-dark" : " sml-web-logo-light"}`,
                  ...(get("className") === undefined ? [] : [" ", get("className")!]),
                ],
              },
            },
          });
        tag = "div";
        if (get("align") !== undefined) {
          set("display", "grid");
          set(
            "justifyItems",
            choose(
              get("align")!,
              "right",
              "end",
              choose(get("align")!, "center", "center", "start"),
            ),
          );
        }
        kids = [
          image(brand.assets.logoUrl, false),
          ...(brand.assets.logoDarkUrl === undefined
            ? []
            : [image(brand.assets.logoDarkUrl, true)]),
        ];
        break;
      }
      case "BrandFooter": {
        tag = "footer";
        own = "sml-web-footer";
        attrs[plugin.footerAttribute] = "";
        const footer = node.brand!.footer ?? {};
        const items: CompiledNode[] = [];
        const add = (item: CompiledNode) => {
          if (items.length > 0) items.push(" · ");
          items.push(item);
        };
        if (footer.companyName?.trim()) add(child("strong", [footer.companyName]));
        for (const link of footer.socialLinks ?? [])
          add(child("a", [link.label], { attrs: { href: link.url } }));
        const unsubscribe = child(
          "span",
          [
            ...(items.length === 0 ? [] : [" · "]),
            child("a", [get("unsubscribeLabel") ?? "Unsubscribe"], {
              attrs: { href: plugin.unsubscribeUrlPlaceholder },
              reserved: true,
            }),
          ],
          { attrs: { [plugin.unsubscribeRowAttribute]: "" }, reserved: true },
        );
        kids = [child("p", [...items, unsubscribe])];
        if (footer.address !== undefined) {
          const a = footer.address;
          const lines = [
            a.street1,
            a.street2,
            [a.city, a.region, a.postalCode].filter((part) => part.trim() !== "").join(", "),
            a.country,
          ].filter((line): line is string => line !== undefined && line.trim() !== "");
          kids.push(
            child(
              "address",
              lines.flatMap((line, i) => (i === 0 ? [line] : [child("br", []), line])),
            ),
          );
        }
        break;
      }
    }
    const authored = node.name === "BrandLogo" ? undefined : get("className");
    attrs.class = authored === undefined ? own : { concat: [own, " ", authored] };
    for (const [key, field] of layoutStyle(styleFields(p.style))) set(key, field);
    const output: CompiledElement = {
      el: tag,
      attrs,
      ...(css.size === 0 ? {} : { style: [...css] satisfies CompiledStyle }),
      ...(kids.length === 0 ? {} : { children: kids }),
      ...(node.name === "BrandFooter" ? { reserved: true } : {}),
      ...(node.src === undefined ? {} : { src: node.src }),
    };
    if (node.name === "Email")
      headHints.set(output, {
        ...(get("title") === undefined ? {} : { title: get("title")! }),
        lang: get("lang") ?? "en",
        dir: get("dir") ?? "ltr",
      });
    return [output];
  };
  return { nodes: walk(nodes), headHints, stylesheets, gridTracks };
};
