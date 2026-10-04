import { contractVersion, type EditableEditorDocument } from "@samva/editor/host";
import type { AsyncEditableEditorHost } from "@samva/editor/host";
import { compileTemplate } from "@samva/markup/compiler";
import { renderIrSms, renderIrWhatsApp } from "@samva/markup/render";

/**
 * A controlled host for the SMS and WhatsApp lanes that does what a real host does: it holds the
 * authored TSX, compiles it with the static compiler, renders the first fixture from the IR, and
 * answers each save with the render of what was saved. Tests drive the editor against it instead
 * of modelling editor state a second time.
 */

const FILE = "templates/entry.tsx";

const IMPORTS = `import { defineTemplate } from "@samva/markup";
import { jsonSchema } from "@samva/markup/input-schema";`;

export const SMS_TSX = `${IMPORTS}
import { Sms } from "@samva/markup/sms";

export default defineTemplate({
  id: "verification-code",
  schema: jsonSchema<{ name: string; code: string; vip?: boolean }>({
    type: "object",
    properties: {
      name: { type: "string" },
      code: { type: "string" },
      vip: { type: "boolean" },
    },
    required: ["name", "code"],
    additionalProperties: false,
  }),
  fixtures: { default: { name: "Ada", code: "123456", vip: true } },
  sms: (input) => (
    <Sms category="transactional">
      Hi {input.name}, your code is {input.code}.
      {input.vip && " Priority."}
    </Sms>
  ),
});
`;

export const WHATSAPP_TSX = `${IMPORTS}
import { WhatsApp } from "@samva/markup/whatsapp";

export default defineTemplate({
  id: "order-update",
  schema: jsonSchema<{ name: string; orderId: string }>({
    type: "object",
    properties: { name: { type: "string" }, orderId: { type: "string" } },
    required: ["name", "orderId"],
    additionalProperties: false,
  }),
  fixtures: { default: { name: "Ada", orderId: "NW-1" } },
  whatsapp: (input) => (
    <WhatsApp name="order_update" language="en_US" category="utility">
      <WhatsApp.Header>Order {input.orderId}</WhatsApp.Header>
      <WhatsApp.Body>Hi {input.name}, your order shipped.</WhatsApp.Body>
      <WhatsApp.Buttons>
        <WhatsApp.UrlButton url="https://example.com/track">Track order</WhatsApp.UrlButton>
        <WhatsApp.QuickReplyButton>Stop</WhatsApp.QuickReplyButton>
      </WhatsApp.Buttons>
    </WhatsApp>
  ),
});
`;

type MarkupChannel = "sms" | "whatsapp";

const build = async (channel: MarkupChannel, source: string, revision: string) => {
  const compiled = await compileTemplate({
    files: { [FILE]: source },
    entry: FILE,
    assetBase: "https://assets.example",
  });
  const fixtures = Object.keys(compiled.fixtures);
  const fixture = fixtures[0] ?? null;
  const input = fixture === null ? undefined : compiled.fixtures[fixture];
  const ir = compiled.ir;
  const render =
    ir === undefined || fixture === null
      ? null
      : channel === "sms"
        ? { revision, text: renderIrSms(ir, input) }
        : { revision, ...renderIrWhatsApp(ir, input) };
  return {
    channel,
    preview: { status: "current" as const },
    fixtures,
    fixture,
    render,
    diagnostics: compiled.diagnostics,
  };
};

export interface MarkupEditor {
  readonly host: AsyncEditableEditorHost;
  /** The authored source of every save, in order. */
  readonly saves: string[];
}

export const markupEditor = (channel: MarkupChannel, initial?: string): MarkupEditor => {
  let source = initial ?? (channel === "sms" ? SMS_TSX : WHATSAPP_TSX);
  let counter = 1;
  let publish: ((change: never) => void) | null = null;
  const saves: string[] = [];
  const rev = () => `rev_${counter}`;
  const host: AsyncEditableEditorHost = {
    contractVersion,
    access: "editable",
    sourceAccess: "editable",
    document: {
      open: async (onChange) => {
        publish = onChange as (change: never) => void;
        const content = await build(channel, source, rev());
        const initialDocument = {
          id: `tpl_${channel}`,
          name: channel === "sms" ? "Verification code" : "Order update",
          rev: rev(),
          origin: { kind: "tsx", file: FILE, authoredSource: source },
          access: { kind: "editable" },
          variables: [],
          metadata: {},
          ...content,
        } as EditableEditorDocument;
        return { initial: initialDocument, close: () => {} };
      },
    },
    writer: {
      save: async (update) => {
        if (update.kind !== "authoredSource") return { rev: rev() };
        source = update.authoredSource;
        counter += 1;
        saves.push(source);
        const content = await build(channel, source, rev());
        // oxlint-disable-next-line samva/no-unsafe-type-assertion -- The double stands in for the host's change stream, which the test feeds a partial change.
        publish?.({ rev: rev(), origin: "self", authoredSource: source, ...content } as never);
        return { rev: rev() };
      },
    },
  };
  return { host, saves };
};
