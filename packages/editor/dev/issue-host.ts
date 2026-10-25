import {
  contractVersion,
  DocumentConflict,
  LifecycleUnavailable,
  type AsyncEditableEditorHost,
  type AsyncLifecycleApi,
  type DocumentChange,
  type EditableEmailDocument,
  type EmailRender,
  type ProjectLifecycleState,
} from "@samva/editor/host";
import { previewEmail } from "@samva/markup/edit";
import { compileIssue } from "@samva/markup/markdown";

import { renderPage } from "./page-render";

// `?demo=issue` hosts a newsletter issue: a TSX layout that places `<IssueContent />` and one
// Markdown issue the layout renders. The host holds both files, recompiles the issue on every
// save, and answers a prose edit made on the web page the way a project host does: the editor
// reads the Markdown through `lifecycle.inspect`, writes it back through `updateFile`, and the
// host publishes the render of what was written, for the email and the web page alike.

const LAYOUT_FILE = "layout.tsx";
const ISSUE_FILE = "issues/launch.md";

const LAYOUT = `import { defineTemplate } from "@samva/markup";
import { jsonSchema } from "@samva/markup/input-schema";
import { Email, IssueContent } from "@samva/markup/email";

export default defineTemplate({
  id: "newsletter",
  schema: jsonSchema({ type: "object", properties: {} }),
  fixtures: { reader: {} },
  email: {
    subject: () => "The Nimbus Letter",
    body: () => (
      <Email>
        <IssueContent />
      </Email>
    ),
  },
});
`;

const ISSUE = `---
title: Launch notes
slug: launch-notes
topic: product
---

# What shipped this week

Cold brew subscriptions are live in every region, with delivery every other Tuesday.

We also rewrote the roasting guide so a first bag takes five minutes to understand.

## Coming next

Gift bundles arrive in March.
`;

const VARIABLES: EditableEmailDocument["variables"] = [];

type Project = Record<string, string>;

/** The Markdown file as the host holds it, so the harness can show what an edit wrote. */
export interface IssueSource {
  readonly read: () => string;
  readonly subscribe: (listener: () => void) => () => void;
}

export const createIssueHost = async (): Promise<{
  readonly host: AsyncEditableEditorHost;
  readonly source: IssueSource;
}> => {
  const project: Project = { [LAYOUT_FILE]: LAYOUT, [ISSUE_FILE]: ISSUE };
  let counter = 1;
  const rev = () => `rev_${counter}`;
  const listeners = new Set<(change: DocumentChange) => void>();
  const sourceListeners = new Set<() => void>();

  const build = async () => {
    const compiled = await compileIssue({
      files: project,
      entry: ISSUE_FILE,
      assetBase: "",
      tailwind: false,
    });
    return compiled;
  };
  let compiled = await build();

  const renderEmail = (): EmailRender | null => {
    const template = compiled.template;
    const input = compiled.fixtures.reader;
    if (template === undefined) return null;
    const preview = previewEmail(template, input);
    return {
      revision: rev(),
      subject: preview.subject,
      ...(preview.preheader === undefined ? {} : { preheader: preview.preheader }),
      html: preview.html,
      text: preview.text,
      selections: preview.selections,
    };
  };

  const content = () => {
    const render = renderEmail();
    return {
      channel: "email" as const,
      preview: { status: "current" as const },
      fixtures: render === null ? [] : Object.keys(compiled.fixtures),
      fixture: render === null ? null : "reader",
      render,
      diagnostics: compiled.diagnostics,
      incompatibilities: [],
    };
  };

  const state = (): ProjectLifecycleState => ({
    rev: rev(),
    baseCommit: "c1",
    remoteHead: "c1",
    dirty: counter > 1,
    files: Object.entries(project).map(([path, text]) => ({
      path,
      status: "clean" as const,
      content: text,
    })),
    conflicts: [],
    commits: [],
  });

  const refused = () =>
    Promise.reject(
      new LifecycleUnavailable({ reason: "The issue demo supports editing text only." }),
    );

  const lifecycle: AsyncLifecycleApi = {
    inspect: async () => state(),
    updateFile: async ({ path, baseRev, content: next }) => {
      if (baseRev !== rev())
        return Promise.reject(new DocumentConflict({ expectedRev: baseRev, actualRev: rev() }));
      if (next !== null) project[path] = next;
      compiled = await build();
      counter += 1;
      const change: DocumentChange = {
        rev: rev(),
        origin: "external",
        authoredSource: LAYOUT,
        ...content(),
      };
      for (const listener of listeners) listener(change);
      for (const listener of sourceListeners) listener();
      return state();
    },
    publish: refused,
    restore: refused,
    resolveConflict: refused,
    putAsset: refused,
  };

  const host: AsyncEditableEditorHost = {
    contractVersion,
    access: "editable",
    sourceAccess: "editable",
    document: {
      open: async (onChange) => {
        listeners.add(onChange);
        const initial: EditableEmailDocument = {
          id: "issue_launch",
          name: "Launch notes",
          rev: rev(),
          origin: { kind: "tsx", file: LAYOUT_FILE, authoredSource: LAYOUT },
          access: { kind: "editable" },
          variables: VARIABLES,
          metadata: {},
          ...content(),
        };
        return { initial, close: () => void listeners.delete(onChange) };
      },
    },
    writer: {
      save: async () => ({ rev: rev() }),
    },
    lifecycle: { status: "ready", api: lifecycle },
    render: async (_entry, _fixture, target) => {
      const template = compiled.template;
      if (template === undefined) return null;
      if (target === "email") return renderEmail();
      return renderPage(template, compiled.fixtures.reader, rev());
    },
  };
  return {
    host,
    source: {
      read: () => project[ISSUE_FILE] ?? "",
      subscribe: (listener) => {
        sourceListeners.add(listener);
        return () => void sourceListeners.delete(listener);
      },
    },
  };
};
