/**
 * @vitest-environment happy-dom
 * @jsxImportSource react
 */
import { afterEach, describe, expect, it, vi } from "@effect/vitest";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";

import type { EditorBrandSource } from "../src/chrome/brand-chip";
import { EditorShell } from "../src/chrome/shell";
import type { EditorBrand, EditorProjectTheme } from "../src/chrome/theme-brand";
import type { AsyncEditorHost, AsyncLifecycleApi } from "../src/host/types";
import {
  contractVersion,
  type DocumentChange,
  type EditableEditorDocument,
  type ProjectLifecycleState,
} from "../src/host/types";
import { EditorProvider } from "../src/state/provider";
import { withVersions } from "./mock-host";

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const acme: EditorBrand = { slug: "acme", name: "Acme", isDefault: true };
const holiday: EditorBrand = { slug: "holiday", name: "Holiday", isDefault: false };
const OVERRIDES = "@theme {\n  --color-brand: #4f46e5;\n}\n";

const document: EditableEditorDocument = {
  id: "tmpl_brand",
  name: "Welcome",
  rev: "rev_1",
  origin: { kind: "tsx", file: "emails/welcome.tsx", authoredSource: "export default null" },
  access: { kind: "editable" },
  variables: [],
  metadata: {},
  channel: "email",
  preview: { status: "current" },
  fixtures: ["welcome"],
  fixture: "welcome",
  render: {
    revision: "rev_1",
    subject: "Welcome",
    html: '<body data-samva-instance="0"><p data-samva-instance="0.0">Welcome</p></body>',
    text: "Welcome",
    selections: [],
  },
  diagnostics: [],
  incompatibilities: [],
};

const externalChange = (rev: string): DocumentChange => ({
  rev,
  origin: "external",
  channel: "email",
  preview: { status: "current" },
  fixtures: document.fixtures,
  fixture: document.fixture,
  render: { ...document.render!, revision: rev },
  diagnostics: [],
  incompatibilities: [],
});

const lifecycleState = (rev: string): ProjectLifecycleState => ({
  rev,
  baseCommit: "a".repeat(40),
  remoteHead: "a".repeat(40),
  dirty: true,
  files: [],
  conflicts: [],
  commits: [],
});

const unarranged = (name: keyof AsyncLifecycleApi) => (): never => {
  throw new Error(`Unarranged AsyncLifecycleApi.${name}`);
};

/**
 * A project draft the host holds: `theme.css` and `starter.css`. `updateFile`
 * writes the draft and publishes the next revision on the change stream, as the
 * dashboard host does.
 */
const arrangeProject = (initialTheme: string | null) => {
  const files: Record<string, string> = { "starter.css": "@theme {}" };
  if (initialTheme !== null) files["theme.css"] = initialTheme;
  let publish: (change: DocumentChange) => void = () => {};
  let revision = 1;
  const updateFile = vi.fn(
    async (input: { path: string; baseRev: string; content: string | null }) => {
      if (input.content === null) delete files[input.path];
      else files[input.path] = input.content;
      revision += 1;
      publish(externalChange(`rev_${revision}`));
      return lifecycleState(`rev_${revision}`);
    },
  );
  const host: AsyncEditorHost = {
    contractVersion,
    access: "editable",
    sourceAccess: "editable",
    document: {
      open: async (onChange) => {
        publish = onChange;
        return { initial: document, close: () => {} };
      },
    },
    writer: { save: () => Promise.resolve({ rev: document.rev }) },
    lifecycle: {
      status: "ready",
      api: {
        inspect: unarranged("inspect"),
        publish: unarranged("publish"),
        restore: unarranged("restore"),
        resolveConflict: unarranged("resolveConflict"),
        updateFile,
        putAsset: unarranged("putAsset"),
      },
    },
  };
  const readTheme = async (): Promise<EditorProjectTheme> => ({
    theme: files["theme.css"] ?? null,
    starter: "starter.css" in files,
  });
  return { host, files, updateFile, readTheme };
};

