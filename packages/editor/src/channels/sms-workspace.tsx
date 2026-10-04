import { Select } from "@base-ui/react/select";
import {
  editSmsChannel,
  readSmsChannel,
  type ChannelSegment,
  type SmsChannelForm,
} from "@samva/markup/edit";
import type { SmsCategory } from "@samva/markup/sms";
import { useMemo, useRef, useState } from "react";

import { AssistantRail } from "../chrome/assistant-rail";
import { fieldClass } from "../chrome/ui-classes";
import { useEditorPortalContainer } from "../chrome/use-editor-portal";
import { useEditorStore } from "../state/context";
import { SMS_CATEGORY_OPTIONS } from "./options";
import { SourceWorkspace } from "./source-workspace";
import { useChannelEdit } from "./use-channel-edit";
import {
  Diagnostics,
  EditRefusal,
  Field,
  LockedRegion,
  SmsCounter,
  VariableList,
  WorkspaceTabs,
  type WorkspaceView,
} from "./workspace-ui";

const CATEGORY_NONE = "none";

type SmsChange = Parameters<typeof editSmsChannel>[1];

function SmsPreviewEditor({
  segments,
  editable,
  onChange,
}: {
  readonly segments: ReadonlyArray<ChannelSegment>;
  readonly editable: boolean;
  readonly onChange: (segment: number, text: string) => void;
}) {
  const composing = useRef(false);

  return (
    <div className="bg-muted text-foreground rounded-[18px] px-4 py-3 text-[14px] whitespace-pre-wrap">
      {segments.map((segment, index) =>
        segment.kind === "locked" ? (
          <span
            key={`locked-${index}`}
            contentEditable={false}
            title="Locked structure — edit in Source"
            data-testid="sms-workspace.locked-segment"
            className="border-border bg-surface-inset text-muted-foreground mx-0.5 inline-flex rounded-md border border-dashed px-1.5 py-0.5 font-mono text-[11.5px]"
          >
            {segment.summary}
          </span>
        ) : (
          <span
            key={`text-${index}`}
            role="textbox"
            aria-label={`SMS message preview segment ${index + 1}`}
            data-testid={`sms-workspace.preview-segment.${index + 1}`}
            aria-multiline="true"
            contentEditable={editable ? "plaintext-only" : false}
            suppressContentEditableWarning
            onCompositionStart={() => {
              composing.current = true;
            }}
            onCompositionEnd={(event) => {
              composing.current = false;
              onChange(index, event.currentTarget.textContent ?? "");
            }}
            onInput={(event) => {
              if (!composing.current) onChange(index, event.currentTarget.textContent ?? "");
            }}
            className="focus:bg-background focus-visible:ring-ring/50 rounded-sm outline-none focus-visible:ring-[3px]"
          >
            {segment.text}
          </span>
        ),
      )}
    </div>
  );
}

