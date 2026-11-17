import { useContext, useEffect, useState } from "react";

import { themeTokensFromStylesheets } from "../host/theme";
import type {
  AsyncLifecycleApi,
  AsyncThemeApi,
  ThemeColorToken,
  ThemeFontToken,
  ThemeTokenSource,
} from "../host/types";
import { EditorBundleContext, useEditorStore } from "../state/context";
import { usedColorTokens } from "./friendly";
import { THEME_PATH } from "./theme-brand";

/** A theme color as the inspector offers it; `value` is null when only its name is known. */
export interface PaletteColor extends Omit<ThemeColorToken, "value"> {
  readonly value: string | null;
}

/** The colors and font roles the inspector offers for the open revision. */
export interface Palette {
  readonly colors: ReadonlyArray<PaletteColor>;
  readonly fonts: ReadonlyArray<ThemeFontToken>;
}

const ACRONYMS = new Set(["url", "id", "sku", "api", "cta", "ui", "qr", "faq"]);

/** "card-foreground" → "Card text", "icon-tile" → "Icon tile", "foreground" → "Text". */
export const colorLabel = (color: Pick<ThemeColorToken, "name" | "label">): string => {
  if (color.label !== undefined && color.label.trim() !== "") return color.label;
  const words = color.name
    .split("-")
    .filter((word) => word !== "")
    .map((word) => (word === "foreground" ? "text" : word));
  return sentence(words);
};

/** "heading" → "Heading font", "sans" → "Body font", "mono" → "Mono font". */
export const fontRoleLabel = (role: string): string => {
  const named: Record<string, string> = { sans: "Body", body: "Body", heading: "Heading" };
  return `${named[role] ?? sentence(role.split("-"))} font`;
};

/** The first family of a stack, unquoted: `"Barlow Semi Condensed", sans-serif` → "Barlow Semi Condensed". */
export const fontFamilyName = (stack: string): string => {
  const first = stack.split(",")[0]?.trim() ?? "";
  return first.replace(/^(["'])(.*)\1$/, "$2");
};

/** Words in sentence case, with known acronyms in capitals. */
export const sentence = (words: ReadonlyArray<string>): string =>
  words
    .map((word, index) => {
      const lower = word.toLowerCase();
      if (ACRONYMS.has(lower)) return lower.toUpperCase();
      return index === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower;
    })
    .join(" ");

/** Where a group of colors comes from, as the colour list heads it. */
export const sourceLabel = (source: ThemeTokenSource): string =>
  source.kind === "brand"
    ? `${source.name} brand`
    : source.kind === "stylesheet"
      ? "Theme"
      : "This email";

/** The theme role a rendered font stack is, matched by its first family. */
export const matchFont = (
  fonts: ReadonlyArray<ThemeFontToken>,
  rendered: string,
): ThemeFontToken | undefined => {
  const family = fontFamilyName(rendered).toLowerCase();
  return fonts.find((font) => fontFamilyName(font.family).toLowerCase() === family);
};

/** `#17181c` → `#17181C`; any other CSS color as written. */
export const displayColor = (value: string): string =>
  /^#[0-9a-f]{3,8}$/i.test(value) ? value.toUpperCase() : value;

type Rgba = readonly [number, number, number, number];

/** A hex or `rgb()` color as channels, or null for anything else. */
export const parseRgba = (value: string): Rgba | null => {
  const text = value.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3,8})$/.exec(text)?.[1];
  if (hex !== undefined) {
    const full =
      hex.length === 3 || hex.length === 4 ? [...hex].map((char) => char + char).join("") : hex;
    if (full.length !== 6 && full.length !== 8) return null;
    const channel = (at: number) => Number.parseInt(full.slice(at, at + 2), 16);
    return [channel(0), channel(2), channel(4), full.length === 8 ? channel(6) / 255 : 1];
  }
  const rgb = /^rgba?\(([^)]*)\)$/.exec(text)?.[1];
  if (rgb === undefined) return null;
  const parts = rgb.split(/[\s,/]+/).filter((part) => part !== "");
  if (parts.length < 3) return null;
  const numbers = parts.map((part) =>
    part.endsWith("%") ? Number.parseFloat(part) / 100 : Number.parseFloat(part),
  );
  if (numbers.some((number) => !Number.isFinite(number))) return null;
  return [numbers[0]!, numbers[1]!, numbers[2]!, numbers[3] ?? 1];
};

const sameColor = (a: string, b: string): boolean => {
  const left = parseRgba(a);
  const right = parseRgba(b);
  if (left === null || right === null) return a.trim().toLowerCase() === b.trim().toLowerCase();
  return left.every(
    (channel, index) => Math.abs(channel - right[index]!) < 0.01 * (index === 3 ? 1 : 100),
  );
};

