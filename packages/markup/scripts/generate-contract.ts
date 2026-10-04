import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { parse } from "@babel/parser";

import {
  SMS_ATTRIBUTES,
  SMS_CATEGORIES,
  WHATSAPP_ATTRIBUTES,
  WHATSAPP_CATEGORIES,
  WHATSAPP_HEADER_TYPES,
} from "../src/channel-specs";
import { DIAGNOSTIC_CODE_FAMILIES, DIAGNOSTIC_CODES } from "../src/diagnostic-codes";
import { EMAIL_ELEMENTS, EMAIL_GLOBAL_ATTRIBUTES } from "../src/email/elements";
import { FORMATTER_NAMES } from "../src/fmt";
import { SML_IR_VERSION } from "../src/ir";
import { PROFILE_FORMS, PROFILE_REJECTED } from "../src/sml/profile";
import { TEMPLATE_ID_PATTERN } from "../src/template";

// `generated/contract.json` and `generated/reference.md` are written from the modules that own
// each fact: interface declarations for component props and formatters, the profile table, the
// diagnostic registry, the element table and the channel specs. Run `bun run codegen:contract`.

const read = (path: string) =>
  readFile(fileURLToPath(new URL(`../${path}`, import.meta.url)), "utf8");

interface Prop {
  readonly name: string;
  readonly type: string;
  readonly optional: boolean;
  readonly description?: string;
}

/** The property signatures of every exported interface in a source file, with their doc comments. */
const interfacesOf = (source: string): Map<string, Prop[]> => {
  const ast = parse(source, { sourceType: "module", plugins: ["typescript"], attachComment: true });
  const found = new Map<string, Prop[]>();
  for (const statement of ast.program.body) {
    const declaration =
      statement.type === "ExportNamedDeclaration" ? statement.declaration : undefined;
    if (declaration?.type !== "TSInterfaceDeclaration") continue;
    const props: Prop[] = [];
    for (const member of declaration.body.body) {
      if (member.type !== "TSPropertySignature" || member.key.type !== "Identifier") continue;
      const annotation = member.typeAnnotation?.typeAnnotation;
      const type =
        annotation === undefined
          ? "unknown"
          : source
              .slice(annotation.start ?? 0, annotation.end ?? 0)
              .replace(/\s+/g, " ")
              .replace(/ \| undefined$/, "");
      const comment = member.leadingComments
        ?.filter((entry) => entry.type === "CommentBlock" || entry.type === "CommentLine")
        .map((entry) =>
          entry.value
            .split("\n")
            .map((line) => line.replace(/^\s*\*?\s?/, "").trim())
            .filter((line) => line !== "")
            .join(" "),
        )
        .join(" ");
      props.push({
        name: member.key.name,
        type,
        optional: member.optional === true,
        ...(comment === undefined || comment === "" ? {} : { description: comment }),
      });
    }
    found.set(declaration.id.name, props);
  }
  return found;
};

const emailInterfaces = interfacesOf(await read("src/email/components.ts"));
const brandInterfaces = interfacesOf(await read("src/email/brand.ts"));
const smsInterfaces = interfacesOf(await read("src/sms.ts"));
const whatsappInterfaces = interfacesOf(await read("src/whatsapp.ts"));
const fmtSource = await read("src/fmt.ts");

const propsOf = (interfaces: Map<string, Prop[]>, name: string): Prop[] => {
  const props = interfaces.get(name);
  if (props === undefined) throw new Error(`${name} is not an exported interface.`);
  return props;
};

const component = (
  name: string,
  importFrom: string,
  interfaces: Map<string, Prop[]>,
  propsName: string,
) => ({ name, import: importFrom, props: propsOf(interfaces, propsName) });

const components = [
  ...["Email", "Section", "Columns", "Column", "Button", "Spacer", "Divider", "Image", "Link"].map(
    (name) => component(name, "@samva/markup/email", emailInterfaces, `${name}Props`),
  ),
  component("BrandLogo", "samva:brand", brandInterfaces, "BrandLogoProps"),
  component("BrandFooter", "samva:brand", brandInterfaces, "BrandFooterProps"),
];

