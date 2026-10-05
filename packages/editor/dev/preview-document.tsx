import type { AsyncEditableEditorHost, EmailRender } from "@samva/editor/host";
import { EditorProvider, EditorShell, type PreparedPreviewDocument } from "@samva/editor/shell";
import { StrictMode, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";

import { useEditorStoreApi } from "../src/state/context";
import { createPromiseHost } from "./promise-host";

// oxlint-disable-next-line import/no-unassigned-import -- The browser fixture uses the shell's real styles.
import "./styles.css";

interface LifecycleEvent {
  readonly kind: "mount" | "cleanup";
  readonly document: number;
  readonly policy: number;
  readonly intact: boolean;
  readonly scheme: string;
}

declare global {
  interface Window {
    previewLifecycle: { events: LifecycleEvent[]; live: number; duplicates: number };
  }
}

window.previewLifecycle = { events: [], live: 0, duplicates: 0 };
const live = new Set<Document>();
const documentIds = new WeakMap<Document, number>();
let nextDocumentId = 0;

const fixtureHtml = (revision: string) => `<!doctype html><html><head>
<meta http-equiv="Content-Security-Policy" content="font-src 'none'; style-src 'unsafe-inline' 'self'">
<style data-test-fonts>
@import url('/preview-font-import.css');
@font-face {font-family: ParserFont; src: url('/preview-font.woff2')}
body {font-family: ParserFont}
</style>
<style>#preparation-target{color:rgb(255,0,0)}
@media (prefers-color-scheme: dark){#preparation-target{color:rgb(0,0,255)}}</style>
</head><body><h1 id="preparation-target" data-samva-instance="0.0.1">Prepared preview</h1>
<!-- ${revision} --></body></html>`;

const withFixture = (render: EmailRender | null): EmailRender | null =>
  render === null ? null : { ...render, html: fixtureHtml(render.revision) };

const createHost = (): AsyncEditableEditorHost => {
  const host = createPromiseHost();
  return {
    ...host,
    document: {
      open: async (onChange) => {
        const session = await host.document.open((change) =>
          onChange(
            change.channel === "email" ? { ...change, render: withFixture(change.render) } : change,
          ),
        );
        return {
          ...session,
          initial:
            session.initial.channel === "email"
              ? { ...session.initial, render: withFixture(session.initial.render) }
              : session.initial,
        };
      },
    },
  };
};

function RevisionButton() {
  const store = useEditorStoreApi();
  return (
    <button
      type="button"
      data-testid="preparation.revision"
      onClick={() => {
        const { doc } = store.getState();
        if (doc !== null && host.writer !== undefined) {
          void host.writer.save({
            kind: "authoredSource",
            baseRev: doc.rev,
            authoredSource: doc.origin.authoredSource,
          });
        }
      }}
    >
      Change revision
    </button>
  );
}

const host = createHost();

function PreviewDocumentFixture() {
  const [policy, setPolicy] = useState(1);
  const [mounted, setMounted] = useState(true);
  const [unrelated, setUnrelated] = useState(0);
  const [enabled, setEnabled] = useState(
    new URLSearchParams(location.search).get("prepare") !== "off",
  );
  const prepare = useMemo(
    () =>
      (html: string): PreparedPreviewDocument => ({
        html: html.replace(/<style data-test-fonts>[\s\S]*?<\/style>/, ""),
        mount(document) {
          const id = documentIds.get(document) ?? ++nextDocumentId;
          documentIds.set(document, id);
          if (live.has(document)) window.previewLifecycle.duplicates += 1;
          live.add(document);
          const body = document.body;
          body.dataset.preparationPolicy = String(policy);
          const style = document.createElement("style");
          style.dataset.preparationResource = String(policy);
          style.textContent = "body{min-height:240px}";
          document.head.appendChild(style);
          const scheme = html.includes("@media all")
            ? "dark"
            : html.includes("@media not all")
              ? "light"
              : "auto";
          window.previewLifecycle.events.push({
            kind: "mount",
            document: id,
            policy,
            intact: body.isConnected,
            scheme,
          });
          window.previewLifecycle.live = live.size;
          return () => {
            window.previewLifecycle.events.push({
              kind: "cleanup",
              document: id,
              policy,
              intact:
                body.ownerDocument === document &&
                body.dataset.preparationPolicy === String(policy),
              scheme,
            });
            style.remove();
            delete body.dataset.preparationPolicy;
            live.delete(document);
            window.previewLifecycle.live = live.size;
          };
        },
      }),
    [policy],
  );
  return (
    <>
      <div style={{ position: "fixed", top: 0, zIndex: 2147483647 }}>
        <button
          type="button"
          data-testid="preparation.policy"
          onClick={() => setPolicy(policy + 1)}
        >
          Change policy
        </button>
        <button
          type="button"
          data-testid="preparation.unrelated"
          onClick={() => setUnrelated(unrelated + 1)}
        >
          Rerender {unrelated}
        </button>
        <button type="button" data-testid="preparation.disable" onClick={() => setEnabled(false)}>
          Default HTML
        </button>
        <button type="button" data-testid="preparation.unmount" onClick={() => setMounted(false)}>
          Unmount
        </button>
      </div>
      {mounted && (
        <EditorProvider host={host} preparePreviewDocument={enabled ? prepare : undefined}>
          <EditorShell
            contributions={[
              { slot: "toolbar.actions", id: "revision", render: () => <RevisionButton /> },
            ]}
          />
        </EditorProvider>
      )}
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PreviewDocumentFixture />
  </StrictMode>,
);
