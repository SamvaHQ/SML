import {
  applySourceReplacements,
  classNameEdit,
  expressionReplacement,
  inspectSourceFixtures,
  structuralReplacements,
  inspectSourceElement,
  literalReplacement,
  type ProfileGuard,
  type SourceProperty,
  type SourceReplacement,
} from "@samva/markup/edit";
import type { EmailElementSelection } from "@samva/markup/render";
import { useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";

import { useEditorStore } from "../state/context";
import { useContribution } from "./contributions";
import { formatOrigin } from "./email-outline";
import { GroupLabel } from "./ui";
import { cn, focusRing } from "./ui-classes";

const inputClass = cn(
  "border-border bg-background text-foreground w-full rounded border px-2 py-1.5 text-xs",
  focusRing,
);
const buttonClass = cn(
  "border-border hover:bg-muted rounded border px-2 py-1 text-xs disabled:opacity-50",
  focusRing,
);

function PropertyControl({
  field,
  source,
  propose,
  apply,
}: {
  readonly field: SourceProperty;
  readonly source: string;
  readonly propose: (edit: SourceReplacement) => void;
  readonly apply: (edit: SourceReplacement) => void;
}) {
  const [value, setValue] = useState(field.value);
  const [expression, setExpression] = useState(
    field.kind === "literal" && field.literalType === "string"
      ? JSON.stringify(field.value)
      : field.value,
  );
  return (
    <div className="mt-3 space-y-1.5">
      <label className="block text-xs">
        {propertyLabel(field.name)} · {field.kind}
        {field.kind === "literal" ? (
          <input
            aria-label={`${field.name} literal`}
            data-testid={`source.property.${field.name}.literal`}
            type={field.literalType === "number" ? "number" : "text"}
            className={inputClass}
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
        ) : (
          <code className="bg-muted mt-1 block rounded p-2 break-all">{field.value}</code>
        )}
      </label>
      {field.kind === "literal" && (
        <button
          data-testid={`source.property.${field.name}.apply`}
          type="button"
          className={buttonClass}
          disabled={literalReplacement(source, field, value) === null}
          onClick={() => {
            const edit = literalReplacement(source, field, value);
            if (edit !== null) apply(edit);
          }}
        >
          Apply literal
        </button>
      )}
      <details>
        <summary
          data-testid={`source.property.${field.name}.expression-toggle`}
          className="cursor-pointer text-xs"
        >
          {field.kind === "literal"
            ? "Change to a binding or expression"
            : "Review a binding or expression change"}
        </summary>
        <p className="text-muted-foreground my-1 text-xs">
          This changes template logic. Fixture values are edited separately.
        </p>
        <textarea
          aria-label={`${field.name} expression`}
          data-testid={`source.property.${field.name}.expression`}
          className={inputClass}
          value={expression}
          onChange={(event) => setExpression(event.target.value)}
        />
        <button
          data-testid={`source.property.${field.name}.review`}
          type="button"
          className={buttonClass}
          onClick={() => propose(expressionReplacement(source, field, expression))}
        >
          Review expression diff
        </button>
      </details>
    </div>
  );
}

interface Reviewed {
  readonly edits: readonly SourceReplacement[];
  /** Why the change cannot be applied; the diff is still shown so the author can see it. */
  readonly refusal: string | null;
}

const propertyLabel = (name: string): string =>
  name === "children" || name.startsWith("text.")
    ? "Text"
    : name === "className"
      ? "Style classes"
      : name;

const errorText = (cause: unknown): string =>
  cause instanceof Error && cause.message !== "" ? cause.message : "The host could not save this.";

/** The project's other files, read once when the selected element lives outside the entry. */
function useProjectFiles(path: string | null) {
  const capability = useEditorStore((state) => state.lifecycleCapability);
  const { flushSaves } = useEditorStore((state) => state.actions);
  const [loaded, setLoaded] = useState<Readonly<Record<string, string>> | "failed" | null>(null);
  useEffect(() => {
    if (path === null || capability?.status !== "ready") return;
    let cancelled = false;
    void flushSaves()
      .then(() => capability.api.inspect())
      .then((state) => {
        if (cancelled) return;
        const files: Record<string, string> = {};
        for (const file of state.files)
          if (file.binary !== true && file.status !== "deleted" && file.content !== null)
            files[file.path] = file.content;
        setLoaded(files);
      })
      .catch(() => {
        if (!cancelled) setLoaded("failed");
      });
    return () => {
      cancelled = true;
    };
  }, [path, capability, flushSaves]);
  if (path === null) return { status: "entry" as const };
  if (capability?.status !== "ready") return { status: "unavailable" as const };
  if (loaded === null) return { status: "loading" as const };
  if (loaded === "failed") return { status: "unavailable" as const };
  return { status: "ready" as const, files: loaded, api: capability.api };
}

/** Why the controls show nothing to edit: waiting, a file this host cannot read, or read-only. */
function unavailableReason(input: {
  readonly busy: boolean;
  readonly file: string | null;
  readonly project: "entry" | "loading" | "unavailable" | "ready";
  readonly resolved: boolean;
}): string {
  if (input.busy) return "Waiting for the latest source to render.";
  if (input.file !== null && input.project === "loading") return `Reading ${input.file}.`;
  if (input.file !== null && input.project === "unavailable")
    return `This element is written in ${input.file}, outside the template entry, and this host cannot edit project files from here. Open Source or ask the agent.`;
  if (!input.resolved)
    return "This origin cannot be resolved in its file. Open its source or ask the agent.";
  return "This source is read-only.";
}

/** How many rendered copies one edit changes, and where the edited source is shared. */
function scopeNote(selection: EmailElementSelection, shared: boolean): string {
  const copies =
    selection.occurrences > 1
      ? `This element renders ${selection.occurrences} times here (a loop or a repeated component), so one edit changes all ${selection.occurrences}.`
      : "This changes this element.";
  return `${copies}${shared ? " It is written in a partial, so every template that uses the partial changes too." : ""} Fixture items remain separate data.`;
}

/** Properties operate on an explicit authoring origin, never an inferred rendered value. */
function SourceControlsSession({ selection }: { readonly selection: EmailElementSelection }) {
  const { doc, pending, revision, editable, storeError, lifecycleBusy } = useEditorStore(
    useShallow((state) => ({
      doc: state.doc,
      pending: state.pendingAuthoredSource,
      revision: state.render?.revision,
      editable: state.sourceEditable,
      storeError: state.sourceEditError,
      lifecycleBusy: state.lifecycleBusy,
    })),
  );
  const { applySourceEdit, openSource, requestSourceAssistance, beginLifecycle, endLifecycle } =
    useEditorStore((state) => state.actions);
  const { flushSaves } = useEditorStore((state) => state.actions);
  const assistantDocked = useContribution("rail.assistant") !== undefined;
  const [scope, setScope] = useState(0);
  const [structureError, setStructureError] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [classes, setClasses] = useState("");
  const [insert, setInsert] = useState("<p>New content</p>");
  const [destination, setDestination] = useState("");
  const [structuralProposal, setStructuralProposal] = useState<Reviewed | null>(null);
  const [proposal, setProposal] = useState<Reviewed | null>(null);
  const origin = selection.origins[scope];
  const entryFile = doc?.origin.file;
  const foreign = origin !== undefined && origin.fileName !== entryFile;
  const project = useProjectFiles(foreign ? origin.fileName : null);
  if (doc === null || entryFile === undefined) return null;
  const entrySource = doc.origin.authoredSource;
  const source =
    foreign && origin !== undefined
      ? project.status === "ready"
        ? (project.files[origin.fileName] ?? null)
        : null
      : entrySource;
  const target =
    origin === undefined || source === null
      ? null
      : inspectSourceElement(source, origin.fileName, origin);
  const guard: ProfileGuard = foreign
    ? {
        entry: entryFile,
        file: origin.fileName,
        files: { ...(project.status === "ready" ? project.files : {}), [entryFile]: entrySource },
      }
    : { entry: entryFile };
  const available =
    editable &&
    pending === null &&
    !lifecycleBusy &&
    !saving &&
    revision === doc.rev &&
    target !== null &&
    source !== null;
  const check = (edits: readonly SourceReplacement[]): Reviewed => {
    const result = applySourceReplacements(source ?? "", edits, { profile: guard });
    return { edits, refusal: result.ok ? null : result.reason };
  };
  /** Commit through the entry's saved source, or through the host's project files for a partial. */
  const commit = (edits: readonly SourceReplacement[]) => {
    if (source === null) return;
    setLocalError(null);
    setStructureError(null);
    if (!foreign) {
      applySourceEdit({ revision: revision ?? "", source, edits });
      return;
    }
    const result = applySourceReplacements(source, edits, { profile: guard });
    if (!result.ok) {
      setLocalError(result.reason);
      return;
    }
    if (project.status !== "ready" || !beginLifecycle()) return;
    setSaving(true);
    void flushSaves()
      .then((baseRev) =>
        project.api.updateFile({ path: origin.fileName, baseRev, content: result.source }),
      )
      .catch((cause: unknown) => setLocalError(errorText(cause)))
      .finally(() => {
        endLifecycle();
        setSaving(false);
      });
  };
  const apply = (edit: SourceReplacement) => {
    commit([edit]);
    setProposal(null);
  };
  const shownError = localError ?? storeError;
  const className = target?.properties.find((field) => field.name === "className");
  const classRefusal =
    target === null || source === null || className?.kind === "literal"
      ? null
      : (() => {
          const attempt = classNameEdit(source, target, { kind: "add", tokens: "x" });
          return attempt.ok ? null : attempt.reason;
        })();
  const scoped = selection.origins.length > 1;
  return (
    <div className="border-border-subtle border-b py-3">
      <GroupLabel>Source properties</GroupLabel>
      {scoped && (
        <label className="block text-xs">
          Edit scope
          <select
            aria-label="Edit scope"
            data-testid="source.scope"
            className={inputClass}
            value={scope}
            onChange={(event) => {
              setScope(Number(event.target.value));
              setProposal(null);
            }}
          >
            {selection.origins.map((entry, index) => (
              <option key={index} value={index}>
                {index === 0 ? "Element" : `Call site ${index}`} · {formatOrigin(entry)}
              </option>
            ))}
          </select>
        </label>
      )}
      <p data-testid="source.scope-note" className="text-muted-foreground mt-2 text-xs">
        {scoped && scope > 0
          ? "Changes this call site, including every loop iteration it produces. Fixture items remain separate data."
          : scopeNote(selection, foreign)}
      </p>
      {foreign && (
        <p
          data-testid="source.partial-warning"
          className="border-border bg-muted mt-2 rounded border p-2 text-xs"
        >
          Edits apply to every template that uses this partial ({origin.fileName}).
        </p>
      )}
      {!available ? (
        <p data-testid="source.unavailable" className="text-muted-foreground mt-2 text-xs">
          {unavailableReason({
            busy: pending !== null || saving || lifecycleBusy,
            file: foreign ? origin.fileName : null,
            project: project.status,
            resolved: target !== null,
          })}
        </p>
      ) : (
        <>
          {target.properties.length === 0 && (
            <p className="text-muted-foreground mt-2 text-xs">
              No unambiguous scalar properties here. Use source or the agent for this shape.
            </p>
          )}
          {target.hasSpread && (
            <p className="text-muted-foreground mt-2 text-xs">
              Spread properties can override attributes here. Edit attributes in Source or ask the
              agent.
            </p>
          )}
          {target.properties
            .filter((field) => !target.hasSpread || field.syntax === "child")
            .map((field) => (
              <PropertyControl
                key={`${doc.rev}:${source}:${scope}:${field.name}`}
                field={field}
                source={source}
                apply={apply}
                propose={(edit) => setProposal(check([edit]))}
              />
            ))}
          {classRefusal !== null && (
            <p data-testid="source.class-refusal" className="text-muted-foreground mt-3 text-xs">
              {classRefusal}
            </p>
          )}
          {classRefusal === null && (
            <div className="mt-3">
              <label className="block text-xs">
                {className === undefined ? "Style classes · literal" : "Add style classes"}
                <input
                  aria-label="Style classes"
                  data-testid="source.classes"
                  className={inputClass}
                  value={classes}
                  onChange={(event) => setClasses(event.target.value)}
                />
              </label>
              <button
                data-testid="source.classes-add"
                type="button"
                className={buttonClass}
                disabled={classes.trim() === ""}
                onClick={() => {
                  const edit = classNameEdit(source, target, { kind: "add", tokens: classes });
                  if (edit.ok) commit(edit.edits);
                  else setLocalError(edit.reason);
                  setClasses("");
                }}
              >
                {className === undefined ? "Apply styles" : "Add classes"}
              </button>
            </div>
          )}
          <details className="mt-3">
            <summary data-testid="source.structure-toggle" className="cursor-pointer text-xs">
              Structure · authored block
            </summary>
            <p className="text-muted-foreground my-2 text-xs">
              This changes the whole source block at the scope above. A rendered loop instance has
              no independent source block. Change fixture items separately; edit loop or conditional
              logic in Source.
            </p>
            <textarea
              aria-label="Insert TSX"
              data-testid="source.insert"
              value={insert}
              className={inputClass}
              onChange={(event) => setInsert(event.target.value)}
            />
            <button
              data-testid={"source.review-insert"}
              type="button"
              className={buttonClass}
              disabled={target.contentEnd === null}
              onClick={() => {
                const edits = structuralReplacements(source, target, {
                  kind: "insert",
                  tsx: insert,
                });
                setStructuralProposal(edits === null ? null : check(edits));
              }}
            >
              Review insert
            </button>{" "}
            <button
              data-testid={"source.review-delete"}
              type="button"
              className={buttonClass}
              disabled={!target.structural}
              onClick={() => {
                const edits = structuralReplacements(source, target, { kind: "delete" });
                setStructuralProposal(edits === null ? null : check(edits));
              }}
            >
              Review delete
            </button>{" "}
            <button
              data-testid={"source.review-duplicate"}
              type="button"
              className={buttonClass}
              disabled={!target.structural}
              onClick={() => {
                const edits = structuralReplacements(source, target, { kind: "duplicate" });
                setStructuralProposal(edits === null ? null : check(edits));
              }}
            >
              Review duplicate
            </button>{" "}
            <button
              data-testid={"source.review-move-up"}
              type="button"
              className={buttonClass}
              disabled={target.previous === null}
              onClick={() => {
                const edits = structuralReplacements(source, target, {
                  kind: "reorder",
                  direction: "before",
                });
                setStructuralProposal(edits === null ? null : check(edits));
              }}
            >
              Move earlier
            </button>{" "}
            <button
              data-testid={"source.review-move-down"}
              type="button"
              className={buttonClass}
              disabled={target.next === null}
              onClick={() => {
                const edits = structuralReplacements(source, target, {
                  kind: "reorder",
                  direction: "after",
                });
                setStructuralProposal(edits === null ? null : check(edits));
              }}
            >
              Move later
            </button>
            {!foreign && (
              <>
                <label className="mt-2 block text-xs">
                  Move into shared source container
                  <select
                    aria-label="Move destination"
                    data-testid="source.destination"
                    value={destination}
                    className={inputClass}
                    onChange={(event) => setDestination(event.target.value)}
                  >
                    <option value="">Choose destination</option>
                    {doc.channel === "email" &&
                      doc.render?.selections.map((entry) => (
                        <option key={entry.instancePath} value={entry.instancePath}>
                          {entry.tag} · {entry.instancePath} ·{" "}
                          {entry.origins[0] === undefined
                            ? "generated"
                            : formatOrigin(entry.origins[0])}
                        </option>
                      ))}
                  </select>
                </label>
                <button
                  data-testid={"source.review-move"}
                  type="button"
                  className={buttonClass}
                  disabled={!target.structural || destination === ""}
                  onClick={() => {
                    const entry =
                      doc.channel === "email"
                        ? doc.render?.selections.find(
                            (candidate) => candidate.instancePath === destination,
                          )
                        : undefined;
                    const location = entry?.origins[0];
                    const container =
                      location === undefined
                        ? null
                        : inspectSourceElement(source, entryFile, location);
                    const edits =
                      container === null
                        ? null
                        : structuralReplacements(source, target, {
                            kind: "move",
                            destination: container,
                          });
                    setStructuralProposal(edits === null ? null : check(edits));
                    setStructureError(
                      edits === null
                        ? "This destination cannot accept the selected block. Choose another source container or use Source."
                        : null,
                    );
                  }}
                >
                  Review move
                </button>
              </>
            )}
            {structureError !== null && (
              <p role="alert" className="text-status-error text-xs">
                {structureError}
              </p>
            )}
            {structuralProposal !== null && (
              <div role="region" aria-label="Structural source diff" className="mt-2">
                <pre className="bg-muted overflow-auto p-2 text-xs">
                  {structuralProposal.edits
                    .map((edit) => `- ${edit.before}\n+ ${edit.after}`)
                    .join("\n")}
                </pre>
                {structuralProposal.refusal !== null && (
                  <p data-testid="source.structure-refusal" className="text-status-error text-xs">
                    {structuralProposal.refusal}
                  </p>
                )}
                <button
                  data-testid={"source.apply-structure"}
                  type="button"
                  className={buttonClass}
                  disabled={structuralProposal.refusal !== null}
                  onClick={() => {
                    commit(structuralProposal.edits);
                    setStructuralProposal(null);
                  }}
                >
                  Apply structural change
                </button>{" "}
                <button
                  type="button"
                  className={buttonClass}
                  onClick={() => setStructuralProposal(null)}
                >
                  Cancel
                </button>
              </div>
            )}
          </details>
          {proposal !== null && (
            <div role="region" aria-label="Proposed source diff" className="mt-3 space-y-2">
              <p className="text-xs">Review the exact source change</p>
              <pre className="bg-muted overflow-auto p-2 text-xs">
                {proposal.edits.map((edit) => `- ${edit.before}\n+ ${edit.after}`).join("\n")}
              </pre>
              {proposal.refusal !== null && (
                <p data-testid="source.proposal-refusal" className="text-status-error text-xs">
                  {proposal.refusal}
                </p>
              )}
              <button
                data-testid={"source.apply-reviewed"}
                type="button"
                className={buttonClass}
                disabled={proposal.refusal !== null}
                onClick={() => {
                  commit(proposal.edits);
                  setProposal(null);
                }}
              >
                Apply reviewed change
              </button>{" "}
              <button type="button" className={buttonClass} onClick={() => setProposal(null)}>
                Cancel
              </button>
            </div>
          )}
        </>
      )}
      {shownError !== null && (
        <p data-testid="source.edit-error" className="text-status-error mt-2 text-xs">
          {shownError}
        </p>
      )}
      <div className="mt-3 flex gap-2">
        <button type="button" className={buttonClass} onClick={openSource}>
          Open source
        </button>
        {assistantDocked && (
          <button
            type="button"
            className={buttonClass}
            onClick={() => requestSourceAssistance(scope)}
          >
            Ask agent
          </button>
        )}
      </div>
    </div>
  );
}

export function SourceHistory() {
  const { undo, redo, error, editable } = useEditorStore(
    useShallow((state) => ({
      undo: state.undoHistory.length,
      redo: state.redoHistory.length,
      error: state.sourceEditError,
      editable: state.sourceEditable,
    })),
  );
  const actions = useEditorStore((state) => state.actions);
  return (
    <div className="border-border border-b px-3 py-1.5">
      <div className="flex gap-2">
        <button
          data-testid={"source.undo"}
          type="button"
          className={buttonClass}
          disabled={!editable || undo === 0}
          onClick={actions.undo}
        >
          Undo
        </button>
        <button
          data-testid={"source.redo"}
          type="button"
          className={buttonClass}
          disabled={!editable || redo === 0}
          onClick={actions.redo}
        >
          Redo
        </button>
      </div>
      {error !== null && (
        <p role="alert" className="text-status-error mt-1 text-xs">
          {error}
        </p>
      )}
    </div>
  );
}

/** Editing a declared fixture changes example input, never the render function. */
function FixtureSourceSession() {
  const doc = useEditorStore((state) => state.doc);
  const pending = useEditorStore((state) => state.pendingAuthoredSource);
  const editable = useEditorStore((state) => state.sourceEditable);
  const { applySourceEdit, openSource } = useEditorStore((state) => state.actions);
  const [draft, setDraft] = useState<string | null>(null);
  const [review, setReview] = useState(false);
  if (doc?.channel !== "email") return null;
  const fixture = inspectSourceFixtures(doc.origin.authoredSource).find(
    (entry) => entry.name === doc.fixture,
  );
  return (
    <div className="border-border-subtle border-b py-3">
      <GroupLabel>Fixture data · {doc.fixture}</GroupLabel>
      <p className="text-muted-foreground text-xs">
        Example input for this fixture. Changes do not replace template bindings or change other
        fixtures.
      </p>
      {fixture === undefined ? (
        <button type="button" className={buttonClass} onClick={openSource}>
          Open fixture source
        </button>
      ) : (
        <>
          <textarea
            aria-label="Fixture data source"
            data-testid="source.fixture-data"
            className={inputClass}
            value={draft ?? fixture.source}
            onChange={(event) => {
              setDraft(event.target.value);
              setReview(false);
            }}
            disabled={!editable || pending !== null}
          />
          <button
            data-testid={"source.fixture-review"}
            type="button"
            className={buttonClass}
            disabled={!editable || pending !== null || draft === null}
            onClick={() => setReview(true)}
          >
            Review fixture change
          </button>
          {review && draft !== null && (
            <div>
              <pre className="bg-muted overflow-auto p-2 text-xs">{`- ${fixture.source}\n+ ${draft}`}</pre>
              <button
                data-testid={"source.fixture-apply"}
                type="button"
                className={buttonClass}
                onClick={() => {
                  applySourceEdit({
                    revision: doc.rev,
                    source: doc.origin.authoredSource,
                    edits: [
                      {
                        start: fixture.start,
                        end: fixture.end,
                        before: fixture.source,
                        after: draft,
                      },
                    ],
                  });
                  setDraft(null);
                  setReview(false);
                }}
              >
                Apply fixture change
              </button>{" "}
              <button
                type="button"
                className={buttonClass}
                onClick={() => {
                  setDraft(null);
                  setReview(false);
                }}
              >
                Cancel
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function SourceControls({ selection }: { readonly selection: EmailElementSelection }) {
  const identity = useEditorStore(
    (state) =>
      `${state.doc?.rev}:${state.doc?.origin.authoredSource}:${state.doc?.channel === "email" ? state.doc.fixture : ""}`,
  );
  return <SourceControlsSession key={identity} selection={selection} />;
}

export function FixtureSourceControls() {
  const identity = useEditorStore(
    (state) =>
      `${state.doc?.rev}:${state.doc?.origin.authoredSource}:${state.doc?.channel === "email" ? state.doc.fixture : ""}`,
  );
  return <FixtureSourceSession key={identity} />;
}
