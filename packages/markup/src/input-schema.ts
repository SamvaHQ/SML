import { Validator, type OutputUnit, type Schema as JsonSchema } from "@cfworker/json-schema";
import type { StandardJSONSchemaV1 } from "@standard-schema/spec";

import { hasProperty, isObject } from "./internal/guards";
// The JSON Schema 2020-12 dialect, vendored verbatim from json-schema.org under
// ./json-schema/2020-12. The files carry an explicit import attribute: without
// one, Node's native ESM loader refuses them, so the published package cannot be
// imported by a consumer whose bundler externalizes it.
import applicator from "./json-schema/2020-12/meta/applicator.json" with { type: "json" };
import content from "./json-schema/2020-12/meta/content.json" with { type: "json" };
import core from "./json-schema/2020-12/meta/core.json" with { type: "json" };
import format_annotation from "./json-schema/2020-12/meta/format-annotation.json" with { type: "json" };
import meta_data from "./json-schema/2020-12/meta/meta-data.json" with { type: "json" };
import unevaluated from "./json-schema/2020-12/meta/unevaluated.json" with { type: "json" };
import validation from "./json-schema/2020-12/meta/validation.json" with { type: "json" };
import metaSchema from "./json-schema/2020-12/schema.json" with { type: "json" };

const meta = new Validator(metaSchema as JsonSchema, "2020-12", false);
for (const part of [
  applicator,
  content,
  core,
  format_annotation,
  meta_data,
  unevaluated,
  validation,
])
  meta.addSchema(part as JsonSchema);

/** JSON Schema dialect accepted by template publications. */
export const INPUT_SCHEMA_DIALECT = "https://json-schema.org/draft/2020-12/schema";

const canonicalJson = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (isObject(value))
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => [key, canonicalJson(item)]),
    );
  return value;
};

const annotations = new Set([
  "title",
  "description",
  "default",
  "examples",
  "deprecated",
  "readOnly",
  "writeOnly",
  "$comment",
]);
const scalarKeywords = new Set([
  "$schema",
  "$ref",
  "type",
  "enum",
  "const",
  "required",
  "minProperties",
  "maxProperties",
  "minItems",
  "maxItems",
  "uniqueItems",
  "minLength",
  "maxLength",
  "pattern",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
]);
const schemaMaps = new Set(["properties", "$defs", "patternProperties", "dependentSchemas"]);
const schemaValues = new Set([
  "additionalProperties",
  "items",
  "contains",
  "not",
  "if",
  "then",
  "else",
  "propertyNames",
]);
const schemaArrays = new Set(["allOf", "anyOf", "oneOf", "prefixItems"]);

// oxlint-disable samva/no-try-catch-or-throw, samva/no-error-constructor -- Synchronous authoring boundary reports malformed schemas to the build caller.
/** Check every schema position before deriving identity; unknown keywords never disappear. */
const canonicalSchema = (schema: unknown, path = "#"): unknown => {
  if (typeof schema === "boolean") return schema;
  if (!isObject(schema)) {
    throw new TypeError(`Invalid schema at ${path}`);
  }
  const shape = meta.validate(schema);
  if (!shape.valid)
    throw new TypeError(`Invalid JSON Schema at ${path}: ${JSON.stringify(shape.errors)}`);
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  )) {
    if (annotations.has(key)) continue;
    if (schemaMaps.has(key)) {
      if (!isObject(value)) throw new TypeError(`Invalid ${path}/${key}`);
      result[key] = Object.fromEntries(
        Object.entries(value)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([name, child]) => [name, canonicalSchema(child, `${path}/${key}/${name}`)]),
      );
    } else if (schemaValues.has(key)) {
      result[key] = canonicalSchema(value, `${path}/${key}`);
    } else if (schemaArrays.has(key)) {
      if (!Array.isArray(value)) throw new TypeError(`Invalid ${path}/${key}`);
      result[key] = value.map((child, index) => canonicalSchema(child, `${path}/${key}/${index}`));
    } else if (scalarKeywords.has(key)) {
      if (
        key === "$ref" &&
        (typeof value !== "string" || !(value === "#" || value.startsWith("#/")))
      )
        throw new TypeError(`Only local JSON Pointer references are supported at ${path}/$ref`);
      if (key === "$schema" && value !== INPUT_SCHEMA_DIALECT)
        throw new TypeError(`Expected JSON Schema 2020-12 at ${path}`);
      result[key] = canonicalJson(value);
    } else {
      throw new TypeError(`Unsupported input schema keyword ${path}/${key}`);
    }
  }
  return result;
};

