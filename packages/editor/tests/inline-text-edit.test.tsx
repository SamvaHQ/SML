/**
 * @vitest-environment happy-dom
 * @jsxImportSource react
 */
import { afterEach, describe, expect, it, vi } from "@effect/vitest";
import { INSTANCE_PATH_ATTRIBUTE } from "@samva/markup/edit";
import { cleanup, fireEvent, render } from "@testing-library/react";

import { EmailFrame } from "../src/canvas/email-frame";

afterEach(cleanup);

const HTML =
  "<!doctype html><html><body>" +
  `<p ${INSTANCE_PATH_ATTRIBUTE}="0">Hello there</p>` +
  `<p ${INSTANCE_PATH_ATTRIBUTE}="1">Hello <b ${INSTANCE_PATH_ATTRIBUTE}="1.0">bold</b></p>` +
  "</body></html>";

const mount = (canEditText: (path: string) => boolean) => {
  const onEditText = vi.fn();
  const view = render(
    <EmailFrame html={HTML} width={600} canEditText={canEditText} onEditText={onEditText} />,
  );
  const doc = view.container.querySelector("iframe")!.contentDocument!;
  return { doc, onEditText };
};

const paragraph = (doc: Document, path: string) =>
  doc.querySelector<HTMLElement>(`[${INSTANCE_PATH_ATTRIBUTE}="${path}"]`)!;

describe("editing text in place", () => {
  it("reports the typed text when the author presses Enter", () => {
    const { doc, onEditText } = mount(() => true);
    const element = paragraph(doc, "0");
    fireEvent.doubleClick(element);
    expect(element.getAttribute("contenteditable")).toBe("plaintext-only");
    element.textContent = "Hello again";
    fireEvent.keyDown(element, { key: "Enter" });
    expect(element.hasAttribute("contenteditable")).toBe(false);
    expect(onEditText).toHaveBeenCalledWith("0", "Hello again");
  });

  it("restores the text on Escape and reports nothing", () => {
    const { doc, onEditText } = mount(() => true);
    const element = paragraph(doc, "0");
    fireEvent.doubleClick(element);
    element.textContent = "Changed";
    fireEvent.keyDown(element, { key: "Escape" });
    expect(element.textContent).toBe("Hello there");
    expect(onEditText).not.toHaveBeenCalled();
  });

  it("does not report text that did not change", () => {
    const { doc, onEditText } = mount(() => true);
    const element = paragraph(doc, "0");
    fireEvent.doubleClick(element);
    fireEvent.keyDown(element, { key: "Enter" });
    expect(onEditText).not.toHaveBeenCalled();
  });

  it("leaves an element that is not offered, or that holds inline markup, alone", () => {
    const refused = mount(() => false);
    fireEvent.doubleClick(paragraph(refused.doc, "0"));
    expect(paragraph(refused.doc, "0").hasAttribute("contenteditable")).toBe(false);

    const mixed = mount(() => true);
    fireEvent.doubleClick(paragraph(mixed.doc, "1"));
    expect(paragraph(mixed.doc, "1").hasAttribute("contenteditable")).toBe(false);
  });
});
