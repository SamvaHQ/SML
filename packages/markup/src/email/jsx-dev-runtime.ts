import { JSX_SOURCE_LOCATION_PROP, type JsxSource } from "../source-locations";
import { jsx, Fragment, type EmailComponent } from "./jsx-runtime";
export { Fragment };
export type { JSX } from "./jsx-runtime";
/** Development JSX retains compiler-provided origins directly on the semantic tree. */
export const jsxDEV = (
  type: string | EmailComponent<Record<string, unknown>> | typeof Fragment,
  props: Record<string, unknown> | null,
  _key?: unknown,
  _staticChildren?: boolean,
  source?: JsxSource,
) =>
  jsx(type, { ...props, [JSX_SOURCE_LOCATION_PROP]: props?.[JSX_SOURCE_LOCATION_PROP] ?? source });
