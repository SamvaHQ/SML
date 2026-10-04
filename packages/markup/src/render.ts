// The render entry: the published IR and everything that turns it into a message. It imports none
// of the compiler's libraries (Tailwind, css-tree, caniemail, Babel), so a send path that renders IR
// stays small; `tests/entry-closure.test.ts` pins that.
export * from "./ir";
export * from "./render-ir";
export * from "./email/render";
export * from "./email/html";
export * from "./email/text";
export * from "./email/elements";
export * from "./sms-segments";
export * from "./preview";
