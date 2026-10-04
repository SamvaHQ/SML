/**
 * @vitest-environment happy-dom
 * @jsxImportSource react
 */
/* oxlint-disable samva/no-copy-string-selector -- The channel forms are found by their accessible field names, which are the contract under test. */
import { afterEach, describe, expect, it } from "@effect/vitest";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";

import { SmsWorkspace } from "../src/channels/sms-workspace";
import { WhatsAppWorkspace } from "../src/channels/whatsapp-workspace";
import { EditorProvider } from "../src/state/provider";
import { markupEditor, SMS_TSX, WHATSAPP_TSX } from "./markup-host";
import { useEditorProbe, type EditorProbe } from "./store-probe";

afterEach(cleanup);

function Probe({ onReady }: { onReady: (value: EditorProbe) => void }) {
  onReady(useEditorProbe());
  return null;
}

const value = (element: HTMLElement): string => (element as HTMLTextAreaElement).value;

const openSelect = (trigger: HTMLElement): void => {
  fireEvent.pointerDown(trigger, { button: 0, pointerType: "mouse" });
  fireEvent.mouseDown(trigger, { button: 0 });
  fireEvent.pointerUp(trigger, { button: 0, pointerType: "mouse" });
  fireEvent.click(trigger);
};

/** Base UI ignores an item press that lands right after the popup opens. */
const chooseOption = async (option: HTMLElement): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 300));
  fireEvent.pointerEnter(option);
  fireEvent.mouseMove(option);
  fireEvent.pointerDown(option, { button: 0, pointerType: "mouse" });
  fireEvent.mouseDown(option, { button: 0 });
  fireEvent.pointerUp(option, { button: 0, pointerType: "mouse" });
  fireEvent.mouseUp(option, { button: 0 });
  fireEvent.click(option);
};

const lastSave = (saves: ReadonlyArray<string>): string => saves.at(-1) ?? "";

describe("SMS workspace", () => {
  it("shows the form the authored TSX describes and the counter of the host's render", async () => {
    const view = render(
      <EditorProvider host={markupEditor("sms").host}>
        <SmsWorkspace />
      </EditorProvider>,
    );

    const first = await waitFor(() => view.getByTestId("sms-workspace.body-segment.1"));
    expect(value(first)).toBe("Hi ");
    expect(value(view.getByTestId("sms-workspace.body-segment.3"))).toBe(", your code is ");
    // Expressions are locked, shown as authored.
    expect(view.getAllByText("{input.name}").length).toBeGreaterThan(0);
    expect(view.getAllByText('{input.vip && " Priority."}').length).toBeGreaterThan(0);
    await waitFor(() =>
      expect(view.getByTestId("sms-counter").textContent).toBe("GSM7 · 38 characters · 1 segment"),
    );
    for (const variable of ["code", "name", "vip"]) expect(view.getByText(variable)).toBeTruthy();
  });

  it("saves an exact source edit for a text change and updates the counter from the new render", async () => {
    const editor = markupEditor("sms");
    const view = render(
      <EditorProvider host={editor.host}>
        <SmsWorkspace />
      </EditorProvider>,
    );
    const segment = await waitFor(() => view.getByTestId("sms-workspace.body-segment.3"));

    fireEvent.change(segment, { target: { value: ", your login code is " } });

    await waitFor(() => expect(editor.saves).toHaveLength(1));
    expect(lastSave(editor.saves)).toBe(
      SMS_TSX.replace(", your code is ", ", your login code is "),
    );
    await waitFor(() =>
      expect(view.getByTestId("sms-counter").textContent).toBe("GSM7 · 44 characters · 1 segment"),
    );
  });

  it("keeps typing while the last save is unanswered, and undoes it as one step", async () => {
    const editor = markupEditor("sms");
    let probe: EditorProbe | null = null;
    const view = render(
      <EditorProvider host={editor.host}>
        <SmsWorkspace />
        <Probe onReady={(ready) => (probe = ready)} />
      </EditorProvider>,
    );
    const segment = await waitFor(() => view.getByTestId("sms-workspace.body-segment.3"));

    fireEvent.change(segment, { target: { value: ", your c" } });
    fireEvent.change(segment, { target: { value: ", your co" } });
    fireEvent.change(segment, { target: { value: ", your code" } });

    await waitFor(() =>
      expect(lastSave(editor.saves)).toBe(SMS_TSX.replace(", your code is ", ", your code")),
    );
    expect(probe!.undoHistory).toHaveLength(1);
    act(() => probe!.undo());
    await waitFor(() => expect(lastSave(editor.saves)).toBe(SMS_TSX));
  });

  it("sets and clears the category", async () => {
    const editor = markupEditor("sms");
    const view = render(
      <EditorProvider host={editor.host}>
        <SmsWorkspace />
      </EditorProvider>,
    );
    openSelect(await waitFor(() => view.getByTestId("sms-workspace.category")));
    await waitFor(() => expect(document.body.textContent).toContain("Promotional"));
    await chooseOption(
      await waitFor(() => view.getByTestId("sms-workspace.category-option.promotional")),
    );
    await waitFor(() => expect(editor.saves).toHaveLength(1));
    expect(lastSave(editor.saves)).toBe(
      SMS_TSX.replace('category="transactional"', 'category="promotional"'),
    );

    openSelect(view.getByTestId("sms-workspace.category"));
    await chooseOption(await waitFor(() => view.getByTestId("sms-workspace.category-option.none")));
    await waitFor(() => expect(editor.saves).toHaveLength(2));
    expect(lastSave(editor.saves)).toBe(SMS_TSX.replace(' category="transactional"', ""));
  });

  it("edits text in the message preview and keeps locked expressions out of reach", async () => {
    const editor = markupEditor("sms");
    const view = render(
      <EditorProvider host={editor.host}>
        <SmsWorkspace />
      </EditorProvider>,
    );
    const segment = await waitFor(() => view.getByTestId("sms-workspace.preview-segment.1"));
    expect(view.getAllByTestId("sms-workspace.locked-segment").length).toBeGreaterThan(0);

    segment.textContent = "Hello ";
    fireEvent.input(segment);

    await waitFor(() => expect(editor.saves).toHaveLength(1));
    expect(lastSave(editor.saves)).toBe(
      SMS_TSX.replace("      Hi {input.name}", "      Hello {input.name}"),
    );
  });

  it("says a body it cannot read is edited in Source", async () => {
    const source = SMS_TSX.replace("sms: (input) => (", "sms: (input) => input.body ||\n    (");
    const view = render(
      <EditorProvider host={markupEditor("sms", source).host}>
        <SmsWorkspace />
      </EditorProvider>,
    );
    await waitFor(() => expect(view.baseElement.textContent).toContain("edited in Source"));
  });
});