const channelComponents = [
  component("Sms", "@samva/markup/sms", smsInterfaces, "SmsProps"),
  component("WhatsApp", "@samva/markup/whatsapp", whatsappInterfaces, "WhatsAppProps"),
  component("WhatsApp.Header", "@samva/markup/whatsapp", whatsappInterfaces, "WhatsAppHeaderProps"),
  component("WhatsApp.Body", "@samva/markup/whatsapp", whatsappInterfaces, "WhatsAppTextProps"),
  component("WhatsApp.Footer", "@samva/markup/whatsapp", whatsappInterfaces, "WhatsAppTextProps"),
  component(
    "WhatsApp.Buttons",
    "@samva/markup/whatsapp",
    whatsappInterfaces,
    "WhatsAppButtonsProps",
  ),
  component(
    "WhatsApp.UrlButton",
    "@samva/markup/whatsapp",
    whatsappInterfaces,
    "WhatsAppUrlButtonProps",
  ),
  component(
    "WhatsApp.PhoneButton",
    "@samva/markup/whatsapp",
    whatsappInterfaces,
    "WhatsAppPhoneButtonProps",
  ),
  component(
    "WhatsApp.QuickReplyButton",
    "@samva/markup/whatsapp",
    whatsappInterfaces,
    "WhatsAppQuickReplyButtonProps",
  ),
  component(
    "WhatsApp.CopyCodeButton",
    "@samva/markup/whatsapp",
    whatsappInterfaces,
    "WhatsAppCopyCodeButtonProps",
  ),
];

