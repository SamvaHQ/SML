import { Select } from "@base-ui/react/select";
import type { WhatsAppRender } from "@samva/editor/host";
import {
  editWhatsAppChannel,
  readWhatsAppChannel,
  type AttributeState,
  type ChannelSegment,
  type WhatsAppButtonKind,
  type WhatsAppButtonRow,
  type WhatsAppChannelForm,
  type WhatsAppPart,
} from "@samva/markup/edit";
import { useMemo, useState } from "react";

import { AssistantRail } from "../chrome/assistant-rail";
import { fieldClass } from "../chrome/ui-classes";
import { useEditorPortalContainer } from "../chrome/use-editor-portal";
import { useEditorStore } from "../state/context";
import {
  WHATSAPP_BUTTON_TYPE_OPTIONS,
  WHATSAPP_CATEGORY_OPTIONS,
  WHATSAPP_HEADER_TYPE_OPTIONS,
} from "./options";
import { SourceWorkspace } from "./source-workspace";
import { useChannelEdit } from "./use-channel-edit";
import {
  Diagnostics,
  EditRefusal,
  Field,
  LockedChip,
  LockedRegion,
  VariableList,
  WorkspaceTabs,
  type WorkspaceView,
} from "./workspace-ui";

type WhatsAppChange = Parameters<typeof editWhatsAppChannel>[1];
type OnEdit = (change: WhatsAppChange, key?: string) => void;

/** What an absent header or footer shows: one empty text box that creates the part when typed in. */
const EMPTY_PART: ReadonlyArray<ChannelSegment> = [{ kind: "text", text: "", start: 0, end: 0 }];

const literalOf = (state: AttributeState): string =>
  state.kind === "literal" ? state.value : state.kind === "expression" ? state.source : "";

interface OptionSelectProps<T extends string> {
  readonly value: T;
  readonly options: ReadonlyArray<{ readonly value: T; readonly label: string }>;
  readonly disabled: boolean;
  readonly ariaLabel?: string | undefined;
  readonly onChange: (value: T) => void;
}

