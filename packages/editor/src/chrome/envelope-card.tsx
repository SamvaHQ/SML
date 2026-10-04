import { Collapsible } from "@base-ui/react/collapsible";
import { useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";

import { useEditorStore } from "../state/context";
import { ChevronDown, ChevronUp } from "./editor-icons";
import { cn } from "./ui-classes";

const fromLabel = (from: { email: string; name?: string | undefined } | undefined): string =>
  from === undefined
    ? "No default sender"
    : from.name
      ? `${from.name} <${from.email}>`
      : from.email;

function DefaultTag() {
  return (
    <span
      title="Overridable per send"
      className="border-border-subtle text-placeholder shrink-0 rounded-full border px-2 py-px text-[10px]"
    >
      default
    </span>
  );
}

function EnvelopeValue({
  value,
  placeholder,
  testId,
}: {
  value: string;
  placeholder: string;
  testId?: string | undefined;
}) {
  return (
    <span data-testid={testId} className="text-foreground min-w-0 flex-1 truncate">
      {value.length > 0 ? value : <span className="text-placeholder">{placeholder}</span>}
    </span>
  );
}

/**
 * The envelope card sits above the rendered email in the canvas column: the two
 * template-default rows (From / Reply-To, muted) over the two rendered rows
 * (Subject / Preview). Clicking it selects the envelope scope, which swaps the
 * inspector to the envelope panel. Subject and preview text come from the render,
 * so they are shown, not typed: the template code is where they are written.
 */
export function EnvelopeCard() {
  const { doc, render, selected, layoutMode } = useEditorStore(
    useShallow((state) => ({
      doc: state.doc,
      render: state.render,
      selected: state.selection.kind === "envelope",
      layoutMode: state.layoutMode,
    })),
  );
  const { selectEnvelope } = useEditorStore((state) => state.actions);
  const [expanded, setExpanded] = useState(false);
  const expandTriggerRef = useRef<HTMLButtonElement>(null);
  const restoreExpandFocusRef = useRef(false);
  const from = doc?.metadata.fromDefault;
  const replyTo = doc?.metadata.replyToDefault ?? [];
  const subject = render?.subject ?? "";
  const preheader = render?.preheader ?? "";
  const compact = layoutMode === "compact" || layoutMode === "narrow";

  useEffect(() => {
    if (compact && !expanded && restoreExpandFocusRef.current) {
      restoreExpandFocusRef.current = false;
      expandTriggerRef.current?.focus();
    }
  }, [compact, expanded]);

  return (
    <Collapsible.Root
      open={!compact || expanded}
      onOpenChange={(open) => {
        if (!open) restoreExpandFocusRef.current = true;
        setExpanded(open);
      }}
    >
      {compact && !expanded && (
        <Collapsible.Trigger
          ref={expandTriggerRef}
          aria-label="Expand envelope"
          data-testid="envelope.expand"
          onClick={(event) => {
            event.stopPropagation();
            selectEnvelope();
          }}
          className={cn(
            "mb-4 flex h-11 w-full items-center gap-3 rounded-xl border bg-background px-3 text-left shadow-[var(--shadow-xs)] transition-[border-color,box-shadow] hover:border-sel-mid",
            selected && "border-accent-email shadow-[0_0_0_1px_var(--accent-email)]",
          )}
        >
          <span className="text-muted-foreground text-[10px] font-semibold tracking-[0.08em] uppercase">
            Envelope
          </span>
          <span className="text-foreground min-w-0 flex-1 truncate text-[12px]">
            {subject === "" ? "No subject" : subject}
          </span>
          <ChevronDown className="text-muted-foreground size-4 shrink-0" />
        </Collapsible.Trigger>
      )}
      <Collapsible.Panel>
        <div
          onClick={(event) => {
            event.stopPropagation();
            selectEnvelope();
          }}
          className={cn(
            "mb-6 cursor-pointer overflow-hidden rounded-2xl border transition-shadow",
            selected
              ? "border-accent-email shadow-[0_0_0_1px_var(--accent-email)]"
              : "border-border/80 hover:border-sel-mid",
          )}
        >
          <div className="border-border-subtle bg-surface-inset/80 flex items-center justify-between border-b px-3 py-1.5">
            <button
              type="button"
              aria-label="Select envelope"
              data-testid="envelope.select"
              onClick={(event) => {
                event.stopPropagation();
                selectEnvelope();
              }}
              className="text-muted-foreground hover:bg-muted hover:text-foreground rounded px-1 py-0.5 text-[10px] font-semibold tracking-[0.08em] uppercase"
            >
              Envelope
            </button>
            <div className="flex items-center gap-2">
              <span className="text-placeholder text-[10px]">
                defaults muted · subject &amp; preview rendered
              </span>
              {compact && (
                <Collapsible.Trigger
                  aria-label="Collapse envelope"
                  data-testid="envelope.collapse"
                  onClick={(event) => {
                    event.stopPropagation();
                  }}
                  className="text-muted-foreground hover:bg-muted hover:text-foreground rounded p-1"
                >
                  <ChevronUp className="size-3.5" />
                </Collapsible.Trigger>
              )}
            </div>
          </div>

          <div className="border-border-subtle bg-surface-inset/40 border-b">
            <div className="flex items-center gap-3 px-4 py-2 text-[12.5px]">
              <span className="text-placeholder w-16 shrink-0 text-[11px] font-medium tracking-wide uppercase">
                From
              </span>
              <span className="text-muted-foreground min-w-0 flex-1 truncate">
                {fromLabel(from)}
              </span>
              <DefaultTag />
            </div>
            <div
              data-testid="envelope.reply-to-row"
              className="flex items-center gap-3 px-4 py-2 text-[12.5px]"
            >
              <span className="text-placeholder w-16 shrink-0 text-[11px] font-medium tracking-wide uppercase">
                Reply-To
              </span>
              <span className="text-muted-foreground min-w-0 flex-1 truncate">
                {replyTo.length > 0 ? replyTo.join(", ") : "None"}
              </span>
              <DefaultTag />
            </div>
          </div>

          <div className="bg-background">
            <div className="border-border-subtle flex items-center gap-3 border-b px-4 py-2.5 text-[12.5px]">
              <span className="text-muted-foreground w-16 shrink-0 text-[11px] font-medium tracking-wide uppercase">
                Subject
              </span>
              <EnvelopeValue
                value={subject}
                placeholder="No subject"
                testId="envelope.subject-value"
              />
            </div>
            <div className="flex items-center gap-3 px-4 py-2.5 text-[12.5px]">
              <span className="text-muted-foreground w-16 shrink-0 text-[11px] font-medium tracking-wide uppercase">
                Preview
              </span>
              <EnvelopeValue
                value={preheader}
                placeholder="No preview text"
                testId="envelope.preview-value"
              />
            </div>
          </div>
        </div>
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}