const stubWideShell = () => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    width: 1440,
    height: 900,
    top: 0,
    right: 1440,
    bottom: 900,
    left: 0,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
};

const brandSource = (
  readTheme: () => Promise<EditorProjectTheme>,
  brands: ReadonlyArray<EditorBrand> | null,
  navigate = vi.fn(),
): EditorBrandSource => ({
  readTheme,
  brands,
  manageLink: () => ({ href: "/dashboard/acme-org/templates/brands", navigate }),
});

const openMenu = async (view: ReturnType<typeof render>, trigger: string) => {
  fireEvent.click(await view.findByTestId(trigger));
  return view.findByTestId("topbar.brand-menu");
};

describe("topbar brand chip", () => {
  it("names the imported brand and marks it in the menu without editing it", async () => {
    stubWideShell();
    const project = arrangeProject(`@import "./starter.css";\n@import 'samva:brand/holiday';\n`);
    const view = render(
      <EditorProvider host={withVersions(project.host, async (revision) => revision)}>
        <EditorShell brand={brandSource(project.readTheme, [acme, holiday])} />
      </EditorProvider>,
    );

    const chip = await view.findByTestId("topbar.brand");
    expect(chip.textContent).toBe("Holiday");
    const menu = await openMenu(view, "topbar.brand");
    expect(
      menu
        .querySelector('[data-testid="topbar.brand-option.holiday"]')
        ?.getAttribute("aria-current"),
    ).toBe("true");
    expect(
      menu.querySelector('[data-testid="topbar.brand-option.acme"]')?.getAttribute("aria-current"),
    ).toBeNull();
    expect(view.queryByTestId("topbar.brand-use")).toBeNull();
    expect(project.updateFile).not.toHaveBeenCalled();
  });

  it("links Manage brands to the host's page", async () => {
    stubWideShell();
    const project = arrangeProject(`@import "samva:brand";\n${OVERRIDES}`);
    const navigate = vi.fn();
    const view = render(
      <EditorProvider host={project.host}>
        <EditorShell brand={brandSource(project.readTheme, [acme, holiday], navigate)} />
      </EditorProvider>,
    );

    await openMenu(view, "topbar.brand");
    const manage = view.getByTestId("topbar.brand-manage");
    expect(manage.getAttribute("href")).toBe("/dashboard/acme-org/templates/brands");
    fireEvent.click(manage);
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it("resolves bare samva:brand to the organization's default brand", async () => {
    stubWideShell();
    const project = arrangeProject(`@import "samva:brand";\n${OVERRIDES}`);
    const view = render(
      <EditorProvider host={project.host}>
        <EditorShell brand={brandSource(project.readTheme, [holiday, acme])} />
      </EditorProvider>,
    );

    expect((await view.findByTestId("topbar.brand")).textContent).toBe("Acme");
  });

  it("switches to another brand by rewriting the import and saving a version", async () => {
    stubWideShell();
    const project = arrangeProject(
      `@import "./starter.css";\n@import "samva:brand";\n${OVERRIDES}`,
    );
    const saveVersion = vi.fn(async (revision: string) => `${revision}_saved`);
    const view = render(
      <EditorProvider host={withVersions(project.host, saveVersion)}>
        <EditorShell brand={brandSource(project.readTheme, [acme, holiday])} />
      </EditorProvider>,
    );

    await openMenu(view, "topbar.brand");
    await act(async () => {
      fireEvent.click(view.getByTestId("topbar.brand-option.holiday"));
    });

    await waitFor(() => expect(saveVersion).toHaveBeenCalledWith("rev_2"));
    expect(project.updateFile).toHaveBeenCalledWith({
      path: "theme.css",
      baseRev: "rev_1",
      content: `@import "./starter.css";\n@import "samva:brand/holiday";\n${OVERRIDES}`,
    });
    expect((await view.findByTestId("topbar.brand")).textContent).toBe("Holiday");
  });

  it("layers the default brand into the theme and saves a version from the menu", async () => {
    stubWideShell();
    const project = arrangeProject(OVERRIDES);
    const saveVersion = vi.fn(async (revision: string) => `${revision}_saved`);
    const view = render(
      <EditorProvider host={withVersions(project.host, saveVersion)}>
        <EditorShell brand={brandSource(project.readTheme, [holiday, acme])} />
      </EditorProvider>,
    );

    expect((await view.findByTestId("topbar.brand-none")).textContent).toBe("No brand");
    await openMenu(view, "topbar.brand-none");
    const use = view.getByTestId("topbar.brand-use");
    expect(use.textContent).toContain("Use Acme");
    // The default leads the menu, so it is not listed a second time.
    expect(view.queryByTestId("topbar.brand-option.acme")).toBeNull();
    await act(async () => {
      fireEvent.click(use);
    });

    await waitFor(() => expect(saveVersion).toHaveBeenCalledWith("rev_2"));
    expect(project.updateFile).toHaveBeenCalledTimes(1);
    expect(project.updateFile).toHaveBeenCalledWith({
      path: "theme.css",
      baseRev: "rev_1",
      content: `@import "./starter.css";\n@import "samva:brand";\n\n${OVERRIDES}`,
    });
    expect((await view.findByTestId("topbar.brand")).textContent).toBe("Acme");
    expect(view.queryByTestId("topbar.brand-none")).toBeNull();
  });

  it("creates the theme when the project has none", async () => {
    stubWideShell();
    const project = arrangeProject(null);
    const view = render(
      <EditorProvider host={withVersions(project.host, async (revision) => revision)}>
        <EditorShell brand={brandSource(project.readTheme, [acme])} />
      </EditorProvider>,
    );

    await openMenu(view, "topbar.brand-none");
    await act(async () => {
      fireEvent.click(view.getByTestId("topbar.brand-use"));
    });

    await waitFor(() =>
      expect(project.files["theme.css"]).toBe('@import "./starter.css";\n@import "samva:brand";\n'),
    );
  });

  it("holds the chip's place while the theme loads, then names the brand", async () => {
    stubWideShell();
    const project = arrangeProject(`@import 'samva:brand/holiday';\n`);
    let releaseTheme = () => {};
    const theme = new Promise<void>((resolve) => {
      releaseTheme = resolve;
    });
    const view = render(
      <EditorProvider host={withVersions(project.host, async (revision) => revision)}>
        <EditorShell brand={brandSource(() => theme.then(project.readTheme), [acme, holiday])} />
      </EditorProvider>,
    );

    const pending = await view.findByTestId("topbar.brand-pending");
    expect(pending.getAttribute("aria-busy")).toBe("true");
    expect(view.queryByTestId("topbar.brand")).toBeNull();

    releaseTheme();
    expect((await view.findByTestId("topbar.brand")).textContent).toBe("Holiday");
    expect(view.queryByTestId("topbar.brand-pending")).toBeNull();
  });

  it("offers the default brand only once the organization's brands load", async () => {
    stubWideShell();
    const project = arrangeProject(OVERRIDES);
    const view = render(
      <EditorProvider host={withVersions(project.host, async (revision) => revision)}>
        <EditorShell brand={brandSource(project.readTheme, null)} />
      </EditorProvider>,
    );

    await openMenu(view, "topbar.brand-none");
    expect(view.queryByTestId("topbar.brand-use")).toBeNull();
    expect(view.getByTestId("topbar.brand-manage")).toBeTruthy();
  });

  it("disables the choices without a save path", async () => {
    stubWideShell();
    const project = arrangeProject(OVERRIDES);
    const view = render(
      <EditorProvider host={project.host}>
        <EditorShell brand={brandSource(project.readTheme, [acme])} />
      </EditorProvider>,
    );

    await openMenu(view, "topbar.brand-none");
    expect(view.getByTestId("topbar.brand-use").getAttribute("aria-disabled")).toBe("true");
    expect(project.updateFile).not.toHaveBeenCalled();
  });
});
