/**
 * @vitest-environment happy-dom
 * @jsxImportSource react
 */
import { afterEach, describe, expect, it } from "@effect/vitest";
import { NIMBUS_WELCOME_TSX } from "@samva/editor/mock";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";

import { EmailFrame } from "../src/canvas/email-frame";
import { COPY_CODE_LABEL, PreviewOverlay } from "../src/chrome/preview-overlay";
import { EditorProvider } from "../src/state/provider";
import { markupEditor, SMS_TSX, WHATSAPP_TSX } from "./markup-host";
import { emitChange, mockEditor } from "./mock-host";
import { SMS_BODY_TEXT, WHATSAPP_URL_BUTTON } from "./selector-copy";

afterEach(cleanup);

const iframeDoc = (container: HTMLElement): Document => {
  const iframe = container.querySelector("iframe");
  const doc = iframe?.contentDocument ?? null;
  if (doc === null) {
    throw new Error("canvas iframe has no contentDocument");
  }
  return doc;
};

const frameCss = (container: HTMLElement): string =>
  [...iframeDoc(container).querySelectorAll("style")]
    .map((style) => style.textContent ?? "")
    .join("\n");

const DARK_DOCUMENT =
  "<!doctype html><html><head><style>@media (prefers-color-scheme:dark){body{background:#000}}</style>" +
  "</head><body>Hello</body></html>";

describe("EmailFrame color-scheme forcing", () => {
  it("forces dark on: rewrites the prefers-color-scheme:dark gate to @media all", () => {
    const { container } = render(
      <EmailFrame html={DARK_DOCUMENT} width={600} forceColorScheme="dark" />,
    );
    const css = frameCss(container);
    expect(css).toContain("@media all{body{background:#000}}");
    expect(css).not.toContain("prefers-color-scheme");
  });

  it("forces light off: rewrites the dark gate to a never-match query", () => {
    const { container } = render(
      <EmailFrame html={DARK_DOCUMENT} width={600} forceColorScheme="light" />,
    );
    const css = frameCss(container);
    expect(css).toContain("@media not all{body{background:#000}}");
    expect(css).not.toContain("prefers-color-scheme");
  });

  it("leaves the media gate intact when no scheme is forced (editing canvas)", () => {
    const { container } = render(<EmailFrame html={DARK_DOCUMENT} width={600} />);
    expect(frameCss(container)).toContain("@media (prefers-color-scheme:dark)");
  });

  it("toggles symmetrically, always transforming the document the host rendered", () => {
    const view = render(<EmailFrame html={DARK_DOCUMENT} width={600} forceColorScheme="light" />);
    expect(frameCss(view.container)).toContain("@media not all{body{background:#000}}");

    view.rerender(<EmailFrame html={DARK_DOCUMENT} width={600} forceColorScheme="dark" />);
    expect(frameCss(view.container)).toContain("@media all{body{background:#000}}");

    // Back to light — derived from the ORIGINAL gate, not from the @media all rewrite.
    view.rerender(<EmailFrame html={DARK_DOCUMENT} width={600} forceColorScheme="light" />);
    expect(frameCss(view.container)).toContain("@media not all{body{background:#000}}");
    expect(frameCss(view.container)).not.toContain("@media all{body");
  });
});

