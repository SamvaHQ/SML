// Structural guards for the narrow set of `unknown` values the compiler meets:
// JSX props and parsed JSON. Internal to the package — nothing here is
// exported from a published subpath.
//
// oxlint-disable samva/no-hand-rolled-object-guard -- @samva/markup ships to
// template authors with no validation-framework runtime; these two guards are
// shallow narrowing over values a caller already typed, never the validation of
// external data. Template input is validated against JSON Schema in
// `../input-schema.ts`.

/** A non-null, non-array object, narrowed for property access. */
export const isObject = (input: unknown): input is { [key: PropertyKey]: unknown } =>
  typeof input === "object" && input !== null && !Array.isArray(input);

/** True when `input` carries `property`, narrowing it for reads. */
export const hasProperty = <P extends PropertyKey>(
  input: unknown,
  property: P,
): input is { [K in P]: unknown } =>
  (typeof input === "object" && input !== null) || typeof input === "function"
    ? property in (input as object)
    : false;
