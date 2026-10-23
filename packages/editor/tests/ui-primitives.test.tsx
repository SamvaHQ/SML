/** @vitest-environment happy-dom
 * @jsxImportSource react */
import { afterEach, describe, expect, it } from "@effect/vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { useState, type ReactNode } from "react";

import { EditorPortalProvider } from "../src/chrome/portal-context";
import { cn } from "../src/lib/utils";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../src/ui/alert-dialog";
import { Badge } from "../src/ui/badge";
import { Button, buttonVariants } from "../src/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../src/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "../src/ui/dropdown-menu";
import { Input } from "../src/ui/input";
import { Kbd, KbdGroup } from "../src/ui/kbd";
import { NativeSelect, NativeSelectOptGroup, NativeSelectOption } from "../src/ui/native-select";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "../src/ui/popover";
import { ScrollArea, ScrollBar } from "../src/ui/scroll-area";
import { Separator } from "../src/ui/separator";
import { Switch } from "../src/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../src/ui/tabs";
import { Toggle } from "../src/ui/toggle";
import { ToggleGroup, ToggleGroupItem } from "../src/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../src/ui/tooltip";

afterEach(cleanup);

const PORTAL_ID = "ui-primitives.portal";

// The shell publishes the portal element once it has mounted, not a ref. Base UI 1.9
// reads a ref during layout, before React attaches this later sibling.
function Portaled({ children }: { readonly children: ReactNode }) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  return (
    <EditorPortalProvider container={container}>
      {children}
      <div ref={setContainer} data-testid={PORTAL_ID} />
    </EditorPortalProvider>
  );
}

const slot = (root: ParentNode, name: string) => root.querySelector(`[data-slot="${name}"]`);

describe("cn", () => {
  it("lets the last conflicting utility win", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
    expect(cn("px-2", false, undefined, ["py-1"])).toBe("px-2 py-1");
  });
});

describe("Button", () => {
  it("carries its slot and the recipe", () => {
    const view = render(<Button>Save</Button>);
    const button = slot(view.container, "button");

    expect(button?.tagName).toBe("BUTTON");
    expect(button?.classList.contains("h-8")).toBe(true);
    expect(button?.classList.contains("bg-primary")).toBe(true);
  });

  it("lets a caller override a recipe utility", () => {
    const view = render(<Button className="h-10">Save</Button>);
    const button = slot(view.container, "button");

    expect(button?.classList.contains("h-10")).toBe(true);
    expect(button?.classList.contains("h-8")).toBe(false);
  });

  it("applies variants and sizes", () => {
    const view = render(
      <Button variant="outline" size="icon-sm">
        x
      </Button>,
    );
    const button = slot(view.container, "button");

    expect(button?.classList.contains("size-7")).toBe(true);
    expect(button?.classList.contains("border-border")).toBe(true);
    expect(buttonVariants({ variant: "link" })).toContain("underline-offset-4");
  });

  it("swaps the element through render", () => {
    const view = render(<Button render={<a href="#x" />}>Go</Button>);
    const anchor = slot(view.container, "button");

    expect(anchor?.tagName).toBe("A");
    expect(anchor?.getAttribute("href")).toBe("#x");
  });
});

describe("Badge", () => {
  it("renders its slot and swaps the element through render", () => {
    const view = render(
      <>
        <Badge>New</Badge>
        <Badge variant="outline" render={<a href="#b" />}>
          Link
        </Badge>
      </>,
    );
    const badges = view.container.querySelectorAll('[data-slot="badge"]');

    expect(badges).toHaveLength(2);
    expect(badges[0]?.tagName).toBe("SPAN");
    expect(badges[1]?.tagName).toBe("A");
  });
});

describe("Kbd", () => {
  it("renders the key and its group", () => {
    const view = render(
      <KbdGroup className="gap-3">
        <Kbd>K</Kbd>
      </KbdGroup>,
    );

    expect(slot(view.container, "kbd-group")?.classList.contains("gap-3")).toBe(true);
    expect(slot(view.container, "kbd-group")?.classList.contains("gap-1")).toBe(false);
    expect(slot(view.container, "kbd")?.tagName).toBe("KBD");
  });
});

