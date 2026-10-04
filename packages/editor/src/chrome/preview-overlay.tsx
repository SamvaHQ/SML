import { Dialog } from "@base-ui/react/dialog";
import { useState } from "react";
import { useShallow } from "zustand/react/shallow";

import { MOBILE_WIDTH, type DeviceMode } from "../canvas/device";
import { EmailFrame } from "../canvas/email-frame";
import { SmsCounter } from "../channels/workspace-ui";
import { useEditorStore } from "../state/context";
import { CompatibilityReport } from "./compatibility-report";
import { Segmented } from "./ui";
import { cn } from "./ui-classes";
import { useEditorPortalContainer } from "./use-editor-portal";

type Scheme = "light" | "dark";
type PreviewView = "preview" | "html" | "text" | "payload" | "source";

const DEVICE_WIDTH: Record<DeviceMode, number> = { desktop: 600, mobile: MOBILE_WIDTH };

/**
 * The label shown for a WhatsApp copy-code button. Exported as the content contract:
 * the preview renders this exact copy for copy-code buttons (the code itself is
 * masked), and the test asserts against the same constant.
 */
export const COPY_CODE_LABEL = "Copy code";

export interface PreviewOverlayProps {
  readonly open: boolean;
  readonly onClose: () => void;
}

/**
 * A chromeless, full-viewport preview of the rendered email — exactly what ships,
 * with no editor chrome. Desktop/Mobile switches the column width; Light/Dark
 * forces the rendered dark rules symmetrically on ("dark") or off ("light")
 * regardless of the OS theme (real, not approximated — see EmailFrame), where the
 * editing canvas follows the OS. Device/scheme reset to Desktop/Light on each
 * open, while inheriting the workspace device so Preview never starts in a
 * contradictory width. Esc or Close dismisses.
 */
export function PreviewOverlay({ open, onClose }: PreviewOverlayProps) {
  if (!open) return null;
  return <OpenPreviewOverlay onClose={onClose} />;
}

