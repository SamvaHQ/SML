import {
  contractVersion,
  DocumentConflict,
  type DocumentChange,
  type EditableEmailDocument,
} from "@samva/editor/host";
import type { AsyncEditableEditorHost } from "@samva/editor/host";
import { MOCK_FIXTURE_NAMES, NIMBUS_WELCOME_TSX, renderMockFixture } from "@samva/editor/mock";

// A host written the way an embedder would write one: plain promises and callbacks over a
// document held in memory, with no Effect. The render stands in for whatever compiler the
// embedder runs; everything else is the whole contract.

export const createPromiseHost = (): AsyncEditableEditorHost => {
  let revision = 1;
  let authoredSource = NIMBUS_WELCOME_TSX;
  let fixture = MOCK_FIXTURE_NAMES[0] ?? null;
  const listeners = new Set<(change: DocumentChange) => void>();

  const rev = () => `rev_${revision}`;
  const content = () => ({
    channel: "email" as const,
    preview: { status: "current" as const },
    fixtures: MOCK_FIXTURE_NAMES,
    fixture,
    render: fixture === null ? null : renderMockFixture(fixture, rev()),
    diagnostics: [],
    incompatibilities: [],
  });
  const publish = () => {
    const change: DocumentChange = { rev: rev(), origin: "self", authoredSource, ...content() };
    for (const listener of listeners) listener(change);
  };

  return {
    contractVersion,
    access: "editable",
    sourceAccess: "editable",
    metadataAccess: "readonly",
    document: {
      open: async (onChange) => {
        // Subscribe before taking the snapshot, so nothing published in between is lost.
        listeners.add(onChange);
        const initial: EditableEmailDocument = {
          id: "welcome",
          name: "Welcome (Promise host)",
          rev: rev(),
          origin: { kind: "tsx", file: "src/Welcome.tsx", authoredSource },
          variables: [],
          metadata: {},
          access: { kind: "editable" },
          ...content(),
        };
        return { initial, close: () => listeners.delete(onChange) };
      },
    },
    writer: {
      save: async (update) => {
        if (update.kind === "metadata") return { rev: rev() };
        // A Promise host reports a conflict by rejecting with the contract's error.
        if (update.baseRev !== rev()) {
          return Promise.reject(
            new DocumentConflict({ expectedRev: update.baseRev, actualRev: rev() }),
          );
        }
        revision += 1;
        authoredSource = update.authoredSource;
        publish();
        return { rev: rev() };
      },
    },
    fixtures: {
      status: "ready",
      api: {
        view: async (name) => {
          fixture = name;
          publish();
        },
      },
    },
  };
};