function OptionSelect<T extends string>({
  value,
  options,
  disabled,
  ariaLabel,
  onChange,
}: OptionSelectProps<T>) {
  const portalContainer = useEditorPortalContainer();
  return (
    <Select.Root
      value={value}
      disabled={disabled}
      onValueChange={(next) => {
        const option = options.find((candidate) => candidate.value === next);
        if (option !== undefined) onChange(option.value);
      }}
    >
      <Select.Trigger aria-label={ariaLabel} className={fieldClass}>
        <Select.Value />
      </Select.Trigger>
      <Select.Portal container={portalContainer}>
        <Select.Positioner sideOffset={4} className="z-[120]">
          <Select.Popup className="samva-editor-shell border-border bg-surface-elevated min-w-[var(--anchor-width)] rounded-lg border p-1 shadow-[var(--shadow-lg)]">
            {options.map((option) => (
              <Select.Item
                key={option.value}
                value={option.value}
                className="data-highlighted:bg-muted rounded-md px-2.5 py-1.5 text-[13px] outline-none"
              >
                <Select.ItemText>{option.label}</Select.ItemText>
              </Select.Item>
            ))}
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
}

/** A header or footer: its text and any locked expressions, in order. */
function SlotField({
  label,
  part,
  segments,
  editable,
  onEdit,
}: {
  readonly label: string;
  readonly part: WhatsAppPart;
  readonly segments: ReadonlyArray<ChannelSegment> | null;
  readonly editable: boolean;
  readonly onEdit: OnEdit;
}) {
  const list = segments ?? EMPTY_PART;
  const testId = `whatsapp-workspace.slot.${label.toLowerCase()}`;
  return (
    <div className="grid gap-1.5 text-[12.5px]">
      <span className="text-foreground font-medium">{label}</span>
      <div className="flex flex-wrap items-center gap-1.5">
        {list.map((segment, index) =>
          segment.kind === "locked" ? (
            <LockedChip key={`locked-${index}`} summary={segment.summary} />
          ) : (
            <input
              key={`text-${index}`}
              aria-label={index === 0 ? label : `${label} ${index + 1}`}
              value={segment.text}
              disabled={!editable}
              data-testid={index === 0 ? testId : `${testId}.${index + 1}`}
              onChange={(event) =>
                onEdit(
                  { kind: "text", part, segment: index, text: event.target.value },
                  `whatsapp-${part}-${index}`,
                )
              }
              className={`${fieldClass} min-w-[8ch] flex-1`}
            />
          ),
        )}
      </div>
    </div>
  );
}

function AttributeInput({
  ariaLabel,
  state,
  editable,
  onChange,
  testId,
}: {
  readonly ariaLabel: string;
  readonly state: AttributeState;
  readonly editable: boolean;
  readonly onChange: (value: string) => void;
  readonly testId?: string | undefined;
}) {
  return (
    <input
      aria-label={ariaLabel}
      data-testid={testId}
      value={literalOf(state)}
      disabled={!editable || state.kind === "expression"}
      title={state.kind === "expression" ? "Read from the input. Edit it in Source." : undefined}
      onChange={(event) => onChange(event.target.value)}
      className={fieldClass}
    />
  );
}

function ButtonFields({
  buttons,
  editable,
  onEdit,
}: {
  readonly buttons: ReadonlyArray<WhatsAppButtonRow>;
  readonly editable: boolean;
  readonly onEdit: OnEdit;
}) {
  const [newType, setNewType] = useState<WhatsAppButtonKind>("quick-reply");
  return (
    <div className="grid gap-2">
      <span className="text-[12.5px] font-medium">Buttons</span>
      {buttons.map((button, index) =>
        button.kind === "locked" ? (
          <LockedRegion key={`locked-${index}`} summary={button.summary} />
        ) : (
          <div key={`button-${index}`} className="border-border grid gap-2 rounded-lg border p-3">
            <OptionSelect
              value={button.type}
              options={WHATSAPP_BUTTON_TYPE_OPTIONS}
              disabled={!editable}
              ariaLabel={`Button ${index + 1} type`}
              onChange={(type) => onEdit({ kind: "buttonType", button: index, type })}
            />
            <input
              aria-label={`Button ${index + 1} label`}
              value={button.text}
              disabled={!editable}
              onChange={(event) =>
                onEdit(
                  { kind: "buttonText", button: index, text: event.target.value },
                  `whatsapp-button-${index}-text`,
                )
              }
              className={fieldClass}
            />
            {button.type === "url" && (
              <AttributeInput
                ariaLabel={`Button ${index + 1} URL`}
                state={button.url}
                editable={editable}
                onChange={(value) =>
                  onEdit(
                    { kind: "buttonAttribute", button: index, name: "url", value },
                    `whatsapp-button-${index}-url`,
                  )
                }
              />
            )}
            {button.type === "phone" && (
              <AttributeInput
                ariaLabel={`Button ${index + 1} phone`}
                state={button.phone}
                editable={editable}
                onChange={(value) =>
                  onEdit(
                    { kind: "buttonAttribute", button: index, name: "phone", value },
                    `whatsapp-button-${index}-phone`,
                  )
                }
              />
            )}
            {editable && (
              <button
                type="button"
                aria-label={`Remove button ${index + 1}`}
                onClick={() => onEdit({ kind: "buttonRemove", button: index })}
                className="text-muted-foreground hover:text-status-error justify-self-end text-[11.5px]"
              >
                Remove
              </button>
            )}
          </div>
        ),
      )}
      {editable && (
        <div className="flex gap-2">
          <OptionSelect
            value={newType}
            options={WHATSAPP_BUTTON_TYPE_OPTIONS}
            disabled={false}
            ariaLabel="New button type"
            onChange={setNewType}
          />
          <button
            type="button"
            data-testid="whatsapp-workspace.add-button"
            onClick={() => onEdit({ kind: "buttonAdd", type: newType })}
            className="border-border hover:bg-muted shrink-0 rounded-lg border px-3 text-[12px]"
          >
            Add
          </button>
        </div>
      )}
    </div>
  );
}

function WhatsAppForm({
  form,
  editable,
  onEdit,
}: {
  readonly form: WhatsAppChannelForm;
  readonly editable: boolean;
  readonly onEdit: OnEdit;
}) {
  const category = literalOf(form.category);
  const headerType = form.headerType.kind === "literal" ? form.headerType.value : "text";
  return (
    <div className="grid gap-4">
      <Field label="Template name">
        <AttributeInput
          ariaLabel="Template name"
          testId="whatsapp-workspace.name"
          state={form.name}
          editable={editable}
          onChange={(value) => onEdit({ kind: "attribute", name: "name", value }, "whatsapp-name")}
        />
      </Field>
      <Field label="Language">
        <AttributeInput
          ariaLabel="Language"
          state={form.language}
          editable={editable}
          onChange={(value) =>
            onEdit({ kind: "attribute", name: "language", value }, "whatsapp-language")
          }
        />
      </Field>
      <Field label="Category">
        <OptionSelect
          value={category as (typeof WHATSAPP_CATEGORY_OPTIONS)[number]["value"]}
          options={WHATSAPP_CATEGORY_OPTIONS}
          disabled={!editable || form.category.kind !== "literal"}
          onChange={(value) => onEdit({ kind: "attribute", name: "category", value })}
        />
      </Field>
      <Field label="Header type">
        <OptionSelect
          value={headerType as (typeof WHATSAPP_HEADER_TYPE_OPTIONS)[number]["value"]}
          options={WHATSAPP_HEADER_TYPE_OPTIONS}
          disabled={!editable || form.header === null || form.headerType.kind === "expression"}
          onChange={(value) => onEdit({ kind: "headerType", value })}
        />
      </Field>
      <SlotField
        label="Header"
        part="header"
        segments={form.header}
        editable={editable}
        onEdit={onEdit}
      />
      <div className="grid gap-2">
        <span className="text-[12.5px] font-medium">Body</span>
        {form.body.map((segment, index) =>
          segment.kind === "locked" ? (
            <LockedRegion key={`body-locked-${index}`} summary={segment.summary} />
          ) : (
            <textarea
              key={`body-text-${index}`}
              aria-label={`Body segment ${index + 1}`}
              data-testid={`whatsapp-workspace.body.${index + 1}`}
              value={segment.text}
              disabled={!editable}
              onChange={(event) =>
                onEdit(
                  { kind: "text", part: "body", segment: index, text: event.target.value },
                  `whatsapp-body-${index}`,
                )
              }
              rows={4}
              className={`${fieldClass} resize-y py-2`}
            />
          ),
        )}
      </div>
      <SlotField
        label="Footer"
        part="footer"
        segments={form.footer}
        editable={editable}
        onEdit={onEdit}
      />
      <ButtonFields buttons={form.buttons} editable={editable} onEdit={onEdit} />
      <VariableList variables={form.variables} />
    </div>
  );
}

function PreviewSlot({
  label,
  part,
  segments,
  editable,
  placeholder,
  className,
  onEdit,
}: {
  readonly label: string;
  readonly part: WhatsAppPart;
  readonly segments: ReadonlyArray<ChannelSegment> | null;
  readonly editable: boolean;
  readonly placeholder: string;
  readonly className: string;
  readonly onEdit: OnEdit;
}) {
  const list = segments ?? EMPTY_PART;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {list.map((segment, index) =>
        segment.kind === "locked" ? (
          <LockedChip key={`locked-${index}`} summary={segment.summary} />
        ) : (
          <input
            key={`text-${index}`}
            aria-label={index === 0 ? `${label} preview` : `${label} preview ${index + 1}`}
            data-testid={
              index === 0
                ? `whatsapp-workspace.preview.${label.toLowerCase()}`
                : `whatsapp-workspace.preview.${label.toLowerCase()}.${index + 1}`
            }
            value={segment.text}
            readOnly={!editable}
            placeholder={placeholder}
            onChange={(event) =>
              onEdit(
                { kind: "text", part, segment: index, text: event.target.value },
                `whatsapp-${part}-${index}`,
              )
            }
            className={`placeholder:text-muted-foreground/60 min-w-0 flex-1 bg-transparent outline-none ${className} ${editable ? "focus-visible:ring-ring/50 rounded-sm focus-visible:ring-2" : "cursor-default"}`}
          />
        ),
      )}
    </div>
  );
}

