import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

// Template projects on disk for the tests. Nothing here needs a Samva credential
// or the network.

export const LOGO = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);

const SCHEMA = `jsonSchema<{ name: string }>({
    type: "object",
    additionalProperties: false,
    required: ["name"],
    properties: { name: { type: "string", examples: ["Ada"] } },
  })`;

/** An email template. `copy` is the paragraph text, so a test can tell one build from the next. */
export const emailTemplate = (
  id: string,
  copy = "Hello",
  options: { readonly fixtures?: string; readonly imports?: string; readonly body?: string } = {},
): string => `import { defineTemplate } from "@samva/markup";
import { Email } from "@samva/markup/email";
import { jsonSchema } from "@samva/markup/input-schema";
${options.imports ?? ""}
export default defineTemplate({
  id: ${JSON.stringify(id)},
  schema: ${SCHEMA},
  fixtures: ${options.fixtures ?? `{ first: { name: "Ada" }, second: { name: "Grace" } }`},
  email: {
    subject: (input) => \`${copy}, \${input.name}\`,
    preheader: () => "Preview",
    body: (input) => (
      ${options.body ?? `<Email><p className="text-brand">${copy}, {input.name}</p></Email>`}
    ),
  },
});
`;

/** A template that declares all three channels. */
export const multiChannelTemplate = (
  id: string,
): string => `import { defineTemplate } from "@samva/markup";
import { Email } from "@samva/markup/email";
import { jsonSchema } from "@samva/markup/input-schema";
import { Sms } from "@samva/markup/sms";
import { WhatsApp } from "@samva/markup/whatsapp";

export default defineTemplate({
  id: ${JSON.stringify(id)},
  schema: ${SCHEMA},
  fixtures: { first: { name: "Ada" } },
  email: {
    subject: (input) => \`Order for \${input.name}\`,
    body: (input) => <Email><p>Order for {input.name}</p></Email>,
  },
  sms: (input) => <Sms category="transactional">Hi {input.name}, your order shipped.</Sms>,
  whatsapp: (input) => (
    <WhatsApp name="order_shipped" language="en_US" category="utility">
      <WhatsApp.Body>Hi {input.name}, your order shipped.</WhatsApp.Body>
      <WhatsApp.Buttons>
        <WhatsApp.QuickReplyButton>Thanks</WhatsApp.QuickReplyButton>
      </WhatsApp.Buttons>
    </WhatsApp>
  ),
});
`;

/** A partial the templates import: an ordinary module with no template in it. */
export const SIGNATURE_PARTIAL = `import { Section } from "@samva/markup/email";

export const Signature = () => <Section><p>The Samva team</p></Section>;
`;

export const THEME = "@theme { --color-brand: #123456; }\n";

export const writeFiles = async (
  root: string,
  files: Readonly<Record<string, string | Uint8Array>>,
): Promise<void> => {
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path);
    // Sequential: each write may create the directory the next one needs.
    await mkdir(dirname(full), { recursive: true });
    await (typeof content === "string"
      ? writeFile(full, content, "utf8")
      : writeFile(full, content));
  }
};

const roots: string[] = [];

/** A temporary project holding `files`; `cleanup` removes every one this file made. */
export const tempProject = async (
  files: Readonly<Record<string, string | Uint8Array>>,
): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), "samva-vite-"));
  roots.push(root);
  await writeFiles(root, { "package.json": '{"name":"project","private":true}\n', ...files });
  return root;
};

export const cleanupProjects = async (): Promise<void> => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
};
