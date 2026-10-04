// Every diagnostic code the compiler can report, with what it means and how to repair it. The
// contract (`generated/contract.json`) and the docs read this table, and the lowering funnels
// (`Findings.add`, the lowerer's `error`) accept only these codes, so a new finding cannot ship
// without its explanation. `tests/diagnostic-codes.test.ts` pins the table against the sources.

export interface DiagnosticCodeSpec {
  /** What is wrong, in one sentence an agent can act on. */
  readonly summary: string;
  /** The repair, in one sentence. */
  readonly fix: string;
  /** Agent instructions for upgrading an incompatible template format. */
  readonly upgrade?: string;
  /** Reported only for an SMS or WhatsApp body; surfaces that gate those channels omit it. */
  readonly channelOnly?: true;
}

const codes = <const Table extends Record<string, DiagnosticCodeSpec>>(table: Table): Table =>
  table;

export const DIAGNOSTIC_CODES = codes({
  // Definition
  "no-template": {
    summary: "The entry does not default-export a template.",
    fix: "Default-export defineTemplate({ ... }) imported from @samva/markup.",
  },
  "legacy-definition": {
    summary: "The entry default-exports something other than defineTemplate.",
    fix: 'Import { defineTemplate } from "@samva/markup" and default-export defineTemplate({ ... }).',
    upgrade: [
      'Read the entry and its imports without executing them. For a default-exported defineEmail definition, import defineTemplate from "@samva/markup" and replace the definition call.',
      "Preserve the entry path, template id, schema, named fixtures, content, design, bindings, conditions, project partials, assets, theme and brand imports. Replace render(input) returning { subject, preheader?, body } with email: { subject: (input) => ..., preheader: (input) => ..., body: (input) => ... }, retaining its parameter bindings and each returned expression; omit preheader when absent.",
      "Inline module constants only when they are literal strings, numbers or booleans and their bindings are unambiguous; never substitute a fixture value for an input binding. Keep each channel function a single static-profile expression, and keep subject and preheader off <Email>.",
      "Helper calls, `Math.*`, general arithmetic, render statements, spreads, computed properties and runtime clock or seed have no direct conversion. Rewrite with static-profile bindings, conditions, .map, .filter, project partials or `fmt.*` where equivalent; arithmetic is allowed only in formatter arguments and conditions. Otherwise compute the value in the sender, declare a payload field in the schema and every fixture, and explain the required sender change. Never guess time, randomness or computed data.",
      "Explicit text has no email-channel field: plain text is derived from the body. If deriving it changes intended content, or another construct cannot be preserved, explain the tradeoff and ask rather than silently discard it. Do not drop fixtures, weaken validation or hide diagnostics.",
      "Convert every affected entry in the project at its existing path, including emails/ entries. Compile each entry, render every declared fixture and inspect the affected output. Resolve errors before requesting one saved version for the whole project, approved by the user; do not publish.",
    ].join("\n\n"),
  },
  "dynamic-definition": {
    summary: "A definition field is spread or computed instead of written out.",
    fix: "Write each field as name: value.",
  },
  "invalid-template-id": {
    summary: "The template id is not a lowercase kebab-case string literal.",
    fix: 'Write id: "order-shipped".',
  },
  "missing-schema": {
    summary: "The template declares no input schema.",
    fix: "Add schema: jsonSchema<Input>({ ... }).",
  },
  "schema-not-static": {
    summary: "The schema cannot be read without running code.",
    fix: "Write the schema as a literal jsonSchema<Input>({ type: 'object', ... }).",
  },
  "invalid-schema": {
    summary: "The schema uses JSON Schema keywords the compiler cannot validate against.",
    fix: "Use only the JSON Schema keywords the package README lists.",
  },
  "missing-fixtures": {
    summary: "The template declares no fixtures.",
    fix: "Add fixtures: { default: { ... } } with at least one valid payload.",
  },
  "fixtures-not-static": {
    summary: "A fixture is computed instead of written as data.",
    fix: "Write each fixture as a literal object; an imported asset is allowed.",
  },
  "invalid-fixture-name": {
    summary: "A fixture key is not a single path segment.",
    fix: "Use letters, digits, '.', '_' and '-', starting with a letter or digit.",
  },
  "fixture-invalid": {
    summary: "A fixture does not match the schema.",
    fix: "Change the fixture, or the schema, so every fixture is a payload a send could carry.",
  },
  "invalid-locale": {
    summary: "The template's default locale is not a string literal.",
    fix: 'Write locale: "en-US".',
  },
  "no-channel": {
    summary: "The template declares no channel body.",
    fix: "Add an email body.",
  },
  "invalid-channel": {
    summary: "A channel field is not shaped as the channel requires.",
    fix: "Write email: { subject, preheader?, body } with each a function of the input.",
  },
  "not-a-function": {
    summary: "A channel field is not a function of the input.",
    fix: "Write (input) => ... in place or declare the function in the project.",
  },
  "missing-subject": {
    summary: "The email channel has no subject.",
    fix: "Add subject: (input) => ....",
  },
  "missing-body": {
    summary: "The email channel has no body.",
    fix: "Add body: (input) => (<Email>...</Email>).",
  },
  "multiple-roots": {
    summary: "The body renders nothing or more than one root.",
    fix: "Wrap the body in a single element such as <Email>.",
  },
  "preheader-without-shell": {
    summary: "A preheader is set but the body has no <Email> shell to hold it.",
    fix: "Wrap the body in <Email>.",
  },
  "wrong-channel": {
    summary: "A channel body does not return its own channel component.",
    fix: "Return one element imported from the channel package.",
    channelOnly: true,
  },

  // Project
  "syntax-error": {
    summary: "A project file does not parse as TSX.",
    fix: "Fix the syntax at the reported location.",
  },
  "non-project-import": {
    summary: "The file imports something other than @samva/markup or a project file.",
    fix: "Remove the import, or copy the code you need into a project file.",
  },
  "moved-import": {
    summary: "The file imports an @samva/markup entry that moved.",
    fix: 'Import email components from "@samva/markup/email".',
    upgrade: [
      'Replace every import from "@samva/markup/email/components" with "@samva/markup/email" in every project file, templates and partials alike. The imported names are unchanged; change only the specifier.',
      "Compile each entry and render every declared fixture to confirm the output is unchanged. Resolve errors before requesting one saved version for the whole project, approved by the user; do not publish.",
    ].join("\n\n"),
  },
  "unresolved-import": {
    summary: "An import names no file in the project.",
    fix: "Check the path and the file extension.",
  },
  "recursive-partial": {
    summary: "A partial renders itself; partials are inlined at compile time.",
    fix: "Flatten the recursion, or repeat the structure with .map.",
  },
  "nesting-limit": {
    summary: "The template nests deeper than the compiler reads.",
    fix: "Flatten the structure.",
  },

  // Static profile
  "dynamic-expression": {
    summary:
      "An expression outside the static profile: a call other than fmt.* and .map, a computed value, or a spread.",
    fix: "Compute the value where the message is sent and bind it from the payload.",
  },
  "statement-in-body": {
    summary: "A body contains a statement (const, if, a loop); a body is one expression.",
    fix: "Use cond && <X />, cond ? <A /> : <B /> and .map, or send the computed value in the payload.",
  },
  "unsupported-pattern": {
    summary: "A parameter pattern or default value the profile cannot bind.",
    fix: "Use plain names or destructuring without defaults; declare the field required or guard it.",
  },
  "hook-call": {
    summary: "A hook was called; templates have no state, effects or context.",
    fix: "Read the input through the function's parameter and send anything else in the payload.",
  },
  "unknown-formatter": {
    summary: "fmt.<name> is not a formatter.",
    fix: "Use fmt.money, number, date, time, plural or list.",
  },
  "formatter-arguments": {
    summary: "A formatter got the wrong number of arguments.",
    fix: "Match the formatter's signature in the contract.",
  },
  "reserved-character": {
    summary: "Text contains a private-use character the compiler reserves.",
    fix: "Remove the characters U+E000 to U+E003.",
  },
  "reserved-url": {
    summary: "A URL is the unsubscribe placeholder only BrandFooter can write.",
    fix: "Render <BrandFooter /> instead.",
  },
  "reserved-attribute": {
    summary: "An attribute is written only by a brand component.",
    fix: "Render BrandFooter from the brand import instead of marking an element as the footer.",
  },
  "dynamic-class": {
    summary: "A class name is built at run time, and Tailwind cannot see it.",
    fix: 'Write classes literally, or choose between literal lists: input.vip ? "bg-amber-100" : "bg-white".',
  },
  "too-many-class-variants": {
    summary: "A class list chooses between more literal lists than the compiler resolves.",
    fix: "Split the choice into fewer conditions, or move part of it to a partial.",
  },
  "invalid-style": {
    summary: "A style prop is not a static property object.",
    fix: 'Write style={{ backgroundColor: "#fff" }} with literal values, or use classes.',
  },

  // Bindings
  "unknown-field": {
    summary: "A binding names a field the schema does not declare.",
    fix: "Add the field to the schema, or bind a field it declares (the message suggests the nearest).",
  },
  "unguarded-optional": {
    summary:
      "An optional field is read outside a guard, so a send without it would render a blank.",
    fix: "Guard it with {input.field && ...}, or make the field required.",
  },
  "invalid-binding-type": {
    summary: "A binding has the wrong type for where it is used.",
    fix: "Bind a field of the type the position needs, or send it in that type.",
  },

  // Components and elements
  "unknown-component": {
    summary: "A component the profile cannot read.",
    fix: "Import components from @samva/markup/email, the brand import, or the project.",
  },
  "dynamic-numeric-prop": {
    summary: "A prop that sizes layout at compile time is not a number literal.",
    fix: "Write the number literally, for example height={44}.",
  },
  "button-dynamic-label": {
    summary: "A Button label is read at render time, so classic Outlook cannot size it.",
    fix: "Give the button a width: <Button width={200}>.",
  },
  "invalid-columns-each": {
    summary: "<Columns each> is not a list from the input.",
    fix: "Write each={input.items} with a callback returning <Column>.",
  },
  "invalid-columns-per": {
    summary: "<Columns per> is not a positive integer literal.",
    fix: "Write per={2}.",
  },
  "invalid-button-number": {
    summary: "A Button size prop is not a finite number.",
    fix: "Pass a finite number.",
  },
  "unsupported-element": {
    summary: "An element outside the supported email vocabulary.",
    fix: "Use an element from the contract's element table.",
  },
  "unsupported-attribute": {
    summary: "An attribute the element does not support.",
    fix: "Use a supported attribute, or data-* and aria-*.",
  },
  "missing-attribute": {
    summary: "An element is missing a required attribute.",
    fix: "Add the attribute, for example alt on img.",
  },
  "invalid-attribute-value": {
    summary: "An attribute value is not a string or number, or contains control characters.",
    fix: "Pass plain text.",
  },
  "duplicate-attribute": {
    summary: "An attribute is written twice.",
    fix: "Keep one.",
  },
  "invalid-content": {
    summary: "An element holds content its content model does not allow.",
    fix: "Move the child to a parent that accepts it.",
  },
  "void-element-children": {
    summary: "A void element has children.",
    fix: "Remove the children.",
  },
  "event-handler": {
    summary: "An event handler; email clients strip scripting.",
    fix: "Remove the handler; use a link for interaction.",
  },
  "dangerous-html": {
    summary: "dangerouslySetInnerHTML; there is no raw-HTML escape hatch.",
    fix: "Write the markup as JSX.",
  },
  "unsafe-url": {
    summary: "A URL uses a scheme email cannot send safely.",
    fix: "Use an https URL, a mailto: or tel: link, or a bound URL.",
  },
  "unsafe-raw-text": {
    summary: "Raw text content contains markup that could end its element.",
    fix: "Remove the offending sequence.",
  },
  "unsupported-style-property": {
    summary: "A style property name is not a CSS property.",
    fix: "Write camelCase (backgroundColor) or a custom property (--brand).",
  },
  "invalid-style-value": {
    summary: "A style value is not a string or number.",
    fix: "Pass a string or number.",
  },
  "unsafe-style-value": {
    summary: "A style value contains CSS that could break out of its declaration.",
    fix: "Remove the offending characters.",
  },
  "missing-head": {
    summary: "Styles that cannot be inlined need a <head> to live in.",
    fix: "Wrap the message in <Email>, or write those declarations inline.",
  },
  "invalid-subject": {
    summary: "The subject is not one line of text.",
    fix: "Return a single-line string.",
  },
  "invalid-preheader": {
    summary: "The preheader is not a string.",
    fix: "Return a string.",
  },
  "invalid-text": {
    summary: "The plain-text body is not a string.",
    fix: "Return a string.",
  },
  "button-outlook-fallback": {
    summary: "Classic Outlook needs a height and a plain string label to draw the button.",
    fix: "Give <Button> a height and a string label.",
  },

  // Styles and fonts
  "unmatched-class": {
    summary: "A class produced no styles.",
    fix: "Use a class the theme or Tailwind defines, or write the style inline.",
  },
  "tailwind-dynamic-class": {
    summary: "A class list is assembled at run time.",
    fix: "Write the classes literally.",
  },
  "css-parse-error": {
    summary: "A stylesheet does not parse.",
    fix: "Fix the CSS at the reported location.",
  },
  "css-import-unresolved": {
    summary: "A stylesheet @import cannot be resolved.",
    fix: "Import the stylesheet from the template module, or use the theme.css layers.",
  },
  "css-unsupported-at-rule": {
    summary: "An at-rule is not applied to email output.",
    fix: "Remove it or move the declarations into a class rule.",
  },
  "css-conditional-variable": {
    summary: "A custom property is redefined inside a conditional at-rule.",
    fix: "Keep the override on a class rule.",
  },
  "email-font-fallback": {
    summary: "A font stack names a project font without a generic fallback.",
    fix: "End the stack with sans-serif, serif or monospace.",
  },
  "email-font-family": {
    summary: "@font-face declares no font-family.",
    fix: "Add font-family.",
  },
  "email-font-src": {
    summary: "@font-face declares no usable url() src.",
    fix: "Add a url() pointing at a .woff2 file.",
  },
  "email-font-format": {
    summary: "@font-face uses a format other than WOFF2.",
    fix: "Convert the file to .woff2.",
  },
  "email-font-missing": {
    summary: "@font-face names a file the project does not hold.",
    fix: "Add the file; paths resolve from the stylesheet's directory.",
  },
  "invalid-asset-base": {
    summary: "The asset base is not an https URL or a path.",
    fix: "Use an https URL, an absolute path, or a relative path.",
  },

  // Brand
  "brand-unavailable": {
    summary: "The build has no brand to resolve a brand import.",
    fix: "Create or select the brand the import names.",
  },
  "brand-import-conflict": {
    summary: "The project imports two different brands.",
    fix: "Import one brand specifier everywhere.",
  },

  // Client compatibility
  "caniemail/unknown-coverage": {
    summary: "A feature has no client-support data.",
    fix: "Verify it in the target clients.",
  },

  // Channels
  "invalid-attribute": {
    summary: "A channel component attribute has a value the channel does not accept.",
    fix: "Use one of the listed values.",
    channelOnly: true,
  },
  "unknown-attribute": {
    summary: "A channel component attribute the component does not have.",
    fix: "Use one of the listed attributes.",
    channelOnly: true,
  },
  "sms-markup": {
    summary: "An SMS body contains an element; SMS is plain text.",
    fix: "Write text and bindings, with a newline for a line break.",
    channelOnly: true,
  },
  "whatsapp-structure": {
    summary: "WhatsApp content sits outside Header, Body, Footer or Buttons.",
    fix: "Move it into <WhatsApp.Body>.",
    channelOnly: true,
  },
  "whatsapp-body-required": {
    summary: "A WhatsApp template has no body.",
    fix: "Add <WhatsApp.Body>...</WhatsApp.Body>.",
    channelOnly: true,
  },
  "whatsapp-conditional": {
    summary: "A WhatsApp part branches or contains elements; Meta registers its text once.",
    fix: "Choose the wording in the payload, or write separate templates.",
    channelOnly: true,
  },
  "whatsapp-header-media": {
    summary: "A WhatsApp media header is not exactly one URL.",
    fix: "Write the URL as the only child: a literal or one binding.",
    channelOnly: true,
  },
  "whatsapp-header-variables": {
    summary: "A WhatsApp header text takes more than one variable.",
    fix: "Keep one binding in the header and move the rest to the body.",
    channelOnly: true,
  },
  "whatsapp-length": {
    summary: "A WhatsApp part exceeds Meta's length limit.",
    fix: "Shorten the text.",
    channelOnly: true,
  },
  "whatsapp-button-text": {
    summary: "A WhatsApp button has no label or value between its tags.",
    fix: "Write the label or value as text between the tags.",
    channelOnly: true,
  },
  "whatsapp-button-limit": {
    summary: "The conditions can produce more buttons of a kind than Meta allows.",
    fix: "Remove buttons, or split the template.",
    channelOnly: true,
  },
});

/** Whether a diagnostic identifier selects an agent-driven format upgrade. */
export const hasUpgradeRecipe = (code: string): boolean =>
  Object.entries(DIAGNOSTIC_CODES).some(
    ([identifier, spec]) => identifier === code && "upgrade" in spec,
  );

export type DiagnosticCode = keyof typeof DIAGNOSTIC_CODES;

/** Families whose code carries a suffix chosen at run time. */
export const DIAGNOSTIC_CODE_FAMILIES = {
  "caniemail/": {
    summary:
      "A CSS property, HTML element or attribute that a target email client ignores or partly supports (from the caniemail.com data), reported as caniemail/<feature>.",
    fix: "Use the alternative the message names, such as an email component instead of display: flex.",
  },
} as const satisfies Record<string, DiagnosticCodeSpec>;
