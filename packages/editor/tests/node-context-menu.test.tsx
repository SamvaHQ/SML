// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "@effect/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";

import { NodeContextMenu, type AncestorEntry } from "../src/chrome/node-context-menu";

afterEach(cleanup);

/** Innermost first: the clicked row, then each element enclosing it. */
const ANCESTORS: ReadonlyArray<AncestorEntry> = [
  { instancePath: "0.0.3.0", label: "a", generated: false },
  { instancePath: "0.0.3", label: "table", generated: true },
  { instancePath: "0.0", label: "div", generated: false },
  { instancePath: "0", label: "body", generated: true },
];

function Harness({ onSelect }: { onSelect: (instancePath: string) => void }) {
  const portal = useRef<HTMLDivElement>(null);
  return (
    <>
      <NodeContextMenu ancestors={ANCESTORS} portalContainer={portal} onSelect={onSelect}>
        <button type="button" data-testid="context-menu.trigger">
          Rendered element
        </button>
      </NodeContextMenu>
      <div ref={portal} data-testid="editor-portal" />
    </>
  );
}

describe("NodeContextMenu", () => {
  it("portals the ancestor walk into the editor container, innermost first", async () => {
    render(<Harness onSelect={() => {}} />);
    fireEvent.contextMenu(screen.getByTestId("context-menu.trigger"), { clientX: 20, clientY: 30 });

    const menu = await screen.findByTestId("node-context-menu.popup");
    expect(screen.getByTestId("editor-portal").contains(menu)).toBe(true);
    expect(menu.getAttribute("aria-label")).toBe("Select element");

    const items = [...menu.querySelectorAll("[data-testid^='node-context-menu.item.']")];
    expect(items.map((item) => item.getAttribute("data-testid"))).toStrictEqual([
      "node-context-menu.item.0.0.3.0",
      "node-context-menu.item.0.0.3",
      "node-context-menu.item.0.0",
      "node-context-menu.item.0",
    ]);
  });

  it("marks the compiler-generated steps so no one reads them as authored markup", async () => {
    render(<Harness onSelect={() => {}} />);
    fireEvent.contextMenu(screen.getByTestId("context-menu.trigger"));

    const generated = await screen.findByTestId("node-context-menu.item.0.0.3");
    expect(generated.textContent).toContain("generated");
    expect(screen.getByTestId("node-context-menu.item.0.0").textContent).not.toContain("generated");
  });

  it("selects the walked-to element rather than the one that was clicked", async () => {
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);
    fireEvent.contextMenu(screen.getByTestId("context-menu.trigger"));

    fireEvent.click(await screen.findByTestId("node-context-menu.item.0.0"));
    expect(onSelect).toHaveBeenCalledWith("0.0");
  });
});
