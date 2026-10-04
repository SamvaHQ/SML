import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";
import { z } from "zod";

import { inputSchema, jsonSchema } from "../src/input-schema";

const portable = (schema: Record<string, unknown>) => ({
  "~standard": {
    version: 1 as const,
    vendor: "fixture",
    jsonSchema: { input: () => schema, output: () => schema },
  },
});
describe("portable template input", () => {
  it("exports nested Effect and Zod schemas and validates without coercion", () => {
    const effect = inputSchema(
      Schema.toStandardJSONSchemaV1(
        Schema.Struct({ name: Schema.String, items: Schema.Array(Schema.Finite) }),
      ),
    );
    const zod = inputSchema(z.object({ name: z.string(), items: z.array(z.number()) }).strict());
    for (const compiled of [effect, zod]) {
      const data = { name: "Ada", items: [1] };
      expect(compiled.validate(data)).toBe(true);
      expect(data).toEqual({ name: "Ada", items: [1] });
      expect(compiled.validate({ name: "Ada", items: ["1"] })).toBe(false);
    }
  });
  it("preserves annotations without changing validation identity or inserting defaults", () => {
    const base = { type: "object", properties: { name: { type: "string" } }, required: ["name"] };
    const annotated = {
      ...base,
      title: "Customer",
      properties: { name: { type: "string", default: "Ada" } },
    };
    const compiled = inputSchema(portable(annotated));
    expect(compiled.validationIdentity).toBe(inputSchema(portable(base)).validationIdentity);
    expect(compiled.schema).toEqual(annotated);
    const missing = {};
    expect(compiled.validate(missing)).toBe(false);
    expect(missing).toEqual({});
  });
  it("resolves local pointers and rejects remote and unsupported semantics", () => {
    const local = inputSchema(
      portable({ $defs: { name: { type: "string" } }, $ref: "#/$defs/name" }),
    );
    expect(local.validate("Ada")).toBe(true);
    expect(local.validate(1)).toBe(false);
    expect(() => inputSchema(portable({ $ref: "https://example.com/schema" }))).toThrow(
      "Only local",
    );
    expect(() => inputSchema(portable({ type: "string", customRule: true }))).toThrow(
      "Unsupported",
    );
    expect(() => inputSchema(portable({ type: "string", format: "email" }))).toThrow("Unsupported");
  });
  it("rejects malformed keyword values before runtime", () => {
    expect(() => inputSchema(jsonSchema({ type: "nonsense" }))).toThrow("Invalid JSON Schema");
    expect(() => inputSchema(jsonSchema({ type: "array", minItems: -1 }))).toThrow(
      "Invalid JSON Schema",
    );
    expect(() => inputSchema(jsonSchema({ properties: { value: { type: "nonsense" } } }))).toThrow(
      "Invalid JSON Schema",
    );
  });
  it("rejects lazy converters without executing recursive getters", () => {
    expect(() =>
      inputSchema(
        z.looseObject({ value: z.lazy(() => z.string().refine((value) => value === "allowed")) }),
      ),
    ).toThrow("Unsupported lazy");
    const recursive: z.ZodType = z.lazy(() => z.object({ child: recursive }));
    expect(() => inputSchema(recursive)).toThrow("Unsupported lazy");
  });
  it("rejects conversions with transformed output", () => {
    expect(() => inputSchema(z.string().transform((value) => value.length))).toThrow();
    expect(() => inputSchema(z.string().default("Ada"))).toThrow("Nonportable Zod");
    expect(() =>
      inputSchema(z.object({ nested: z.string().refine((value) => value.length > 2) })),
    ).toThrow("Nonportable Zod");
    expect(() =>
      inputSchema(
        Schema.toStandardJSONSchemaV1(
          Schema.String.check(Schema.makeFilter((value) => value.length > 2)),
        ),
      ),
    ).toThrow("Nonportable Effect");
    expect(inputSchema(jsonSchema<string>({ type: "string" })).validate("direct")).toBe(true);
  });
});