/** A computed `rgb()` as `#RRGGBB`, or as written when it is not one. */
export const hexOf = (value: string): string => {
  const rgba = parseRgba(value);
  if (rgba === null) return value;
  const [r, g, b] = rgba;
  return `#${[r, g, b].map((channel) => Math.round(channel).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
};

/** The scheme the canvas renders the email in. */
export type ColorScheme = "light" | "dark";

/** A color's value under `scheme`: its dark value in dark mode when the theme sets one. */
export const valueIn = (color: PaletteColor, scheme: ColorScheme): string | null =>
  scheme === "dark" ? (color.dark ?? color.value) : color.value;

/** The palette color a rendered color is, if any: by its value in `scheme` first, then either. */
export const matchColor = (
  colors: ReadonlyArray<PaletteColor>,
  rendered: string,
  scheme: ColorScheme = "light",
): PaletteColor | undefined => {
  const is = (value: string | null | undefined) => value != null && sameColor(value, rendered);
  return (
    colors.find((color) => is(valueIn(color, scheme))) ??
    colors.find((color) => is(color.value) || is(color.dark))
  );
};

/**
 * Which scheme the canvas renders in, told by the element's rendered colors: one that is a
 * token's dark value and not its light one means dark, and the reverse light. Colors that do not
 * tell leave `fallback`, the frame's own `prefers-color-scheme`.
 */
export const renderedScheme = (
  colors: ReadonlyArray<PaletteColor>,
  rendered: ReadonlyArray<string>,
  fallback: ColorScheme,
): ColorScheme => {
  for (const value of rendered)
    for (const color of colors) {
      if (color.dark === undefined || color.value === null) continue;
      const light = sameColor(color.value, value);
      const dark = sameColor(color.dark, value);
      if (dark && !light) return "dark";
      if (light && !dark) return "light";
    }
  return fallback;
};

/** Whether a rendered color paints nothing. */
export const isTransparent = (value: string): boolean =>
  parseRgba(value)?.[3] === 0 || value === "transparent";

const EMPTY_FONTS: ReadonlyArray<ThemeFontToken> = [];

/**
 * One resolution per host API and revision, shared by every inspector that asks: selecting another
 * element mounts the controls again and must not ask the host again.
 */
const resolved = new WeakMap<
  object,
  { readonly rev: string; readonly palette: Promise<Palette> }
>();

const cached = (api: object, rev: string, load: () => Promise<Palette>): Promise<Palette> => {
  const hit = resolved.get(api);
  if (hit?.rev === rev) return hit.palette;
  const palette = load();
  resolved.set(api, { rev, palette });
  // A failed read is asked again by the next inspector rather than remembered.
  palette.then(undefined, () => {
    if (resolved.get(api)?.palette === palette) resolved.delete(api);
  });
  return palette;
};

const fromHost = (api: AsyncThemeApi): Promise<Palette> =>
  api.tokens().then((tokens) => ({ colors: tokens.colors, fonts: tokens.fonts }));

const fromProject = (api: AsyncLifecycleApi): Promise<Palette> =>
  api.inspect().then((state) => {
    const files: Record<string, string> = {};
    for (const file of state.files)
      if (file.content !== null && file.binary !== true && file.path.endsWith(".css"))
        files[file.path] = file.content;
    return themeTokensFromStylesheets({ themePath: THEME_PATH, files });
  });

/**
 * The theme the inspector paints: the host's resolution (brand included) when it offers one,
 * otherwise the project's own stylesheets read through `lifecycle`, otherwise the color names the
 * template uses, without values. Resolved once per revision.
 */
export function useThemePalette(entrySource: string): Palette {
  const themeCapability = useContext(EditorBundleContext)?.host.theme;
  const lifecycle = useEditorStore((state) => state.lifecycleCapability);
  const rev = useEditorStore((state) => state.doc?.rev ?? null);
  const api =
    themeCapability?.status === "ready"
      ? themeCapability.api
      : lifecycle?.status === "ready"
        ? lifecycle.api
        : null;
  const [state, setState] = useState<{
    readonly api: object;
    readonly rev: string;
    readonly palette: Palette;
  } | null>(null);
  useEffect(() => {
    if (rev === null) return;
    const source =
      themeCapability?.status === "ready"
        ? { api: themeCapability.api, load: () => fromHost(themeCapability.api) }
        : lifecycle?.status === "ready"
          ? { api: lifecycle.api, load: () => fromProject(lifecycle.api) }
          : null;
    if (source === null) return;
    let cancelled = false;
    void cached(source.api, rev, source.load).then(
      (palette) => {
        if (!cancelled) setState({ api: source.api, rev, palette });
      },
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [themeCapability, lifecycle, rev]);
  // The previous revision's palette stands in while the next one resolves, so swatches never flash.
  const palette = state !== null && state.api === api ? state.palette : null;
  if (palette !== null && palette.colors.length > 0) return palette;
  return {
    colors: usedColorTokens(entrySource).map((name) => ({
      name,
      value: null,
      source: { kind: "project" },
    })),
    fonts: palette?.fonts ?? EMPTY_FONTS,
  };
}
