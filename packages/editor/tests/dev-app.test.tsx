/**
 * @vitest-environment happy-dom
 * @jsxImportSource react
 */
import { afterEach, describe, expect, it } from "@effect/vitest";
import { INSTANCE_PATH_ATTRIBUTE } from "@samva/markup/render";
import { cleanup, render, waitFor } from "@testing-library/react";

import { App } from "../dev/App";

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
    view.getByTestId("topbar.preview");
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