function OpenPreviewOverlay({ onClose }: { readonly onClose: () => void }) {
  const portalContainer = useEditorPortalContainer();
  const { doc, render, checks, previewDevice } = useEditorStore(
    useShallow((state) => ({
      doc: state.doc,
      render: state.render,
      checks: state.checks,
      previewDevice: state.previewDevice,
    })),
  );
  const [view, setView] = useState<PreviewView>("preview");
  const [device, setDevice] = useState<DeviceMode>(previewDevice);
  const [scheme, setScheme] = useState<Scheme>("light");

  // Mid-open movement adjusts state during render (the sanctioned form), never
  // in an effect: a channel switch resets the tab; a workspace device change
  // re-inherits the preview device and resets tab + scheme.
  const [lastChannel, setLastChannel] = useState(doc?.channel);
  if (doc?.channel !== lastChannel) {
    setLastChannel(doc?.channel);
    setView("preview");
  }
  const [lastWorkspaceDevice, setLastWorkspaceDevice] = useState(previewDevice);
  if (previewDevice !== lastWorkspaceDevice) {
    setLastWorkspaceDevice(previewDevice);
    setView("preview");
    setDevice(previewDevice);
    setScheme("light");
  }

  if (doc === null) return null;
  const from = doc.metadata.fromDefault;
  const viewOption = (value: string, label: string) => ({
    value,
    label,
    testId: `preview-overlay.view.${value}`,
  });
  const views =
    doc.channel === "email"
      ? [
          viewOption("preview", "Preview"),
          viewOption("html", "HTML"),
          viewOption("text", "Text"),
          viewOption("source", "TSX"),
        ]
      : doc.channel === "sms"
        ? [
            viewOption("preview", "Preview"),
            viewOption("text", "Text"),
            viewOption("source", "TSX"),
          ]
        : [
            viewOption("preview", "Preview"),
            viewOption("payload", "Payload"),
            viewOption("source", "TSX"),
          ];
  const computeOutput = (): string => {
    if (view === "source") return doc.origin.authoredSource;
    if (view === "html" && render !== null) return render.html;
    if (view === "text" && render !== null) return render.text;
    if (view === "text" && doc.channel === "sms" && doc.render !== null) return doc.render.text;
    if (view === "payload" && doc.channel === "whatsapp" && doc.render !== null)
      return JSON.stringify(doc.render, null, 2);
    return "";
  };
  const output = computeOutput();

  return (
    <Dialog.Root open onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <Dialog.Portal container={portalContainer}>
        <Dialog.Popup className="samva-editor-shell fixed inset-0 z-[100] flex flex-col bg-[var(--editor-canvas-bg)] outline-none">
          <Dialog.Title className="sr-only">Template preview</Dialog.Title>
          <Dialog.Description className="sr-only">
            Preview the rendered template and inspect its generated output.
          </Dialog.Description>
          <div
            data-testid="preview-overlay.toolbar"
            className="border-border-subtle flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2.5 sm:gap-2.5 sm:px-4"
          >
            <span className="text-[13px] font-semibold">Preview</span>
            <span className="text-muted-foreground hidden text-xs sm:inline">
              rendered message, exactly what ships
            </span>
            <Segmented
              ariaLabel="Preview format"
              testId="preview-overlay.format-group"
              value={view}
              onChange={(value) => setView(value as PreviewView)}
              options={views}
            />
            <span className="hidden flex-1 sm:block" />
            {doc.channel === "email" && view === "preview" && (
              <>
                <Segmented
                  ariaLabel="Preview width"
                  testId="preview-overlay.width-group"
                  value={device}
                  onChange={(value) => setDevice(value as DeviceMode)}
                  options={[
                    {
                      value: "desktop",
                      label: "Desktop",
                      testId: "preview-overlay.device.desktop",
                    },
                    {
                      value: "mobile",
                      label: "Mobile",
                      testId: "preview-overlay.device.mobile",
                    },
                  ]}
                />
                <Segmented
                  ariaLabel="Preview color scheme"
                  testId="preview-overlay.color-scheme-group"
                  value={scheme}
                  onChange={(value) => setScheme(value as Scheme)}
                  options={[
                    {
                      value: "light",
                      label: "Light",
                      testId: "preview-overlay.scheme.light",
                    },
                    {
                      value: "dark",
                      label: "Dark",
                      testId: "preview-overlay.scheme.dark",
                    },
                  ]}
                />
                <CompatibilityReport checks={checks} />
              </>
            )}
            <Dialog.Close
              data-testid="preview-overlay.close"
              className="border-border text-foreground hover:bg-muted focus-visible:border-ring focus-visible:ring-ring/50 ml-auto inline-flex h-[30px] items-center gap-1.5 rounded-[7px] border px-2.5 outline-none focus-visible:ring-[3px]"
            >
              Close
              <kbd className="text-muted-foreground text-[10px]">⎋</kbd>
            </Dialog.Close>
          </div>
          {view !== "preview" ? (
            <div className="samva-editor-scroll flex-1 overflow-auto p-6">
              <pre className="border-border bg-background text-foreground mx-auto min-h-full max-w-[1100px] rounded-lg border p-5 font-mono text-[12px] leading-5 whitespace-pre-wrap">
                {output}
              </pre>
            </div>
          ) : doc.channel === "email" ? (
            <div className="samva-editor-scroll flex-1 overflow-auto px-6 pt-3 pb-12">
              <div
                data-testid="preview-overlay.device-frame"
                className={cn(
                  "mx-auto mb-3.5 max-w-full truncate text-[12.5px] text-muted-foreground transition-[width] duration-180",
                  device === "mobile" ? "w-[375px]" : "w-[600px]",
                )}
              >
                {from !== undefined && (
                  <>
                    <b className="text-foreground font-semibold">{from.name ?? from.email}</b>
                    {from.name !== undefined ? <> &lt;{from.email}&gt;</> : null} ·{" "}
                  </>
                )}
                <b className="text-foreground font-semibold">{render?.subject ?? ""}</b>
                {render?.preheader !== undefined && (
                  <span className="opacity-70"> — {render.preheader}</span>
                )}
              </div>
              <div
                className={cn(
                  "mx-auto h-[calc(100%-2rem)] max-w-full transition-[width] duration-180 ease-out",
                  device === "mobile" ? "w-[375px]" : "w-[600px]",
                )}
              >
                {render !== null ? (
                  <EmailFrame
                    html={render.html}
                    width={DEVICE_WIDTH[device]}
                    forceColorScheme={scheme}
                  />
                ) : (
                  <pre className="border-status-error/40 bg-background text-status-error rounded-lg border p-4 font-mono text-xs whitespace-pre-wrap">
                    The current draft did not build, so there is nothing to preview.
                  </pre>
                )}
              </div>
            </div>
          ) : (
            <div className="samva-editor-scroll flex-1 overflow-auto p-8">
              <div className="border-border bg-background mx-auto max-w-[460px] rounded-[28px] border p-5 shadow-[var(--shadow-lg)]">
                {doc.channel === "sms" && doc.render !== null ? (
                  <>
                    <div
                      data-testid="preview-overlay.sms-body"
                      className="bg-muted rounded-[18px] px-4 py-3 text-[14px] whitespace-pre-wrap"
                    >
                      {doc.render.text}
                    </div>
                    <SmsCounter text={doc.render.text} className="mt-4 text-center text-xs" />
                  </>
                ) : doc.channel === "whatsapp" && doc.render !== null ? (
                  <div className="bg-surface-inset rounded-xl p-3.5">
                    {doc.render.header !== undefined && doc.render.header.text !== "" && (
                      <p className="mb-1 font-semibold">{doc.render.header.text}</p>
                    )}
                    <p className="whitespace-pre-wrap">{doc.render.body}</p>
                    {doc.render.footer !== undefined && doc.render.footer !== "" && (
                      <p className="text-muted-foreground mt-2 text-xs">{doc.render.footer}</p>
                    )}
                    {doc.render.buttons.map((button, index) => (
                      <div
                        key={`${button.type}-${index}`}
                        className="border-border-subtle text-accent-email mt-2 border-t pt-2 text-center text-xs"
                      >
                        {button.type === "copy-code" ? COPY_CODE_LABEL : button.text}
                      </div>
                    ))}
                  </div>
                ) : (
                  <pre className="text-status-error whitespace-pre-wrap">
                    The current draft did not build, so there is nothing to preview.
                  </pre>
                )}
              </div>
            </div>
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
