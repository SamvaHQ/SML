import Home01Icon from "@hugeicons/core-free-icons/Home01Icon";
import LayoutTemplateIcon from "@hugeicons/core-free-icons/LayoutTemplateIcon";
import Message01Icon from "@hugeicons/core-free-icons/Message01Icon";
import Settings01Icon from "@hugeicons/core-free-icons/Settings01Icon";
import UserGroupIcon from "@hugeicons/core-free-icons/UserGroupIcon";
import { HugeiconsIcon } from "@hugeicons/react";
import { type AsyncEditorHost } from "@samva/editor/host";
import { toAsyncHost } from "@samva/editor/host/effect";
import { createMockHost, type MockHostControls } from "@samva/editor/mock";
import {
  type CheckItem,
  type EditorContribution,
  type EditorIcons,
  EditorProvider,
  EditorShell,
  LockedAction,
} from "@samva/editor/shell";
import { Effect } from "effect";
import { useEffect, useRef, useState } from "react";

import { useEditorStore } from "../src/state/context";
import { createPromiseHost } from "./promise-host";

// Representative checks so the statusbar summary + document inspector render with
// real content; a real host supplies its compile checks instead.
const SAMPLE_CHECKS: ReadonlyArray<CheckItem> = [
  { id: "c1", severity: "ok", label: "Alt text on images", detail: "Every image has alt text." },
  {
    id: "c2",
    severity: "ok",
    label: "Link destinations",
    detail: "All links resolve to https URLs.",
  },
  {
    id: "c3",
    severity: "warn",
    label: "Gmail clipping risk",
    detail: "Document is under the 102 KB clip threshold, but watch growth.",
  },
];

const NAV = [
  { icon: Home01Icon, label: "Home" },
  { icon: Message01Icon, label: "Messages" },
  { icon: LayoutTemplateIcon, label: "Templates", active: true },
  { icon: UserGroupIcon, label: "Contacts" },
] as const;

/** Fake dashboard icon rail — harness only; the dashboard supplies its own. */
function FakeDashSidebar({ onToggleTheme }: { onToggleTheme: () => void }) {
  return (
    <nav
      aria-label="Dashboard"
      className="border-border bg-background z-30 flex w-12 flex-none flex-col items-center gap-1 border-r py-3"
    >
      <span className="bg-primary text-primary-foreground mb-2 grid size-7 place-items-center rounded-lg text-[13px] font-bold">
        S
      </span>
      {NAV.map(({ icon, label, ...item }) => (
        <button
          key={label}
          type="button"
          title={label}
          className={
            "active" in item && item.active
              ? "bg-sel-soft text-accent-email grid size-8 place-items-center rounded-lg"
              : "text-muted-foreground hover:bg-muted hover:text-foreground grid size-8 place-items-center rounded-lg transition-colors"
          }
        >
          <HugeiconsIcon icon={icon} className="size-[16px]" />
        </button>
      ))}
      <div className="flex-1" />
      <button
        type="button"
        title="Toggle theme"
        onClick={onToggleTheme}
        className="text-muted-foreground hover:bg-muted hover:text-foreground grid size-8 place-items-center rounded-lg transition-colors"
      >
        <HugeiconsIcon icon={Settings01Icon} className="size-[16px]" />
      </button>
    </nav>
  );
}

/** Dev-only observation seam for browser contracts; never exported by the package. */
function HarnessProbe() {
  const authoredSource = useEditorStore((state) => state.doc?.origin.authoredSource ?? "");
  const selectedPath = useEditorStore((state) =>
    state.selection.kind === "element" ? state.selection.instancePath : "",
  );
  const fixture = useEditorStore((state) =>
    state.doc?.channel === "email" ? (state.doc.fixture ?? "") : "",
  );
  const rendered = useEditorStore((state) => state.render !== null);
  return (
    <div hidden>
      <output data-editor-authored-source>{authoredSource}</output>
      <output data-editor-selected-instance-path>{selectedPath}</output>
      <output data-editor-fixture>{fixture}</output>
      <output data-editor-rendered>{String(rendered)}</output>
    </div>
  );
}

