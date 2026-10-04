import type { Stylesheet } from "../../src/email/css";
import { mergeStylesheets } from "../../src/email/stylesheets";

// Tests of the serializer and the cascade register the stylesheets a message is rendered against.
// The registry is module state that a test resets between cases; the shipped package passes a
// stylesheet to the renderer explicitly and keeps no registry.

interface Registered {
  readonly sheet: Stylesheet;
  readonly base: number;
}

let registry: Registered[] = [];
let nextBase = 0;

/** Add a stylesheet after the ones already registered. */
export const registerStylesheet = (sheet: Stylesheet): void => {
  const size = sheet.rules.length;
  registry.push({ sheet, base: nextBase });
  nextBase += size + 1;
};

/** Drop every registration. */
export const resetStylesheets = (): void => {
  registry = [];
  nextBase = 0;
};

/** Every registered sheet flattened into one, with order preserved across sheets. */
export const collectStylesheets = (): Stylesheet =>
  mergeStylesheets(registry.map(({ sheet }) => sheet));

/** True when a template registered no styles at all, so the render can skip the pass. */
const hasStylesheets = (): boolean => registry.length > 0;

/** The registry as it stands, or `undefined` when no sheet registered. */
export const snapshotStylesheets = (): Stylesheet | undefined =>
  hasStylesheets() ? collectStylesheets() : undefined;
