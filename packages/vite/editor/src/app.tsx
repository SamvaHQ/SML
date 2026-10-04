import { toAsyncHost } from "@samva/editor/host/effect";
import {
  EditorGlyph,
  EditorProvider,
  EditorShell,
  LockedAction,
  type EditorIconName,
} from "@samva/editor/shell";
import { useEffect, useMemo, useState } from "react";

import { createFileHost } from "./host";

type TemplateChannel = "email" | "sms" | "whatsapp";

interface TemplateEntry {
  readonly id: string;
  readonly name: string;
  readonly channel: TemplateChannel;
  readonly sourceKind: "tsx";
}

interface CatalogDiagnostic {
  readonly file: string;
  readonly severity: "info" | "warning" | "error";
  readonly code: string;
  readonly message: string;
}

interface CatalogPayload {
  readonly templates: ReadonlyArray<TemplateEntry>;
  readonly diagnostics: ReadonlyArray<CatalogDiagnostic>;
}

const apiUrl = (path: string): string => new URL(`api/${path}`, window.location.href).toString();

const fetchJson = async <A,>(path: string): Promise<A> => {
  const response = await fetch(apiUrl(path));
  if (!response.ok) {
    // oxlint-disable-next-line samva/no-try-catch-or-throw, samva/no-error-constructor -- browser transport boundary
    throw new Error(`${path} failed (${response.status})`);
  }
  return response.json() as Promise<A>;
};

const useDarkMode = (): (() => void) => {
  const [dark, setDark] = useState(
    () =>
      typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);
  return () => setDark((value) => !value);
};

function Rail({
  onBack,
  onToggleTheme,
}: {
  onBack?: (() => void) | undefined;
  onToggleTheme: () => void;
}) {
  return (
    <nav
      aria-label="Samva editor"
      className="border-border bg-background z-30 flex w-12 flex-none flex-col items-center gap-1 border-r py-3"
    >
      <span className="bg-primary text-primary-foreground mb-2 grid size-7 place-items-center rounded-lg text-[13px] font-bold">
        S
      </span>
      {onBack ? (
        <button
          type="button"
          title="Back to templates"
          onClick={onBack}
          className="text-muted-foreground hover:bg-muted hover:text-foreground grid size-8 place-items-center rounded-lg transition-colors"
        >
          <EditorGlyph name="arrowLeft" className="size-[16px]" />
        </button>
      ) : null}
      <div className="flex-1" />
      <button
        type="button"
        title="Toggle theme"
        onClick={onToggleTheme}
        className="text-muted-foreground hover:bg-muted hover:text-foreground grid size-8 place-items-center rounded-lg transition-colors dark:hidden"
      >
        <EditorGlyph name="moon" className="size-[16px]" />
      </button>
      <button
        type="button"
        title="Toggle theme"
        onClick={onToggleTheme}
        className="text-muted-foreground hover:bg-muted hover:text-foreground hidden size-8 place-items-center rounded-lg transition-colors dark:grid"
      >
        <EditorGlyph name="sun" className="size-[16px]" />
      </button>
    </nav>
  );
}

interface EditorAffordances {
  readonly publishingInstructions?:
    | {
        readonly reason: string;
        readonly cta: { readonly label: string; readonly href: string };
      }
    | undefined;
  readonly authenticatedLabel: string;
  readonly authenticatedTitle: string;
}

const DEFAULT_AFFORDANCES: EditorAffordances = {
  authenticatedLabel: "Authenticated",
  authenticatedTitle: "The host provides authenticated capabilities.",
};

function EditorView({
  template,
  authenticated,
  editorAffordances,
  onBack,
  onToggleTheme,
}: {
  template: TemplateEntry;
  authenticated: boolean;
  editorAffordances: EditorAffordances;
  onBack: () => void;
  onToggleTheme: () => void;
}) {
  const publishingInstructions = editorAffordances.publishingInstructions;
  const host = useMemo(() => toAsyncHost(createFileHost({ id: template.id })), [template.id]);
  return (
    <EditorProvider key={`${template.id}:${template.channel}`} host={host}>
      <div className="relative h-dvh">
        <EditorShell
          contributions={[
            {
              slot: "frame.start",
              id: "project-rail",
              render: () => <Rail onBack={onBack} onToggleTheme={onToggleTheme} />,
            },
            // Test-send stays locked even with an API key: a send addresses a published template
            // by id, and a local file has none until it is published. The lock names that path
            // instead of faking the affordance.
            ...(authenticated && publishingInstructions !== undefined
              ? [
                  {
                    slot: "toolbar.actions" as const,
                    id: "send",
                    render: () => (
                      <LockedAction
                        label="Send"
                        title={`Send “${template.name}”`}
                        upsell={publishingInstructions}
                        testId="vite-editor.send"
                      />
                    ),
                  },
                ]
              : []),
          ]}
          onBack={onBack}
          renameEnabled={false}
        />
      </div>
    </EditorProvider>
  );
}

const CHANNEL_META: Record<
  TemplateChannel,
  {
    readonly icon: EditorIconName;
    readonly label: string;
    readonly className: string;
  }
> = {
  email: { icon: "envelope", label: "Email", className: "bg-sel-soft text-accent-email" },
  sms: { icon: "message", label: "SMS", className: "bg-muted text-primary" },
  whatsapp: {
    icon: "chatBubble",
    label: "WhatsApp",
    className: "bg-status-success/10 text-status-success",
  },
};