/**
 * `?demo=extensions` runs the editor the way an outside embedder would: a Promise host with no
 * Effect, an assistant and a locked action contributed to named regions, and one replaced icon.
 */
const EXTENSIONS_DEMO =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get("demo") === "extensions";

/** A replacement for the Preview icon, so the demo shows a host's icon set taking effect. */
const DemoPreviewIcon = ({ className }: { readonly className?: string }) => (
  <svg viewBox="0 0 16 16" className={className} aria-hidden="true">
    <circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
    <circle cx="8" cy="8" r="2" fill="currentColor" />
  </svg>
);

const DEMO_ICONS: Partial<EditorIcons> = { eye: DemoPreviewIcon };

const demoContributions = (onToggleTheme: () => void): ReadonlyArray<EditorContribution> => [
  {
    slot: "frame.start",
    id: "dashboard-nav",
    render: () => <FakeDashSidebar onToggleTheme={onToggleTheme} />,
  },
  {
    slot: "rail.assistant",
    id: "demo-assistant",
    header: <span className="text-muted-foreground text-[11px]">Demo</span>,
    render: ({ workspace }) => (
      <div data-testid="dev-app.demo-assistant" className="flex flex-col gap-2 p-4 text-[13px]">
        <p>A host-owned panel docked in the assistant rail.</p>
        <p className="text-muted-foreground">
          Draft {workspace.draftRevision ?? "not open"} · {workspace.checks.errors} errors ·{" "}
          {workspace.layers.length} layers
        </p>
      </div>
    ),
  },
  {
    slot: "toolbar.actions",
    id: "demo-send",
    render: () => (
      <LockedAction
        label="Send"
        title="Send this template"
        upsell={{
          reason: "Sending runs on Samva. Publish the template, then send it by its ID.",
          cta: { label: "How sending works", href: "https://samva.dev/docs" },
        }}
        testId="dev-app.demo-send"
      />
    ),
  },
];

export const App = () => {
  const emitRef = useRef<MockHostControls["emit"] | null>(null);
  const [host, setHost] = useState<AsyncEditorHost | null>(() =>
    EXTENSIONS_DEMO ? createPromiseHost() : null,
  );
  useEffect(() => {
    if (EXTENSIONS_DEMO) return;
    // oxlint-disable-next-line eslint/no-restricted-properties -- the dev harness root is a program edge that builds the mock host once on mount
    void Effect.runPromise(createMockHost).then((controls) => {
      emitRef.current = controls.emit;
      const mock = toAsyncHost(controls.host);
      // The harness has no Git; saving a version keeps the revision it was given.
      setHost({
        ...mock,
        versions: {
          status: "ready",
          api: { save: async (revision) => revision, savedRevision: async () => null },
        },
      });
    });
  }, []);

  const toggleTheme = () => document.documentElement.classList.toggle("dark");

  if (host === null) {
    return (
      <div
        data-testid="dev-app.booting"
        className="text-muted-foreground grid h-dvh place-items-center text-[13px]"
      >
        Booting editor…
      </div>
    );
  }

  return (
    <div data-editor-harness-ready="" className="contents">
      <EditorProvider
        host={host}
        checks={SAMPLE_CHECKS}
        icons={EXTENSIONS_DEMO ? DEMO_ICONS : undefined}
      >
        <EditorShell
          // The Promise host keeps metadata read-only, so a rename would have nowhere to go.
          renameEnabled={!EXTENSIONS_DEMO}
          contributions={
            EXTENSIONS_DEMO
              ? demoContributions(toggleTheme)
              : [
                  {
                    slot: "frame.start",
                    id: "dashboard-nav",
                    render: () => <FakeDashSidebar onToggleTheme={toggleTheme} />,
                  },
                ]
          }
          onBack={() => console.info("[harness] back to templates")}
        />
        <HarnessProbe />
      </EditorProvider>
    </div>
  );
};