const buttonLabel = (button: WhatsAppRender["buttons"][number]): string =>
  button.type === "copy-code" ? "Copy code" : button.text;

function WhatsAppPreview({
  form,
  editable,
  render,
  onEdit,
}: {
  readonly form: WhatsAppChannelForm;
  readonly editable: boolean;
  readonly render: WhatsAppRender | null;
  readonly onEdit: OnEdit;
}) {
  const headerType = form.headerType.kind === "literal" ? form.headerType.value : "text";
  return (
    <div className="border-border mx-auto max-w-[420px] rounded-[28px] border bg-[#e9e2d8] p-5 shadow-[var(--shadow-lg)] dark:bg-[#0b141a]">
      <div
        data-testid="whatsapp-workspace.preview-heading"
        className="text-muted-foreground mb-4 text-center text-[12px] font-medium"
      >
        WhatsApp business preview
      </div>
      <div className="bg-background rounded-xl px-3.5 py-3 shadow-[var(--shadow-sm)]">
        <PreviewSlot
          label="Header"
          part="header"
          segments={form.header}
          editable={editable && headerType === "text"}
          placeholder={headerType === "text" ? "Add header" : `${headerType} header`}
          className="mb-1 font-semibold"
          onEdit={onEdit}
        />
        <div className="grid gap-1">
          {form.body.map((segment, index) =>
            segment.kind === "locked" ? (
              <LockedChip key={`body-locked-${index}`} summary={segment.summary} />
            ) : (
              <textarea
                key={`body-text-${index}`}
                aria-label={`Body preview segment ${index + 1}`}
                data-testid={`whatsapp-workspace.body-preview.${index + 1}`}
                value={segment.text}
                readOnly={!editable}
                placeholder="Write your message"
                rows={Math.max(1, segment.text.split("\n").length)}
                onChange={(event) =>
                  onEdit(
                    { kind: "text", part: "body", segment: index, text: event.target.value },
                    `whatsapp-body-${index}`,
                  )
                }
                className={`placeholder:text-muted-foreground/60 min-h-5 w-full resize-none overflow-hidden bg-transparent text-[14px] whitespace-pre-wrap outline-none ${editable ? "focus-visible:ring-ring/50 rounded-sm focus-visible:ring-2" : "cursor-default"}`}
              />
            ),
          )}
        </div>
        <PreviewSlot
          label="Footer"
          part="footer"
          segments={form.footer}
          editable={editable}
          placeholder="Add footer"
          className="text-muted-foreground mt-2 text-[11.5px]"
          onEdit={onEdit}
        />
        {(render?.buttons ?? []).map((button, index) => (
          <div
            key={`${buttonLabel(button)}-${index}`}
            className="border-border-subtle text-accent-email mt-2 border-t pt-2 text-center text-[12px]"
          >
            {buttonLabel(button)}
          </div>
        ))}
      </div>
      <p className="text-muted-foreground mt-4 text-center text-[11.5px] capitalize">
        {render?.category ?? (literalOf(form.category) || "utility")} template
      </p>
    </div>
  );
}

