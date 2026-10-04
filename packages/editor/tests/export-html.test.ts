/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from "@effect/vitest";
import { INSTANCE_PATH_ATTRIBUTE } from "@samva/markup/render";

import { downloadEmailHtml, emailHtmlForExport } from "../src/chrome/export-html";

afterEach(() => vi.restoreAllMocks());

const RENDERED =
  '<!doctype html><html><head><meta charset="utf-8"></head>' +
  `<body ${INSTANCE_PATH_ATTRIBUTE}="0" class="bg-white">` +
  `<a ${INSTANCE_PATH_ATTRIBUTE}="0.0" href="https://nimbus.example/claim" data-track="cta">Claim</a>` +
  `<img ${INSTANCE_PATH_ATTRIBUTE}="0.1" src="https://cdn.example.com/logo.png" alt="Nimbus">` +
  "</body></html>";

describe("emailHtmlForExport", () => {
  it("strips the preview-only instance attribute and nothing else", () => {
    const exported = emailHtmlForExport(RENDERED);

    expect(exported).not.toContain(INSTANCE_PATH_ATTRIBUTE);
    expect(exported).toContain('<body class="bg-white">');
    expect(exported).toContain('href="https://nimbus.example/claim"');
    expect(exported).toContain('data-track="cta"');
    expect(exported).toContain('alt="Nimbus"');
    expect(exported).toContain("<!doctype html>");
  });

  it("leaves a document the host rendered without the attribute untouched", () => {
    const plain = "<!doctype html><html><body><p>Hello</p></body></html>";
    expect(emailHtmlForExport(plain)).toBe(plain);
  });
});

describe("downloadEmailHtml", () => {
  it("downloads the stripped document under a slugified template name", async () => {
    const created: HTMLAnchorElement[] = [];
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const element = realCreate(tag);
      if (tag === "a") created.push(element as HTMLAnchorElement);
      return element;
    });
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:mock");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    downloadEmailHtml(RENDERED, "Welcome — first bag");

    expect(click).toHaveBeenCalledTimes(1);
    expect(created).toHaveLength(1);
    expect(created[0]!.download).toBe("welcome-first-bag.html");
    // The anchor is removed and the object URL released, so nothing leaks.
    expect(created[0]!.isConnected).toBe(false);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock");

    const blob = createObjectURL.mock.calls[0]?.[0];
    expect(blob).toBeInstanceOf(Blob);
    expect(await (blob as Blob).text()).toBe(emailHtmlForExport(RENDERED));
  });

  it("falls back to a usable filename when the name has nothing to slugify", () => {
    const created: HTMLAnchorElement[] = [];
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const element = realCreate(tag);
      if (tag === "a") created.push(element as HTMLAnchorElement);
      return element;
    });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:mock");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    downloadEmailHtml(RENDERED, "———");
    expect(created[0]!.download).toBe("email.html");
  });
});
