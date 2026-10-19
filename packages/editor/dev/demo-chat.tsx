import ArrowRight01Icon from "@hugeicons/core-free-icons/ArrowRight01Icon";
import ArrowUp02Icon from "@hugeicons/core-free-icons/ArrowUp02Icon";
import { HugeiconsIcon } from "@hugeicons/react";
import type { EditorAssistantWorkspace } from "@samva/editor/shell";
import { useState, type ReactNode } from "react";

// A static, believable transcript for the workspace demo's assistant, so screenshots show a real
// conversation. The transcript is static; the composer does what a host's must: it attaches the
// pins on the email, clears them once sent, and waits while Design edits are staged.

function UserMessage({ children }: { readonly children: ReactNode }) {
  return (
    <div className="bg-muted text-foreground max-w-[86%] self-end rounded-2xl px-3 py-2 text-[13.5px] leading-[1.5]">
      {children}
    </div>
  );
}

function Reply({ children }: { readonly children: ReactNode }) {
  return <p className="text-foreground m-0 text-[13.5px] leading-[1.6]">{children}</p>;
}

/** A finished agent turn, collapsed to one row with its diff count. */
function TurnRow({
  duration,
  added,
  removed,
}: {
  duration: string;
  added: number;
  removed: number;
}) {
  return (
    <div className="border-border/70 flex items-center gap-2 border-b pb-2.5">
      <button
        type="button"
        aria-expanded={false}
        className="text-muted-foreground hover:text-foreground flex items-center gap-1.5 text-[12.5px] transition-colors"
      >
        <HugeiconsIcon icon={ArrowRight01Icon} className="size-3" />
        Worked for {duration}
      </button>
      <span className="flex-1" />
      <span
        title="View diff"
        className="border-border flex h-[22px] items-center gap-1 rounded-md border px-1.5 text-[11.5px] tabular-nums"
      >
        <span className="text-status-success">+{added}</span>
        <span className="text-status-error">−{removed}</span>
      </span>
    </div>
  );
}

/** What the composer reads from the editor and may do to its pins. */
export interface DemoComposerProps {
  readonly design: EditorAssistantWorkspace["design"];
  readonly pins: EditorAssistantWorkspace["pins"];
  readonly removePin: (id: string) => void;
  readonly clearPins: () => void;
}

function Composer({ design, pins, removePin, clearPins }: DemoComposerProps) {
  const [sent, setSent] = useState<string | null>(null);
  const waiting = design.waiting;
  return (
    <div
      data-testid="dev-app.composer"
      className="border-border bg-card focus-within:border-ring flex flex-col rounded-2xl border shadow-xs"
    >
      {pins.length > 0 && (
        <ul
          data-testid="dev-app.composer-pins"
          className="m-0 flex list-none flex-wrap gap-1.5 px-3 pt-3"
        >
          {pins.map((pin) => (
            <li
              key={pin.id}
              className="bg-muted flex items-center gap-1 rounded-full py-0.5 pr-1 pl-1.5 text-[11.5px]"
            >
              <span className="bg-primary text-primary-foreground grid size-4 place-items-center rounded-full text-[10px] font-semibold">
                {pin.number}
              </span>
              <span className="text-muted-foreground">{pin.label}</span>
              {pin.note !== "" && <span className="text-foreground">· {pin.note}</span>}
              <button
                type="button"
                aria-label={`Remove pin ${pin.number}`}
                onClick={() => removePin(pin.id)}
                className="text-muted-foreground hover:bg-background hover:text-foreground rounded-full px-1"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <label htmlFor="demo-composer" className="sr-only">
        Ask for a change
      </label>
      <textarea
        id="demo-composer"
        rows={2}
        disabled={waiting}
        placeholder={
          waiting
            ? "Apply or reset your Design edits to keep talking"
            : pins.length > 0
              ? `Ask about ${pins.length === 1 ? "this pin" : "these pins"}…`
              : (sent ?? "Ask for a change…")
        }
        className="placeholder:text-placeholder text-foreground max-h-40 min-h-[52px] w-full resize-none rounded-2xl bg-transparent px-3.5 pt-3 pb-1 text-[13.5px] leading-[1.5] outline-none disabled:cursor-not-allowed"
      />
      <div className="flex items-center gap-2 px-2 pb-2 pl-3.5">
        {waiting ? (
          <span data-testid="dev-app.chat-waits" className="text-muted-foreground flex-1 text-xs">
            Chat waits while edits are pending.
          </span>
        ) : (
          <span className="flex-1" />
        )}
        <button
          type="button"
          aria-label="Send"
          data-testid="dev-app.send"
          disabled={waiting}
          onClick={() => {
            setSent(`Sent with ${pins.length} ${pins.length === 1 ? "pin" : "pins"}`);
            clearPins();
          }}
          className="bg-primary text-primary-foreground grid size-7 place-items-center rounded-lg opacity-90 disabled:opacity-40"
        >
          <HugeiconsIcon icon={ArrowUp02Icon} className="size-[15px]" />
        </button>
      </div>
      {sent !== null && (
        <span data-testid="dev-app.sent" className="sr-only">
          {sent}
        </span>
      )}
    </div>
  );
}

/**
 * The whole assistant panel. `developer` is the harness's own controls, shown in a bordered box
 * above the composer only when the URL asks for them (`dev=1`).
 */
export function DemoChat({
  developer,
  composer,
}: {
  readonly developer: ReactNode;
  readonly composer: DemoComposerProps;
}) {
  return (
    <div data-testid="dev-app.demo-assistant" className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pt-4 pb-5">
        <UserMessage>Make the welcome email warmer and put the free bag offer up top.</UserMessage>
        <div className="flex flex-col gap-2.5">
          <TurnRow duration="38s" added={24} removed={9} />
          <Reply>
            I moved the offer into a “Welcome offer” label above the headline, so the free bag is
            the first thing Ada reads. The headline now speaks to her by name, the body copy is a
            little looser, and the claim button sits right under it in a warmer terracotta. The
            perks moved into three small tiles below the fold.
          </Reply>
        </div>
        <UserMessage>Can the footer say who actually reads replies?</UserMessage>
        <div className="flex flex-col gap-2.5">
          <TurnRow duration="12s" added={3} removed={2} />
          <Reply>
            Done. The reply note now reads “It reaches the people who roast your coffee, usually
            within a working day.” I left the address line alone.
          </Reply>
        </div>
      </div>
      <div className="flex shrink-0 flex-col gap-2 px-3 pb-3">
        {developer}
        <Composer {...composer} />
      </div>
    </div>
  );
}