/** Shared WhatsApp form and preview. Expressions and conditionals are visible locks, never rewritten. */
export function WhatsAppWorkspace() {
  const doc = useEditorStore((state) => state.doc);
  const editable = useEditorStore((state) => state.sourceEditable);
  const refusal = useEditorStore((state) => state.sourceEditError);
  const [view, setView] = useState<WorkspaceView>("visual");
  const edit = useChannelEdit(editWhatsAppChannel);
  const authoredSource = doc?.origin.authoredSource ?? "";
  const form = useMemo(() => readWhatsAppChannel(authoredSource), [authoredSource]);
  const render = doc?.channel === "whatsapp" ? doc.render : null;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <WorkspaceTabs value={view} onChange={setView}>
        {view === "source" ? (
          <SourceWorkspace />
        ) : (
          <div className="flex min-h-0 min-w-0 flex-1">
            <aside className="samva-editor-scroll border-border bg-background w-[400px] shrink-0 overflow-y-auto border-r p-4">
              <div className="grid gap-4">
                <Diagnostics diagnostics={doc?.diagnostics ?? []} />
                <EditRefusal reason={refusal} />
                {form === null ? (
                  <p className="text-muted-foreground text-[12.5px]">
                    The WhatsApp body is not a <code>{"<WhatsApp>"}</code> written in place with a
                    body, so it is edited in Source.
                  </p>
                ) : (
                  <WhatsAppForm form={form} editable={editable} onEdit={edit} />
                )}
              </div>
            </aside>
            <main className="samva-editor-workspace samva-editor-scroll min-w-0 flex-1 overflow-auto p-8">
              {form !== null && (
                <WhatsAppPreview form={form} editable={editable} render={render} onEdit={edit} />
              )}
            </main>
            <AssistantRail />
          </div>
        )}
      </WorkspaceTabs>
    </div>
  );
}