describe("WhatsApp workspace", () => {
  it("shows the parts, buttons and fields of the authored TSX", async () => {
    const view = render(
      <EditorProvider host={markupEditor("whatsapp").host}>
        <WhatsAppWorkspace />
      </EditorProvider>,
    );

    const name = await waitFor(() => view.getByTestId("whatsapp-workspace.name"));
    expect(value(name)).toBe("order_update");
    expect(value(view.getByTestId("whatsapp-workspace.body.1"))).toBe("Hi ");
    expect(value(view.getByLabelText("Button 1 label"))).toBe("Track order");
    expect(value(view.getByLabelText("Button 1 URL"))).toBe("https://example.com/track");
    expect(value(view.getByLabelText("Button 2 label"))).toBe("Stop");
    await waitFor(() => expect(view.getAllByText("Track order").length).toBeGreaterThan(0));
  });

  it("edits a body segment as an exact replacement", async () => {
    const editor = markupEditor("whatsapp");
    const view = render(
      <EditorProvider host={editor.host}>
        <WhatsAppWorkspace />
      </EditorProvider>,
    );
    const body = await waitFor(() => view.getByTestId("whatsapp-workspace.body.3"));

    fireEvent.change(body, { target: { value: ", your parcel shipped." } });

    await waitFor(() => expect(editor.saves).toHaveLength(1));
    expect(lastSave(editor.saves)).toBe(
      WHATSAPP_TSX.replace(", your order shipped.", ", your parcel shipped."),
    );
  });

  it("adds and removes a button", async () => {
    const editor = markupEditor("whatsapp");
    const view = render(
      <EditorProvider host={editor.host}>
        <WhatsAppWorkspace />
      </EditorProvider>,
    );
    fireEvent.click(await waitFor(() => view.getByTestId("whatsapp-workspace.add-button")));

    await waitFor(() => expect(editor.saves).toHaveLength(1));
    expect(lastSave(editor.saves)).toContain(
      "<WhatsApp.QuickReplyButton>Stop</WhatsApp.QuickReplyButton>\n        <WhatsApp.QuickReplyButton>Reply</WhatsApp.QuickReplyButton>",
    );
    await waitFor(() => expect(view.getByLabelText("Button 3 label")).toBeTruthy());

    fireEvent.click(view.getByLabelText("Remove button 3"));
    await waitFor(() => expect(editor.saves).toHaveLength(2));
    expect(lastSave(editor.saves)).toBe(WHATSAPP_TSX);
  });

  it("edits the text of a header that also reads the input", async () => {
    const editor = markupEditor("whatsapp");
    const view = render(
      <EditorProvider host={editor.host}>
        <WhatsAppWorkspace />
      </EditorProvider>,
    );
    // The header reads "Order {input.orderId}": clearing its text leaves the expression.
    const header = await waitFor(() => view.getByTestId("whatsapp-workspace.slot.header"));
    fireEvent.change(header, { target: { value: "Ref " } });
    await waitFor(() => expect(editor.saves).toHaveLength(1));
    expect(lastSave(editor.saves)).toBe(
      WHATSAPP_TSX.replace("<WhatsApp.Header>Order ", "<WhatsApp.Header>Ref "),
    );
  });

  it("refuses an edit that leaves the static profile and says why", async () => {
    const source = WHATSAPP_TSX.replace(
      "<WhatsApp.Body>Hi {input.name}, your order shipped.</WhatsApp.Body>",
      "<WhatsApp.Body>Hello</WhatsApp.Body>",
    );
    const editor = markupEditor("whatsapp", source);
    const view = render(
      <EditorProvider host={editor.host}>
        <WhatsAppWorkspace />
      </EditorProvider>,
    );
    const body = await waitFor(() => view.getByTestId("whatsapp-workspace.body.1"));
    fireEvent.change(body, { target: { value: "" } });

    await waitFor(() => expect(view.getByTestId("channel-workspace.edit-refusal")).toBeTruthy());
    expect(view.getByTestId("channel-workspace.edit-refusal").textContent).toContain("body");
    expect(editor.saves).toHaveLength(0);
    expect(value(body)).toBe("Hello");
  });
});
