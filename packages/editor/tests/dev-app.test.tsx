/**
 * @vitest-environment happy-dom
 * @jsxImportSource react
 */
import { afterEach, describe, expect, it } from "@effect/vitest";
import { INSTANCE_PATH_ATTRIBUTE } from "@samva/markup/edit";
import { cleanup, render, waitFor } from "@testing-library/react";

import { App } from "../dev/App";
import { createIssueHost } from "../dev/issue-host";

afterEach(cleanup);

const canvasDocument = (container: HTMLElement): Document => {
  const iframe = container.querySelector("iframe");
  const canvas = iframe?.contentDocument ?? null;
  if (canvas === null) {
    throw new Error("dev harness canvas has no iframe document");
  }
  return canvas;
};

// Render smoke for the dev harness: HTTP 200 says nothing about a client-rendered
// app. Mounting <App/> proves the boot path (mock host -> open() through the
// provider) actually paints the shell AND the executed render, rather than hanging.
describe("dev harness App", () => {
  it("boots the shell and mounts the render the host executed", async () => {
    const view = render(<App />);

    await waitFor(() => expect(view.queryByTestId("dev-app.booting")).toBeNull());
    await waitFor(() =>
      expect(
        canvasDocument(view.container).querySelector(`[${INSTANCE_PATH_ATTRIBUTE}="0"]`),
      ).not.toBeNull(),
    );

    // Shell chrome mounted; the local mock intentionally has no persisted lifecycle.
    view.getByTestId("topbar.name");
    expect(view.queryByTestId("topbar.publish")).toBeNull();
  });

  it("exposes the harness probe the browser suite drives its contracts through", async () => {
    const view = render(<App />);

    await waitFor(() =>
      expect(view.container.querySelector("[data-editor-rendered]")?.textContent).toBe("true"),
    );
    expect(view.container.querySelector("[data-editor-fixture]")?.textContent).toBe("welcome");
    expect(view.container.querySelector("[data-editor-authored-source]")?.textContent).toContain(
      "export default function WelcomeEmail",
    );
    // Nothing is selected until a click resolves one rendered instance.
    expect(view.container.querySelector("[data-editor-selected-instance-path]")?.textContent).toBe(
      "",
    );
  });
});

describe("compiled Markdown issue host", () => {
  it("opens Markdown and saves full source without changing its layout", async () => {
    const { host, source } = await createIssueHost();
    if (host.lifecycle?.status !== "ready") throw new Error("expected issue lifecycle");
    const changes: import("@samva/editor/host").DocumentChange[] = [];
    const opened = await host.document.open((change) => changes.push(change));
    expect(opened.initial.origin).toMatchObject({
      kind: "markdown",
      file: "issues/launch.md",
      layout: { file: "layout.tsx" },
    });
    expect(opened.initial.origin.authoredSource).toBe(source.read());
    if (opened.initial.channel !== "email") throw new Error("expected email issue");
    expect(
      opened.initial.incompatibilities.some(
        (diagnostic) => diagnostic.compatibility?.assessment === "degradation",
      ),
    ).toBe(true);
    const originalProject = await host.lifecycle!.api.inspect();
    const layout = originalProject.files.find((file) => file.path === "layout.tsx")?.content;
    const notifications: string[] = [];
    const unsubscribe = source.subscribe(() => notifications.push(source.read()));
    const next = source
      .read()
      .replace("title: Launch notes", "title: Fresh news")
      .replace("Cold brew subscriptions", "Gift subscriptions");
    expect(
      await host.writer.save({ kind: "authoredSource", baseRev: "rev_1", authoredSource: next }),
    ).toEqual({ rev: "rev_2" });
    expect(source.read()).toBe(next);
    expect(notifications).toEqual([next]);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      origin: "self",
      authoredSource: next,
      rev: "rev_2",
      render: { subject: "Fresh news" },
    });
    const project = await host.lifecycle!.api.inspect();
    expect(project.files.find((file) => file.path === "layout.tsx")?.content).toBe(layout);
    for (const target of ["email", "web"] as const) {
      const rendered = await host.render!("issues/launch.md", "reader", target);
      expect(rendered?.revision).toBe("rev_2");
      expect(rendered?.html).toContain("Gift subscriptions");
      expect(
        rendered?.selections.some(
          (selection) => selection.origins[0]?.fileName === "issues/launch.md",
        ),
      ).toBe(true);
    }
    expect(await host.render!("layout.tsx", "reader", "web")).toBeNull();
    await expect(
      host.writer.save({ kind: "authoredSource", baseRev: "rev_1", authoredSource: "stale" }),
    ).rejects.toMatchObject({ expectedRev: "rev_1", actualRev: "rev_2" });
    expect(source.read()).toBe(next);
    unsubscribe();
    opened.close();
  });

  it("allows exactly one concurrent save for one base revision", async () => {
    const { host, source } = await createIssueHost();
    if (host.lifecycle?.status !== "ready") throw new Error("expected issue lifecycle");
    const first = source.read().replace("Launch notes", "First save");
    const results = await Promise.allSettled([
      host.writer.save({ kind: "authoredSource", baseRev: "rev_1", authoredSource: first }),
      host.writer.save({
        kind: "authoredSource",
        baseRev: "rev_1",
        authoredSource: source.read().replace("Launch notes", "Stale save"),
      }),
    ]);
    expect(results[0]).toMatchObject({ status: "fulfilled", value: { rev: "rev_2" } });
    expect(results[1]).toMatchObject({
      status: "rejected",
      reason: { expectedRev: "rev_1", actualRev: "rev_2" },
    });
    expect(source.read()).toBe(first);
  });

  it("emits lifecycle writes with the current issue source and exposes failed builds", async () => {
    const { host, source } = await createIssueHost();
    if (host.lifecycle?.status !== "ready") throw new Error("expected issue lifecycle");
    const changes: import("@samva/editor/host").DocumentChange[] = [];
    const opened = await host.document.open((change) => changes.push(change));
    const next = source.read().replace("Gift bundles", "Coffee bundles");
    await host.lifecycle!.api.updateFile({
      path: "issues/launch.md",
      baseRev: "rev_1",
      content: next,
    });
    expect(changes[0]).toMatchObject({ origin: "external", authoredSource: next });
    await host.writer.save({
      kind: "authoredSource",
      baseRev: "rev_2",
      authoredSource: "---\ntitle: Missing slug\n---\n",
    });
    expect(changes[1]).toMatchObject({
      authoredSource: source.read(),
      render: null,
      fixtures: [],
      fixture: null,
    });
    expect(changes[1]?.diagnostics.some((diagnostic) => diagnostic.severity === "error")).toBe(
      true,
    );
    expect(await host.render!("issues/launch.md", "reader", "web")).toBeNull();
    opened.close();
  });
});