describe("PreviewOverlay — email", () => {
  it("shows the envelope summary and forces the scheme both ways", async () => {
    const { host } = await mockEditor();
    const view = render(
      <EditorProvider
        host={host}
        checks={[
          {
            id: "outlook-radius",
            severity: "info",
            label: "Rounded corners",
            detail: "Outlook Windows renders square corners.",
          },
        ]}
      >
        <PreviewOverlay open onClose={() => {}} />
      </EditorProvider>,
    );
    const overlay = view.baseElement as HTMLElement;

    await waitFor(() => expect(overlay.textContent).toContain("Nimbus Coffee"));
    expect(overlay.textContent).toContain("Ada, your first bag is on us");
    expect(overlay.textContent).toContain("Freshly roasted");

    const clientNotes = view.getByTestId("checks.compatibility-report");
    fireEvent.click(clientNotes);
    expect(await view.findByTestId("checks.report")).toBeTruthy();
    fireEvent.click(view.getByTestId("checks.report.close"));
    await waitFor(() => expect(view.queryByTestId("checks.report")).toBeNull());

    // Light by default: the rendered dark rules are forced OFF, so the OS theme
    // cannot leak them in. The gate is rewritten, not left live.
    await waitFor(() => {
      const css = frameCss(overlay);
      expect(css).toContain("@media not all");
      expect(css).not.toContain("prefers-color-scheme");
    });

    fireEvent.click(view.getByTestId("preview-overlay.scheme.dark"));
    await waitFor(() => {
      const css = frameCss(overlay);
      expect(css).toContain("@media all");
      expect(css).not.toContain("@media not all");
    });

    fireEvent.click(view.getByTestId("preview-overlay.scheme.light"));
    await waitFor(() => expect(frameCss(overlay)).toContain("@media not all"));
  });

  it("shows the rendered HTML, its plain text, and the authored TSX behind it", async () => {
    const { host } = await mockEditor();
    const view = render(
      <EditorProvider host={host}>
        <PreviewOverlay open onClose={() => {}} />
      </EditorProvider>,
    );
    const overlay = view.baseElement as HTMLElement;
    await waitFor(() => expect(overlay.querySelector("iframe")).not.toBeNull());

    fireEvent.click(view.getByTestId("preview-overlay.view.html"));
    expect(overlay.querySelector("pre")?.textContent).toContain("data-samva-instance");

    fireEvent.click(view.getByTestId("preview-overlay.view.text"));
    expect(overlay.querySelector("pre")?.textContent).toContain("your first bag is on us");

    // The source view is the canonical entry, never emitted markup.
    fireEvent.click(view.getByTestId("preview-overlay.view.source"));
    expect(overlay.querySelector("pre")?.textContent).toBe(NIMBUS_WELCOME_TSX);
  });

  it("says there is nothing to preview when the entry did not build", async () => {
    const editor = await mockEditor();
    const view = render(
      <EditorProvider host={editor.host}>
        <PreviewOverlay open onClose={() => {}} />
      </EditorProvider>,
    );
    const overlay = view.baseElement as HTMLElement;
    await waitFor(() => expect(overlay.querySelector("iframe")).not.toBeNull());

    await act(() => emitChange(editor, { origin: "external", broken: true }));

    await waitFor(() => expect(overlay.querySelector("iframe")).toBeNull());
    expect(overlay.textContent).toContain("current draft did not build");
  });

  it("renders nothing when closed", async () => {
    const { host } = await mockEditor();
    const view = render(
      <EditorProvider host={host}>
        <PreviewOverlay open={false} onClose={() => {}} />
      </EditorProvider>,
    );
    expect(view.baseElement.querySelector("iframe")).toBeNull();
  });
});

describe("PreviewOverlay — markup channels", () => {
  it("previews the rendered SMS body and its segment count", async () => {
    const source = SMS_TSX.replace(
      /<Sms category="transactional">[\s\S]*<\/Sms>/,
      `<Sms category="transactional">${SMS_BODY_TEXT}</Sms>`,
    );
    const view = render(
      <EditorProvider host={markupEditor("sms", source).host}>
        <PreviewOverlay open onClose={() => {}} />
      </EditorProvider>,
    );

    await waitFor(() =>
      expect(view.getByTestId("preview-overlay.sms-body").textContent).toBe(SMS_BODY_TEXT),
    );
    expect(view.getByTestId("sms-counter").textContent).toBe("GSM7 · 19 characters · 1 segment");
    // An SMS has no HTML view; its source view is the TSX it was authored in.
    expect(view.queryByTestId("preview-overlay.view.html")).toBeNull();
    fireEvent.click(view.getByTestId("preview-overlay.view.source"));
    expect((view.baseElement as HTMLElement).querySelector("pre")?.textContent).toBe(source);
  });

  it("renders every WhatsApp button, masking the copy-code value", async () => {
    const source = WHATSAPP_TSX.replace(
      "<WhatsApp.QuickReplyButton>Stop</WhatsApp.QuickReplyButton>",
      "<WhatsApp.CopyCodeButton>SAVE10</WhatsApp.CopyCodeButton>",
    );
    const view = render(
      <EditorProvider host={markupEditor("whatsapp", source).host}>
        <PreviewOverlay open onClose={() => {}} />
      </EditorProvider>,
    );

    await waitFor(() => expect(view.getByText(WHATSAPP_URL_BUTTON)).toBeTruthy());
    expect(view.getByText(COPY_CODE_LABEL)).toBeTruthy();
    // oxlint-disable-next-line samva/no-copy-string-selector -- The copy-code payload is the rendered value under test, not UI chrome.
    expect(view.queryByText("SAVE10")).toBeNull();
    fireEvent.click(view.getByTestId("preview-overlay.view.payload"));
    expect((view.baseElement as HTMLElement).querySelector("pre")?.textContent).toContain(
      '"body": "Hi Ada, your order shipped."',
    );
  });

  it("says there is nothing to preview when the channel did not build", async () => {
    const view = render(
      <EditorProvider host={markupEditor("sms", "export default 1;").host}>
        <PreviewOverlay open onClose={() => {}} />
      </EditorProvider>,
    );
    await waitFor(() =>
      expect(view.baseElement.textContent).toContain("current draft did not build"),
    );
  });
});
