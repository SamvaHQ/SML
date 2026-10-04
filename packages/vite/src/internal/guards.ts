// The one structural guard the editor server and the handoff importer need.
// Internal to the package — nothing here is exported from a published subpath.
//
// oxlint-disable samva/no-hand-rolled-object-guard -- @samva/vite installs into
// a template author's project with no validation-framework runtime; this is
// shallow narrowing over a JSON Schema fragment or a request body whose fields
// are checked individually at the call site, never the validation of a decoded
// contract.

/** A non-null, non-array object, narrowed for property access. */
export const isObject = (input: unknown): input is { [key: PropertyKey]: unknown } =>
  typeof input === "object" && input !== null && !Array.isArray(input);
