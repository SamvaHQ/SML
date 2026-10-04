// oxlint-disable samva/no-try-catch-or-throw, samva/no-error-constructor, samva/no-hand-rolled-object-guard, samva/no-unsafe-type-assertion -- The formatters are a synchronous boundary that reports a bad argument to the renderer as a thrown TypeError or RangeError; @samva/markup ships without a validation framework.
import type { IrFormatter } from "./ir";

export const DEFAULT_LOCALE = "en-US";
export const DEFAULT_TIME_ZONE = "UTC";

export interface FormatContext {
  readonly locale?: string | undefined;
  readonly timeZone?: string | undefined;
}

export type DateStyle = "short" | "medium" | "long" | "full";

export interface PluralForms {
  readonly zero?: string;
  readonly one?: string;
  readonly two?: string;
  readonly few?: string;
  readonly many?: string;
  readonly other: string;
}

export interface Fmt {
  money(amount: number, currency: string, locale?: string): string;
  number(value: number, options?: Intl.NumberFormatOptions, locale?: string): string;
  date(iso: string, style?: DateStyle, locale?: string): string;
  time(iso: string, style?: DateStyle, locale?: string): string;
  plural(count: number, forms: PluralForms, locale?: string): string;
  list(values: readonly string[], locale?: string): string;
}

export const FORMATTER_NAMES = [
  "money",
  "number",
  "date",
  "time",
  "plural",
  "list",
] as const satisfies readonly IrFormatter[];

const CACHE_LIMIT = 200;
const cache = new Map<string, unknown>();

const cached = <T>(kind: string, locale: string, options: unknown, make: () => T): T => {
  const key = `${kind}\u0000${locale}\u0000${options === undefined ? "" : JSON.stringify(options)}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit as T;
  const value = make();
  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(key, value);
  return value;
};

const assertFinite = (value: number, what: string): void => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${what} must be a finite number.`);
  }
};

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

const parseIso = (iso: string): Date => {
  if (typeof iso !== "string") throw new TypeError("ISO date must be a string.");
  const date = new Date(DATE_ONLY.test(iso) ? `${iso}T00:00:00Z` : iso);
  if (Number.isNaN(date.getTime())) {
    throw new RangeError(`Cannot parse "${iso}" as an ISO 8601 date.`);
  }
  return date;
};

export const createFmt = (context: FormatContext = {}): Fmt => {
  const defaultLocale = context.locale ?? DEFAULT_LOCALE;
  const timeZone = context.timeZone ?? DEFAULT_TIME_ZONE;
  const pick = (locale: string | undefined) => locale ?? defaultLocale;

  return {
    money: (amount, currency, locale) => {
      assertFinite(amount, "money amount");
      const l = pick(locale);
      return cached(
        "money",
        l,
        currency,
        () => new Intl.NumberFormat(l, { style: "currency", currency }),
      ).format(amount);
    },
    number: (value, options, locale) => {
      assertFinite(value, "number value");
      const l = pick(locale);
      return cached("number", l, options, () => new Intl.NumberFormat(l, options)).format(value);
    },
    date: (iso, style = "medium", locale) => {
      const d = parseIso(iso);
      const l = pick(locale);
      return cached(
        "date",
        l,
        { style, timeZone },
        () => new Intl.DateTimeFormat(l, { dateStyle: style, timeZone }),
      ).format(d);
    },
    time: (iso, style = "short", locale) => {
      const d = parseIso(iso);
      const l = pick(locale);
      return cached(
        "time",
        l,
        { style, timeZone },
        () => new Intl.DateTimeFormat(l, { timeStyle: style, timeZone }),
      ).format(d);
    },
    plural: (count, forms, locale) => {
      assertFinite(count, "plural count");
      const l = pick(locale);
      const category = cached("plural", l, undefined, () => new Intl.PluralRules(l)).select(count);
      return forms[category] ?? forms.other;
    },
    list: (values, locale) => {
      const l = pick(locale);
      return cached(
        "list",
        l,
        undefined,
        () => new Intl.ListFormat(l, { type: "conjunction", style: "long" }),
      ).format(values);
    },
  };
};