describe("Separator", () => {
  it("orients itself", () => {
    const view = render(<Separator orientation="vertical" />);
    const separator = slot(view.container, "separator");

    expect(separator?.getAttribute("data-orientation")).toBe("vertical");
  });
});

describe("Tabs", () => {
  it("renders the list, triggers and the active panel", () => {
    const view = render(
      <Tabs defaultValue="a">
        <TabsList variant="line">
          <TabsTrigger value="a">A</TabsTrigger>
          <TabsTrigger value="b">B</TabsTrigger>
        </TabsList>
        <TabsContent value="a">Panel A</TabsContent>
      </Tabs>,
    );

    expect(slot(view.container, "tabs")).not.toBeNull();
    expect(slot(view.container, "tabs-list")?.getAttribute("data-variant")).toBe("line");
    const triggers = view.container.querySelectorAll('[data-slot="tabs-trigger"]');
    expect(triggers).toHaveLength(2);
    expect(triggers[0]?.hasAttribute("data-active")).toBe(true);
    expect(slot(view.container, "tabs-content")).not.toBeNull();
  });
});

describe("Toggle", () => {
  it("renders pressed state and slot", () => {
    const view = render(<Toggle defaultPressed>B</Toggle>);
    const toggle = slot(view.container, "toggle");

    expect(toggle?.hasAttribute("data-pressed")).toBe(true);
  });

  it("groups items and shares the variant", () => {
    const view = render(
      <ToggleGroup variant="outline" defaultValue={["a"]}>
        <ToggleGroupItem value="a">A</ToggleGroupItem>
        <ToggleGroupItem value="b">B</ToggleGroupItem>
      </ToggleGroup>,
    );
    const items = view.container.querySelectorAll('[data-slot="toggle-group-item"]');

    expect(slot(view.container, "toggle-group")?.getAttribute("data-variant")).toBe("outline");
    expect(items).toHaveLength(2);
    expect(items[0]?.getAttribute("data-variant")).toBe("outline");
    expect(items[0]?.hasAttribute("data-pressed")).toBe(true);
  });
});

describe("Input and NativeSelect", () => {
  it("renders the input slot with a caller override", () => {
    const view = render(<Input className="h-10" />);
    const input = slot(view.container, "input");

    expect(input?.classList.contains("h-10")).toBe(true);
    expect(input?.classList.contains("h-8")).toBe(false);
  });

  it("renders the wrapper, select, icon and options", () => {
    const view = render(
      <NativeSelect size="sm">
        <NativeSelectOptGroup label="Group">
          <NativeSelectOption value="a">A</NativeSelectOption>
        </NativeSelectOptGroup>
      </NativeSelect>,
    );

    expect(slot(view.container, "native-select-wrapper")?.getAttribute("data-size")).toBe("sm");
    expect(slot(view.container, "native-select")?.tagName).toBe("SELECT");
    expect(slot(view.container, "native-select-icon")?.getAttribute("aria-hidden")).toBe("true");
    expect(slot(view.container, "native-select-optgroup")).not.toBeNull();
    expect(slot(view.container, "native-select-option")).not.toBeNull();
  });
});

describe("Switch", () => {
  it("renders its root and thumb", () => {
    const view = render(<Switch defaultChecked />);

    expect(slot(view.container, "switch")?.hasAttribute("data-checked")).toBe(true);
    expect(slot(view.container, "switch-thumb")).not.toBeNull();
  });
});

describe("ScrollArea", () => {
  it("renders the viewport and a scrollbar slot", () => {
    const view = render(
      <ScrollArea className="h-10">
        <p>content</p>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>,
    );

    expect(slot(view.container, "scroll-area")?.classList.contains("h-10")).toBe(true);
    expect(slot(view.container, "scroll-area-viewport")).not.toBeNull();
  });
});