/** A compiled non-mutating validator and its complete published schema. */
export interface InputSchema<Input> {
  readonly schema: Record<string, unknown>;
  /** Canonical validation document; annotations are retained only in schema. */
  readonly validationIdentity: string;
  readonly validate: ((value: unknown) => value is Input) & { errors?: readonly OutputUnit[] };
}

/** Direct portable JSON Schema authoring; the caller declares its JSON input type. */
export const jsonSchema = <Input>(
  schema: Record<string, unknown>,
): StandardJSONSchemaV1<Input> => ({
  "~standard": {
    version: 1,
    vendor: "samva-json-schema",
    jsonSchema: { input: () => schema, output: () => schema },
  },
});

/** Pinned Effect/Zod converters omit arbitrary refinements, so inspect those vendors' check metadata. */
const rejectNonportableChecks = (source: StandardJSONSchemaV1): void => {
  const vendor = source["~standard"].vendor;
  if (vendor !== "effect" && vendor !== "zod") return;
  const seen = new WeakSet<object>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const child of value) visit(child);
      return;
    }
    if (!isObject(value) || seen.has(value)) return;
    seen.add(value);
    if (vendor === "zod" && isObject(value._zod)) {
      visit(value._zod.def);
      return;
    }
    if (vendor === "effect" && value.encoding !== undefined)
      throw new TypeError(
        "Nonportable Effect transform; use a JSON input schema without decoding transforms",
      );
    if (vendor === "effect" && value._tag === "Suspend") {
      throw new TypeError(
        "Unsupported suspended Effect converter; use local JSON Schema references",
      );
    }
    if (vendor === "zod" && value.type === "lazy") {
      throw new TypeError(
        "Unsupported lazy Zod converter; author recursive input with local JSON Schema references",
      );
    }
    if (
      vendor === "zod" &&
      (value.check === "custom" ||
        value.check === "overwrite" ||
        ["transform", "default", "prefault", "catch"].includes(String(value.type)))
    ) {
      throw new TypeError(
        "Nonportable Zod refinement/transform; express constraints in JSON Schema",
      );
    }
    if (
      vendor === "effect" &&
      value._tag === "Filter" &&
      (!isObject(value.annotations) || typeof value.annotations.toJsonSchema !== "function")
    ) {
      throw new TypeError("Nonportable Effect refinement; provide a JSON Schema constraint");
    }
    for (const [key, child] of Object.entries(value)) {
      if (key !== "~standard" && key !== "annotations") visit(child);
    }
  };
  if (vendor === "effect" && hasProperty(source, "ast")) visit(source.ast);
  else visit(source);
};

/** Convert caller input, never validator output. Both conversion directions must be portable. */
export const inputSchema = <S extends StandardJSONSchemaV1>(
  source: S,
): InputSchema<StandardJSONSchemaV1.InferInput<S>> => {
  rejectNonportableChecks(source);
  const converter = source["~standard"].jsonSchema;
  const schema = structuredClone(converter.input({ target: "draft-2020-12" }));
  const canonical = canonicalSchema(schema);
  const output = canonicalSchema(converter.output({ target: "draft-2020-12" }));
  if (JSON.stringify(canonical) !== JSON.stringify(output)) {
    throw new TypeError(
      "Template schemas must preserve JSON input; input/output conversion differs",
    );
  }
  const validator = new Validator(schema, "2020-12", false);
  const validate = (value: unknown): value is StandardJSONSchemaV1.InferInput<S> => {
    const result = validator.validate(value);
    validate.errors = result.errors;
    return result.valid;
  };
  validate.errors = [] as readonly OutputUnit[];
  return { schema, validationIdentity: JSON.stringify(canonical), validate };
};
// oxlint-enable samva/no-try-catch-or-throw, samva/no-error-constructor

/** Serializable validation errors suitable for build and request diagnostics. */
export type InputIssue = OutputUnit;