/** `money(amount: number, currency: string, locale?: string): string;` lines of the Fmt interface. */
const formatters = (() => {
  const body = /export interface Fmt \{([\s\S]*?)\n\}/.exec(fmtSource)?.[1] ?? "";
  const signatures = body
    .split("\n")
    .map((line) => line.trim().replace(/;$/, ""))
    .filter((line) => line !== "");
  const names = signatures.map((line) => /^(\w+)\(/.exec(line)?.[1]);
  if (JSON.stringify(names) !== JSON.stringify([...FORMATTER_NAMES]))
    throw new Error("The Fmt interface and FORMATTER_NAMES list different formatters.");
  return signatures.map((signature) => ({ name: `fmt.${signature.split("(")[0]}`, signature }));
})();

const diagnostics = Object.entries(DIAGNOSTIC_CODES)
  .map(([code, spec]) => ({ code, ...spec }))
  .sort((a, b) => a.code.localeCompare(b.code));
const diagnosticFamilies = Object.entries(DIAGNOSTIC_CODE_FAMILIES).map(([prefix, spec]) => ({
  prefix,
  ...spec,
}));

const contract = {
  contract: 1,
  irVersion: SML_IR_VERSION,
  template: {
    extension: ".tsx",
    directories: ["templates", "emails"],
    jsxImportSource: "@samva/markup/email",
    definition: { import: "@samva/markup", name: "defineTemplate" },
    fields: ["id", "schema", "fixtures", "locale?", "email?", "sms?", "whatsapp?"],
    idPattern: TEMPLATE_ID_PATTERN.source,
    emailBody: "{ subject, preheader?, body }, each a function of the validated input",
    schema:
      "Any Standard JSON Schema converter, or a literal jsonSchema<Input>({ ... }); portable JSON Schema 2020-12. It validates every send and drives the binding checker. No coercion and no inserted defaults.",
    fixtures:
      "Named payloads that must validate. At least one. Each is a preview and a publish check.",
    execution:
      "Nothing runs at send time. A template compiles to IR and the send path renders the IR against the input. Locale and time zone are send options.",
  },
  profile: { forms: PROFILE_FORMS, rejected: PROFILE_REJECTED },
  formatters,
  components,
  channelComponents,
  elements: EMAIL_ELEMENTS,
  globalAttributes: EMAIL_GLOBAL_ATTRIBUTES,
  styles: {
    dialect: "Tailwind classes plus theme.css tokens. Classes must be literal.",
    themeLayers: ['@import "./starter.css";', '@import "samva:brand";', "the project's own @theme"],
    fonts: "WOFF2 files in the project through @font-face; a stack must end in a generic family.",
  },
  channels: {
    sms: { categories: SMS_CATEGORIES, attributes: SMS_ATTRIBUTES },
    whatsapp: {
      categories: WHATSAPP_CATEGORIES,
      attributes: WHATSAPP_ATTRIBUTES,
      headerTypes: WHATSAPP_HEADER_TYPES,
    },
  },
  diagnostics,
  diagnosticFamilies,
  qualityBar: [
    "Run the check until it reports no errors, then render every fixture.",
    "Cover every branch with a fixture: default, missing optional fields, many items.",
    "Look at the render at desktop and mobile widths before finishing.",
    "Compute anything the profile cannot express where the message is sent and add it to the schema.",
  ],
};

const table = (headers: string[], rows: string[][]) =>
  [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map((cell) => cell.replaceAll("|", "\\|")).join(" | ")} |`),
  ].join("\n");

const code = (value: string) => (value.includes("`") ? `\`\` ${value} \`\`` : `\`${value}\``);

const reference = `# Template authoring reference

A template is one TSX file that default-exports \`defineTemplate({ id, schema, fixtures, email })\`
from \`@samva/markup\`, in \`templates/\` (\`emails/\` is also recognized). Set
\`jsxImportSource: "@samva/markup/email"\`. \`email\` is \`{ subject, preheader?, body }\`; each is a
function of the validated input that the compiler reads without running. The IR it produces is what
every preview and send renders (IR version ${SML_IR_VERSION}).

## Static profile

${table(
  ["Form", "Example", "Compiles to"],
  PROFILE_FORMS.map((form) => [form.form, code(form.example), form.compilesTo]),
)}

Refused, each with a diagnostic that names the fix:

${table(
  ["Form", "Example", "Code"],
  PROFILE_REJECTED.map((form) => [form.form, code(form.example), code(form.code)]),
)}

There is no escape hatch: compute the value where the message is sent and add it to the schema.

## Formatters

${table(
  ["Formatter", "Signature"],
  formatters.map((formatter) => [code(formatter.name), code(formatter.signature)]),
)}

## Components

${components
  .map(
    (entry) =>
      `### ${entry.name}\n\nImport from \`${entry.import}\`.\n\n${table(
        ["Prop", "Type", "Notes"],
        entry.props.map((prop) => [
          code(`${prop.name}${prop.optional ? "?" : ""}`),
          code(prop.type),
          prop.description ?? "",
        ]),
      )}`,
  )
  .join("\n\n")}

## HTML elements

${Object.entries(EMAIL_ELEMENTS)
  .map(
    ([name, spec]) =>
      `- ${code(name)}: ${spec.content} content; attributes: ${
        Object.keys(spec.attributes)
          .map((attribute) => code(attribute))
          .join(", ") || "global attributes only"
      }.`,
  )
  .join("\n")}

Global attributes: ${Object.keys(EMAIL_GLOBAL_ATTRIBUTES)
  .map((name) => code(name))
  .join(", ")}.

## Diagnostics

${table(
  ["Code", "Meaning", "Fix"],
  [
    ...diagnostics
      .filter((entry) => !("channelOnly" in entry))
      .map((entry) => [code(entry.code), entry.summary, entry.fix]),
    ...diagnosticFamilies.map((entry) => [
      code(`${entry.prefix}<feature>`),
      entry.summary,
      entry.fix,
    ]),
  ],
)}

## Upgrades

${diagnostics
  .flatMap((entry) => ("upgrade" in entry ? [`### ${code(entry.code)}\n\n${entry.upgrade}`] : []))
  .join("\n\n")}

## Quality bar

${contract.qualityBar.map((item) => `- ${item}`).join("\n")}
`;

const artifacts = [
  ["contract.json", `${JSON.stringify(contract, null, 2)}\n`],
  ["reference.md", reference],
] as const;
const paths = artifacts.map(([name]) =>
  fileURLToPath(new URL(`../generated/${name}`, import.meta.url)),
);
await Promise.all(artifacts.map(([, contents], index) => writeFile(paths[index]!, contents)));
const formatted = spawnSync("oxfmt", paths, { stdio: "inherit" });
if (formatted.status !== 0) process.exit(formatted.status ?? 1);