let ambient: FormatContext = {};

export const withFormatContext = <T>(context: FormatContext, run: () => T): T => {
  const previous = ambient;
  ambient = context;
  try {
    return run();
  } finally {
    ambient = previous;
  }
};

export const fmt: Fmt = {
  money: (a, c, l) => createFmt(ambient).money(a, c, l),
  number: (v, o, l) => createFmt(ambient).number(v, o, l),
  date: (i, s, l) => createFmt(ambient).date(i, s, l),
  time: (i, s, l) => createFmt(ambient).time(i, s, l),
  plural: (c, f, l) => createFmt(ambient).plural(c, f, l),
  list: (v, l) => createFmt(ambient).list(v, l),
};

const STYLES: readonly string[] = ["short", "medium", "long", "full"];
const PLURAL_KEYS = ["zero", "one", "two", "few", "many", "other"] as const;

const arity = (name: string, args: readonly unknown[], min: number, max: number): void => {
  if (args.length < min || args.length > max) {
    const expected = min === max ? `${min}` : `${min} to ${max}`;
    throw new TypeError(`${name} takes ${expected} arguments but received ${args.length}.`);
  }
};

const str = (name: string, index: number, value: unknown, optional = false): string | undefined => {
  if (value === undefined && optional) return undefined;
  if (typeof value !== "string") {
    throw new TypeError(`${name} argument ${index + 1} must be a string.`);
  }
  return value;
};

const num = (name: string, index: number, value: unknown): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${name} argument ${index + 1} must be a finite number.`);
  }
  return value;
};

const style = (name: string, index: number, value: unknown): DateStyle | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !STYLES.includes(value)) {
    throw new TypeError(`${name} argument ${index + 1} must be one of ${STYLES.join(", ")}.`);
  }
  return value as DateStyle;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const callFormatter = (formatter: Fmt, name: string, args: readonly unknown[]): string => {
  switch (name) {
    case "money":
      arity(name, args, 2, 3);
      return formatter.money(
        num(name, 0, args[0]),
        str(name, 1, args[1])!,
        str(name, 2, args[2], true),
      );
    case "number": {
      arity(name, args, 1, 3);
      const options = args[1];
      if (options !== undefined && !isRecord(options)) {
        throw new TypeError("number argument 2 must be an options object.");
      }
      return formatter.number(
        num(name, 0, args[0]),
        options as Intl.NumberFormatOptions | undefined,
        str(name, 2, args[2], true),
      );
    }
    case "date":
    case "time": {
      arity(name, args, 1, 3);
      return formatter[name](
        str(name, 0, args[0])!,
        style(name, 1, args[1]),
        str(name, 2, args[2], true),
      );
    }
    case "plural": {
      arity(name, args, 2, 3);
      const forms = args[1];
      if (!isRecord(forms) || typeof forms.other !== "string") {
        throw new TypeError("plural argument 2 must be an object with a string `other` form.");
      }
      for (const key of PLURAL_KEYS) {
        if (forms[key] !== undefined && typeof forms[key] !== "string") {
          throw new TypeError(`plural argument 2 form \`${key}\` must be a string.`);
        }
      }
      return formatter.plural(
        num(name, 0, args[0]),
        forms as unknown as PluralForms,
        str(name, 2, args[2], true),
      );
    }
    case "list": {
      arity(name, args, 1, 2);
      const values = args[0];
      if (!Array.isArray(values) || values.some((v) => typeof v !== "string")) {
        throw new TypeError("list argument 1 must be an array of strings.");
      }
      return formatter.list(values as string[], str(name, 1, args[1], true));
    }
    default:
      throw new TypeError(`Unknown formatter "${name}".`);
  }
};