describe("popups render into the editor portal container", () => {
  it("Tooltip", async () => {
    const view = render(
      <Portaled>
        <TooltipProvider>
          <Tooltip open>
            <TooltipTrigger render={<button type="button" />}>t</TooltipTrigger>
            <TooltipContent side="bottom">Hint</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </Portaled>,
    );
    const portal = view.getByTestId(PORTAL_ID);

    await waitFor(() => expect(slot(portal, "tooltip-content")).not.toBeNull());
    expect(slot(view.container, "tooltip-trigger")).not.toBeNull();
  });

  it("Popover", async () => {
    const view = render(
      <Portaled>
        <Popover open>
          <PopoverTrigger>p</PopoverTrigger>
          <PopoverContent>
            <PopoverHeader>
              <PopoverTitle>Title</PopoverTitle>
              <PopoverDescription>Body</PopoverDescription>
            </PopoverHeader>
          </PopoverContent>
        </Popover>
      </Portaled>,
    );
    const portal = view.getByTestId(PORTAL_ID);

    await waitFor(() => expect(slot(portal, "popover-content")).not.toBeNull());
    for (const name of ["popover-header", "popover-title", "popover-description"]) {
      expect(slot(portal, name)).not.toBeNull();
    }
  });

  it("DropdownMenu", async () => {
    const view = render(
      <Portaled>
        <DropdownMenu open>
          <DropdownMenuTrigger>m</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuGroup>
              <DropdownMenuLabel>Label</DropdownMenuLabel>
              <DropdownMenuItem variant="destructive">
                Delete
                <DropdownMenuShortcut>D</DropdownMenuShortcut>
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem checked>Check</DropdownMenuCheckboxItem>
            <DropdownMenuRadioGroup value="a">
              <DropdownMenuRadioItem value="a">Radio</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </Portaled>,
    );
    const portal = view.getByTestId(PORTAL_ID);

    await waitFor(() => expect(slot(portal, "dropdown-menu-content")).not.toBeNull());
    for (const name of [
      "dropdown-menu-group",
      "dropdown-menu-label",
      "dropdown-menu-item",
      "dropdown-menu-shortcut",
      "dropdown-menu-separator",
      "dropdown-menu-checkbox-item",
      "dropdown-menu-checkbox-item-indicator",
      "dropdown-menu-radio-group",
      "dropdown-menu-radio-item",
      "dropdown-menu-radio-item-indicator",
    ]) {
      expect(slot(portal, name), name).not.toBeNull();
    }
    expect(slot(portal, "dropdown-menu-item")?.getAttribute("data-variant")).toBe("destructive");
  });

  it("Dialog", async () => {
    const view = render(
      <Portaled>
        <Dialog open>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Title</DialogTitle>
              <DialogDescription>Body</DialogDescription>
            </DialogHeader>
            <DialogFooter showCloseButton />
          </DialogContent>
        </Dialog>
      </Portaled>,
    );
    const portal = view.getByTestId(PORTAL_ID);

    await waitFor(() => expect(slot(portal, "dialog-content")).not.toBeNull());
    for (const name of [
      "dialog-overlay",
      "dialog-header",
      "dialog-title",
      "dialog-description",
      "dialog-footer",
      "dialog-close",
    ]) {
      expect(slot(portal, name), name).not.toBeNull();
    }
  });

  it("AlertDialog", async () => {
    const view = render(
      <Portaled>
        <AlertDialog open>
          <AlertDialogContent size="sm">
            <AlertDialogHeader>
              <AlertDialogTitle>Title</AlertDialogTitle>
              <AlertDialogDescription>Body</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction>Go</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </Portaled>,
    );
    const portal = view.getByTestId(PORTAL_ID);

    await waitFor(() => expect(slot(portal, "alert-dialog-content")).not.toBeNull());
    expect(slot(portal, "alert-dialog-content")?.getAttribute("data-size")).toBe("sm");
    for (const name of [
      "alert-dialog-overlay",
      "alert-dialog-header",
      "alert-dialog-title",
      "alert-dialog-description",
      "alert-dialog-footer",
      "alert-dialog-cancel",
      "alert-dialog-action",
    ]) {
      expect(slot(portal, name), name).not.toBeNull();
    }
  });
});
