/* oxlint-disable samva/no-hand-rolled-object-guard -- This is the validation boundary for untrusted compiled JSON before deterministic target expansion. */
import { emailElement } from "../email/elements";
import { COMPONENT_DEGRADATIONS } from "./degradations";

/** Bound the static artifact as well as the renderer's dynamic iteration and expression limits. */
export const validateEmailIr = (
  body: unknown,
  presentation: unknown,
  reject: (message: string, code?: string) => never,
): void => {
  const record = (value: unknown): value is Readonly<Record<string, unknown>> =>
    typeof value === "object" && value !== null && !Array.isArray(value);
  let visited = 0;
  const bound = (value: unknown, depth: number): void => {
    if (depth > 64 || ++visited > 100_000)
      reject("The compiled email exceeds its depth or size limit.", "render-limit");
    if (typeof value === "string" && /[]/.test(value))
      reject("Compiled strings cannot contain internal token delimiters.");
    if (typeof value === "number" && !Number.isFinite(value))
      reject("Compiled numbers must be finite.");
    if (typeof value === "function" || typeof value === "symbol" || typeof value === "bigint")
      reject("A compiled email contains only JSON data.");
    if (Array.isArray(value)) {
      if (value.length > 10_000)
        reject("A compiled list contains at most 10000 entries.", "render-limit");
      for (const item of value) bound(item, depth + 1);
    } else if (record(value)) {
      for (const item of Object.values(value)) bound(item, depth + 1);
    }
  };
  bound(body, 0);
  bound(presentation, 0);
  const list = (value: unknown): void => {
    if (!Array.isArray(value)) reject("Node children must be an array.");
    for (const child of value) node(child);
  };
  const node = (value: unknown): void => {
    if (value === undefined) reject("A compiled node cannot be undefined.");
    if (typeof value !== "object" || value === null) return;
    if (!record(value)) reject("An array cannot be rendered as a node.");
    if (
      value.src !== undefined &&
      (!Array.isArray(value.src) ||
        value.src.length < 2 ||
        value.src.length > 3 ||
        !value.src.every((part) => Number.isInteger(part) && Number(part) >= 0))
    )
      reject("A source reference is a line, column and optional file index.");
    if ("type" in value) {
      if (value.type === "component") {
        if (typeof value.name !== "string" || !Object.hasOwn(COMPONENT_DEGRADATIONS, value.name))
          reject("Unknown semantic component.");
        if (value.props !== undefined && !record(value.props))
          reject("Component props must be an object.");
        if (
          (value.name === "BrandLogo" || value.name === "BrandFooter") &&
          (!record(value.brand) || typeof value.brand.slug !== "string")
        )
          reject("Brand components require resolved brand data.");
      } else if (value.type === "block" || value.type === "inline") {
        if (typeof value.tag !== "string" || emailElement(value.tag) === undefined)
          reject("Unknown semantic intrinsic.");
        if (value.attrs !== undefined && !record(value.attrs))
          reject("Intrinsic attributes must be an object.");
      } else reject("Unknown semantic node kind.");
      if (value.children !== undefined) list(value.children);
    } else if ("each" in value) {
      if (typeof value.as !== "string" || value.as === "")
        reject("A loop requires a variable name.");
      list(value.children);
    } else if ("if" in value && Array.isArray(value.then)) {
      list(value.then);
      if (value.else !== undefined) list(value.else);
    } else if ("el" in value) {
      if (value.attrs !== undefined && !record(value.attrs))
        reject("Element attributes must be an object.");
      if (value.children !== undefined) list(value.children);
    } else if ("raw" in value && !Array.isArray(value.raw))
      reject("Compatibility markup requires a list of parts.");
  };
  node(body);
  if (presentation === undefined) return;
  if (
    !record(presentation) ||
    !record(presentation.nodes) ||
    typeof presentation.headCss !== "string" ||
    typeof presentation.fontFaceCss !== "string" ||
    !record(presentation.brandPlugin)
  )
    reject("Invalid email presentation plan.");
  for (const [ordinal, entry] of Object.entries(presentation.nodes)) {
    if (!/^(0|[1-9]\d*)$/.test(ordinal) || !record(entry))
      reject("Invalid email presentation ordinal.");
    if (Object.keys(entry).some((key) => !["attrs", "style", "raw"].includes(key)))
      reject("A presentation override cannot contain document structure.");
    if (entry.attrs !== undefined && !record(entry.attrs))
      reject("Presentation attributes must be an object.");
    if (entry.raw !== undefined && !Array.isArray(entry.raw))
      reject("Presentation compatibility markup requires a list of parts.");
  }
};