function SmsForm({
  form,
  editable,
  onEdit,
}: {
  readonly form: SmsChannelForm;
  readonly editable: boolean;
  readonly onEdit: (change: SmsChange, key?: string) => void;
}) {
  const portalContainer = useEditorPortalContainer();
  const category = form.category.kind === "literal" ? form.category.value : undefined;
  return (
    <div className="grid gap-4">
      <Field label="Category">
        <Select.Root
          value={category ?? CATEGORY_NONE}
          disabled={!editable || form.category.kind === "expression"}
          onValueChange={(value) =>
            onEdit({
              kind: "category",
              value: SMS_CATEGORY_OPTIONS.find((option) => option.value === value)?.value as
                | SmsCategory
                | undefined,
            })
          }
        >
          <Select.Trigger data-testid="sms-workspace.category" className={fieldClass}>
            <Select.Value />
          </Select.Trigger>
          <Select.Portal container={portalContainer}>
            <Select.Positioner sideOffset={4} className="z-[120]">
              <Select.Popup className="samva-editor-shell border-border bg-surface-elevated min-w-[var(--anchor-width)] rounded-lg border p-1 shadow-[var(--shadow-lg)]">
                <Select.Item
                  value={CATEGORY_NONE}
                  data-testid="sms-workspace.category-option.none"
                  className="data-highlighted:bg-muted rounded-md px-2.5 py-1.5 text-[13px] outline-none"
                >
                  <Select.ItemText>Not set</Select.ItemText>
                </Select.Item>
                {SMS_CATEGORY_OPTIONS.map((option) => (
                  <Select.Item
                    key={option.value}
                    value={option.value}
                    data-testid={`sms-workspace.category-option.${option.value}`}
                    className="data-highlighted:bg-muted rounded-md px-2.5 py-1.5 text-[13px] outline-none"
                  >
                    <Select.ItemText>{option.label}</Select.ItemText>
                  </Select.Item>
                ))}
              </Select.Popup>
            </Select.Positioner>
          </Select.Portal>
        </Select.Root>
      </Field>
      <div className="grid gap-2">
        <span className="text-[12.5px] font-medium">Message body</span>
        {form.segments.map((segment, index) =>
          segment.kind === "locked" ? (
            <LockedRegion key={`locked-${index}`} summary={segment.summary} />
          ) : (
            <textarea
              key={`text-${index}`}
              aria-label={`Message body segment ${index + 1}`}
              data-testid={`sms-workspace.body-segment.${index + 1}`}
              value={segment.text}
              disabled={!editable}
              onChange={(event) =>
                onEdit({ kind: "text", segment: index, text: event.target.value }, `sms-${index}`)
              }
              rows={5}
              className={`${fieldClass} resize-y py-2`}
            />
          ),
        )}
      </div>
      <VariableList variables={form.variables} />
    </div>
  );
}

/** Shared SMS form, build diagnostics, segment preview, and raw source surface. */
export function SmsWorkspace() {
  const doc = useEditorStore((state) => state.doc);
  const editable = useEditorStore((state) => state.sourceEditable);
  const refusal = useEditorStore((state) => state.sourceEditError);
  const [view, setView] = useState<WorkspaceView>("visual");
  const edit = useChannelEdit(editSmsChannel);
  const authoredSource = doc?.origin.authoredSource ?? "";
  const form = useMemo(() => readSmsChannel(authoredSource), [authoredSource]);
  const render = doc?.channel === "sms" ? doc.render : null;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <WorkspaceTabs value={view} onChange={setView}>
        {view === "source" ? (
          <SourceWorkspace />
        ) : (
          <div className="flex min-h-0 min-w-0 flex-1">
            <aside className="samva-editor-scroll border-border bg-background w-[380px] shrink-0 overflow-y-auto border-r p-4">
              <div className="grid gap-4">
                <Diagnostics diagnostics={doc?.diagnostics ?? []} />
                <EditRefusal reason={refusal} />
                {form === null ? (
                  <p className="text-muted-foreground text-[12.5px]">
                    The SMS body is not a <code>{"<Sms>"}</code> written in place, so it is edited
                    in Source.
                  </p>
                ) : (
                  <SmsForm form={form} editable={editable} onEdit={edit} />
                )}
              </div>
            </aside>
            <main className="samva-editor-workspace samva-editor-scroll min-w-0 flex-1 overflow-auto p-8">
              <div className="border-border bg-background mx-auto max-w-[420px] rounded-[28px] border p-5 shadow-[var(--shadow-lg)]">
                <div
                  data-testid="sms-workspace.preview-heading"
                  className="border-border-subtle text-muted-foreground mb-5 border-b pb-3 text-center text-[12px] font-medium"
                >
                  SMS preview
                </div>
                {form === null ? (
                  <div className="bg-muted text-muted-foreground rounded-[18px] px-4 py-3 text-[14px] whitespace-pre-wrap">
                    {render?.text || "Message preview"}
                  </div>
                ) : (
                  <SmsPreviewEditor
                    segments={form.segments}
                    editable={editable}
                    onChange={(segment, text) =>
                      edit({ kind: "text", segment, text }, `sms-${segment}`)
                    }
                  />
                )}
                {render !== null && (
                  <SmsCounter text={render.text} className="mt-4 text-center text-[11.5px]" />
                )}
              </div>
            </main>
            <AssistantRail />
          </div>
        )}
      </WorkspaceTabs>
    </div>
  );
}