function Picker({
  catalog,
  authenticated,
  editorAffordances,
  onOpen,
  onToggleTheme,
}: {
  catalog: CatalogPayload;
  authenticated: boolean;
  editorAffordances: EditorAffordances;
  onOpen: (template: TemplateEntry) => void;
  onToggleTheme: () => void;
}) {
  return (
    <div className="flex h-dvh">
      <Rail onToggleTheme={onToggleTheme} />
      <div className="bg-surface-inset min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[720px] px-6 py-16">
          <div className="flex items-baseline justify-between">
            <div>
              <h1 className="text-foreground text-lg font-semibold">Templates</h1>
              <p className="text-muted-foreground mt-1 text-[13px]">
                Preview your templates and fixtures. Source edits save to your project.
              </p>
            </div>
            <span
              className={
                authenticated
                  ? "bg-status-success/12 text-status-success rounded-full px-2.5 py-1 text-[11px] font-medium"
                  : "bg-muted text-muted-foreground rounded-full px-2.5 py-1 text-[11px] font-medium"
              }
              title={authenticated ? editorAffordances.authenticatedTitle : "Local editing only."}
            >
              {authenticated ? editorAffordances.authenticatedLabel : "Local only"}
            </span>
          </div>

          {catalog.diagnostics.length > 0 ? (
            <section
              aria-label="Catalog diagnostics"
              className="border-border bg-surface-elevated mt-6 overflow-hidden rounded-xl border"
            >
              {catalog.diagnostics.map((item, index) => (
                <div
                  key={`${item.file}:${item.code}:${index}`}
                  className={
                    "px-4 py-3 text-[12px]" + (index > 0 ? " border-border-subtle border-t" : "")
                  }
                >
                  <p
                    className={
                      item.severity === "error" ? "text-status-error" : "text-status-warning"
                    }
                  >
                    {item.file} · {item.code}
                  </p>
                  <p className="text-muted-foreground mt-0.5">{item.message}</p>
                </div>
              ))}
            </section>
          ) : null}

          <ul className="border-border bg-surface-elevated mt-8 overflow-hidden rounded-xl border shadow-md">
            {catalog.templates.length === 0 ? (
              <li className="text-muted-foreground px-4 py-10 text-center text-[13px]">
                No valid templates found. Add a <code className="text-foreground">.tsx</code> file
                with a Samva template as its default export.
              </li>
            ) : null}
            {catalog.templates.map((template, index) => {
              const meta = CHANNEL_META[template.channel];
              return (
                <li key={template.id}>
                  <button
                    type="button"
                    onClick={() => onOpen(template)}
                    data-testid={`template-card.${template.id}`}
                    className={
                      "hover:bg-muted flex w-full items-center gap-3 px-4 py-3 text-left transition-colors" +
                      (index > 0 ? " border-border-subtle border-t" : "")
                    }
                  >
                    <span
                      className={`grid size-8 flex-none place-items-center rounded-lg ${meta.className}`}
                    >
                      <EditorGlyph name={meta.icon} className="size-[16px]" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="text-foreground block truncate text-[13px] font-medium">
                        {template.name}
                      </span>
                      <span className="text-muted-foreground block truncate text-[12px]">
                        {template.id}
                      </span>
                    </span>
                    <span className="text-muted-foreground text-right text-[11px]">
                      <span className="block">{meta.label}</span>
                      <span className="block">Editable source</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}

export function App() {
  const toggleTheme = useDarkMode();
  const [authenticated, setAuthenticated] = useState(false);
  const [editorAffordances, setEditorAffordances] = useState(DEFAULT_AFFORDANCES);
  const [catalog, setCatalog] = useState<CatalogPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const loadCatalog = () =>
      fetchJson<CatalogPayload>("templates").then((payload) => {
        if (live) {
          setCatalog(payload);
          setError(null);
        }
      });
    void Promise.all([
      fetchJson<{
        readonly authenticated: boolean;
        readonly editorAffordances?: EditorAffordances;
      }>("capabilities").then((caps) => {
        if (live) {
          setAuthenticated(Boolean(caps.authenticated));
          setEditorAffordances(caps.editorAffordances ?? DEFAULT_AFFORDANCES);
        }
      }),
      loadCatalog(),
    ]).catch((cause: unknown) => {
      if (live) setError(String(cause));
    });

    const events = new EventSource(apiUrl("catalog-events"));
    events.addEventListener("samva:catalog", () => {
      void loadCatalog().catch((cause: unknown) => {
        if (live) setError(String(cause));
      });
    });
    return () => {
      live = false;
      events.close();
    };
  }, []);

  const selected = catalog?.templates.find((template) => template.id === selectedId) ?? null;
  // A selection whose template left the catalog resets during render (the
  // React-sanctioned adjust-state-on-change form), not in an effect.
  if (selectedId !== null && catalog !== null && selected === null) setSelectedId(null);

  if (error !== null) {
    return (
      <div className="text-status-error grid h-dvh place-items-center px-6 text-center text-[13px]">
        Couldn’t reach the Samva editor dev server: {error}
      </div>
    );
  }
  if (catalog === null) {
    return (
      <div className="text-muted-foreground grid h-dvh place-items-center text-[13px]">
        Loading templates…
      </div>
    );
  }
  if (selected !== null) {
    return (
      <EditorView
        template={selected}
        authenticated={authenticated}
        editorAffordances={editorAffordances}
        onBack={() => setSelectedId(null)}
        onToggleTheme={toggleTheme}
      />
    );
  }
  return (
    <Picker
      catalog={catalog}
      authenticated={authenticated}
      editorAffordances={editorAffordances}
      onOpen={(template) => setSelectedId(template.id)}
      onToggleTheme={toggleTheme}
    />
  );
}
