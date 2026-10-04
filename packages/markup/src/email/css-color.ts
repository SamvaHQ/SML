// Modern CSS colors lowered to what every target client renders.
//
// Tailwind v4's entire default palette is `oklch()`, and its opacity modifiers
// are `color-mix(in oklab, …)`. Gmail, Yahoo and every Outlook understand
// neither, so a template using `text-red-500` would render with no color at all.
// These functions convert the modern forms to sRGB hex (or `rgba()` when the
// color carries alpha) and leave everything else — hex, named colors, rgb(),
// `currentColor` — exactly as authored.

/** A color in extended sRGB, alpha included, before clamping and gamma. */
interface Rgba {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

const clamp = (value: number, low = 0, high = 1): number =>
  value < low ? low : value > high ? high : value;

const toGamma = (channel: number): number =>
  channel <= 0.0031308 ? 12.92 * channel : 1.055 * channel ** (1 / 2.4) - 0.055;

const toLinear = (channel: number): number =>
  channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;

/** OKLab is the interpolation space Tailwind mixes in, so conversions run both ways. */
const oklabToRgb = (lightness: number, a: number, b: number, alpha: number): Rgba => {
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return {
    r: toGamma(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: toGamma(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: toGamma(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
    a: alpha,
  };
};

const rgbToOklab = (color: Rgba): { L: number; a: number; b: number; alpha: number } => {
  const r = toLinear(color.r);
  const g = toLinear(color.g);
  const b = toLinear(color.b);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    alpha: color.a,
  };
};

const hslToRgb = (hue: number, saturation: number, lightness: number, alpha: number): Rgba => {
  const h = ((hue % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = lightness - c / 2;
  // Each 60-degree sector picks which of chroma, the ramp and zero lands on
  // which channel; the table says that directly.
  const sectors: readonly (readonly [number, number, number])[] = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x],
  ];
  const [r, g, b] = sectors[Math.min(5, Math.floor(h / 60))]!;
  return { r: r + m, g: g + m, b: b + m, a: alpha };
};

/** The named colors an email template actually reaches for; anything else stays literal. */
const NAMED: Readonly<Record<string, string>> = {
  transparent: "#00000000",
  black: "#000000",
  white: "#ffffff",
  red: "#ff0000",
  green: "#008000",
  blue: "#0000ff",
  gray: "#808080",
  grey: "#808080",
  silver: "#c0c0c0",
  yellow: "#ffff00",
  orange: "#ffa500",
  purple: "#800080",
  navy: "#000080",
  teal: "#008080",
  olive: "#808000",
  maroon: "#800000",
  lime: "#00ff00",
  aqua: "#00ffff",
  cyan: "#00ffff",
  fuchsia: "#ff00ff",
  magenta: "#ff00ff",
};

const number = (token: string, reference = 1): number | undefined => {
  const text = token.trim();
  if (text === "none") return 0;
  if (text.endsWith("%")) {
    const value = Number.parseFloat(text.slice(0, -1));
    return Number.isFinite(value) ? (value / 100) * reference : undefined;
  }
  const value = Number.parseFloat(text);
  return Number.isFinite(value) ? value : undefined;
};

const angle = (token: string): number | undefined => {
  const text = token.trim();
  const value = Number.parseFloat(text);
  if (!Number.isFinite(value)) return undefined;
  if (text.endsWith("turn")) return value * 360;
  if (text.endsWith("rad")) return (value * 180) / Math.PI;
  if (text.endsWith("grad")) return value * 0.9;
  return value;
};

/** Split a function's arguments on top-level commas and `/`, keeping nested calls intact. */
const argumentTokens = (body: string): { readonly parts: string[]; readonly alpha?: string } => {
  const parts: string[] = [];
  let alpha: string | undefined;
  let depth = 0;
  let current = "";
  let afterSlash = false;
  for (const character of body) {
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (depth === 0 && (character === "," || character === " " || character === "/")) {
      if (character === "/") {
        if (current.trim() !== "") parts.push(current.trim());
        current = "";
        afterSlash = true;
        continue;
      }
      if (current.trim() !== "") {
        if (afterSlash) alpha = current.trim();
        else parts.push(current.trim());
      }
      current = "";
      continue;
    }
    current += character;
  }
  if (current.trim() !== "") {
    if (afterSlash) alpha = current.trim();
    else parts.push(current.trim());
  }
  return alpha === undefined ? { parts } : { parts, alpha };
};

/** Read one function call at the start of `value`, returning its name and body. */
const functionCall = (value: string): { name: string; body: string } | undefined => {
  const match = /^([a-zA-Z-]+)\(/.exec(value.trim());
  if (match === null) return undefined;
  const text = value.trim();
  let depth = 0;
  for (let index = match[0].length - 1; index < text.length; index++) {
    if (text[index] === "(") depth += 1;
    else if (text[index] === ")") {
      depth -= 1;
      if (depth === 0)
        return { name: match[1]!.toLowerCase(), body: text.slice(match[0].length, index) };
    }
  }
  return undefined;
};

/** Parse any supported color notation into extended sRGB. `undefined` means "leave it alone". */
export const parseColor = (value: string): Rgba | undefined => {
  const text = value.trim();
  const named = NAMED[text.toLowerCase()];
  if (named !== undefined) return parseColor(named);
  if (text.startsWith("#")) {
    const hex = text.slice(1);
    const expand = (part: string) => Number.parseInt(part.repeat(2 / part.length), 16) / 255;
    if (hex.length === 3 || hex.length === 4)
      return {
        r: expand(hex[0]!),
        g: expand(hex[1]!),
        b: expand(hex[2]!),
        a: hex.length === 4 ? expand(hex[3]!) : 1,
      };
    if (hex.length === 6 || hex.length === 8)
      return {
        r: Number.parseInt(hex.slice(0, 2), 16) / 255,
        g: Number.parseInt(hex.slice(2, 4), 16) / 255,
        b: Number.parseInt(hex.slice(4, 6), 16) / 255,
        a: hex.length === 8 ? Number.parseInt(hex.slice(6, 8), 16) / 255 : 1,
      };
    return undefined;
  }
  const call = functionCall(text);
  if (call === undefined) return undefined;
  const { parts, alpha } = argumentTokens(call.body);
  const opacity = alpha === undefined ? 1 : (number(alpha) ?? 1);
  switch (call.name) {
    case "rgb":
    case "rgba": {
      const [r, g, b, legacy] = parts;
      if (r === undefined || g === undefined || b === undefined) return undefined;
      const channel = (token: string) => {
        const parsed = number(token, 255);
        return parsed === undefined ? undefined : parsed / 255;
      };
      const [red, green, blue] = [channel(r), channel(g), channel(b)];
      if (red === undefined || green === undefined || blue === undefined) return undefined;
      return {
        r: red,
        g: green,
        b: blue,
        a: legacy === undefined ? opacity : (number(legacy) ?? 1),
      };
    }
    case "hsl":
    case "hsla": {
      const [h, s, l, legacy] = parts;
      if (h === undefined || s === undefined || l === undefined) return undefined;
      const hue = angle(h);
      const saturation = number(s);
      const lightness = number(l);
      if (hue === undefined || saturation === undefined || lightness === undefined)
        return undefined;
      return hslToRgb(
        hue,
        saturation,
        lightness,
        legacy === undefined ? opacity : (number(legacy) ?? 1),
      );
    }
    case "oklch": {
      const [l, c, h] = parts;
      if (l === undefined || c === undefined || h === undefined) return undefined;
      const lightness = number(l);
      const chroma = number(c, 0.4);
      const hue = angle(h);
      if (lightness === undefined || chroma === undefined || hue === undefined) return undefined;
      const radians = (hue * Math.PI) / 180;
      return oklabToRgb(lightness, chroma * Math.cos(radians), chroma * Math.sin(radians), opacity);
    }
    case "oklab": {
      const [l, a, b] = parts;
      if (l === undefined || a === undefined || b === undefined) return undefined;
      const lightness = number(l);
      const green = number(a, 0.4);
      const blue = number(b, 0.4);
      if (lightness === undefined || green === undefined || blue === undefined) return undefined;
      return oklabToRgb(lightness, green, blue, opacity);
    }
    case "color-mix":
      return mixColors(call.body);
    default:
      return undefined;
  }
};

/** `color-mix(in <space>, <color> <pct>?, <color> <pct>?)` — Tailwind's opacity modifier. */
const mixColors = (body: string): Rgba | undefined => {
  const stops = body.split(",").map((part) => part.trim());
  const [space, first, second] = stops;
  if (space === undefined || first === undefined || second === undefined || stops.length !== 3)
    return undefined;
  const method = /^in\s+([a-z-]+)/i.exec(space)?.[1]?.toLowerCase();
  if (method === undefined) return undefined;
  const stop = (text: string): { color: Rgba; weight: number | undefined } | undefined => {
    const percentage = /\s([\d.]+)%$/.exec(text);
    const color = parseColor(percentage === null ? text : text.slice(0, percentage.index));
    if (color === undefined) return undefined;
    return {
      color,
      weight: percentage === null ? undefined : Number.parseFloat(percentage[1]!) / 100,
    };
  };
  const left = stop(first);
  const right = stop(second);
  if (left === undefined || right === undefined) return undefined;
  const leftWeight = left.weight ?? (right.weight === undefined ? 0.5 : 1 - right.weight);
  const rightWeight = right.weight ?? 1 - leftWeight;
  const total = leftWeight + rightWeight;
  if (total === 0) return undefined;
  const p = leftWeight / total;
  const alpha = left.color.a * p + right.color.a * (1 - p);
  // Premultiplied interpolation, so mixing with `transparent` scales alpha
  // instead of dragging the result toward black.
  const mix = (l: number, r: number): number =>
    alpha === 0 ? 0 : (l * left.color.a * p + r * right.color.a * (1 - p)) / alpha;
  if (method === "srgb")
    return {
      r: mix(left.color.r, right.color.r),
      g: mix(left.color.g, right.color.g),
      b: mix(left.color.b, right.color.b),
      a: alpha,
    };
  const l = rgbToOklab(left.color);
  const r = rgbToOklab(right.color);
  const channel = (a: number, b: number) =>
    alpha === 0 ? 0 : (a * left.color.a * p + b * right.color.a * (1 - p)) / alpha;
  return oklabToRgb(channel(l.L, r.L), channel(l.a, r.a), channel(l.b, r.b), alpha);
};

const byte = (channel: number): string =>
  Math.round(clamp(channel) * 255)
    .toString(16)
    .padStart(2, "0");

/** sRGB hex, or `rgba()` when the color is not opaque. */
export const formatColor = (color: Rgba): string =>
  color.a >= 1
    ? `#${byte(color.r)}${byte(color.g)}${byte(color.b)}`
    : `rgba(${Math.round(clamp(color.r) * 255)},${Math.round(clamp(color.g) * 255)},${Math.round(
        clamp(color.b) * 255,
      )},${Math.round(clamp(color.a) * 1000) / 1000})`;

const MODERN_COLOR = /\b(oklch|oklab|color-mix|lab|lch)\(/i;

/** Rewrite every modern color function in a declaration value; other text is untouched. */
export const downlevelColors = (value: string): string => {
  if (!MODERN_COLOR.test(value)) return value;
  let result = "";
  let rest = value;
  while (rest.length > 0) {
    const match = MODERN_COLOR.exec(rest);
    if (match === null || match.index === undefined) {
      result += rest;
      break;
    }
    result += rest.slice(0, match.index);
    const remainder = rest.slice(match.index);
    const call = functionCall(remainder);
    if (call === undefined) {
      result += remainder;
      break;
    }
    const consumed = remainder.indexOf("(") + call.body.length + 2;
    const color = parseColor(remainder.slice(0, consumed));
    result += color === undefined ? remainder.slice(0, consumed) : formatColor(color);
    rest = remainder.slice(consumed);
  }
  return result;
};
