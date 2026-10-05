import { type ReactNode, useContext, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { isCanvasActivationTarget, resolveInstancePath } from "./instance-dom";
import { PreviewDocumentContext, type PreparedPreviewDocument } from "./preview-document";

/**
 * The rendered email, mounted in a same-origin iframe.
 *
 * The host renders the template and hands back one HTML document; nothing here
 * compiles it. Optional host preparation runs before parsing. The frame sizes
 * to content, resolves a click to the `data-samva-instance`
 * the renderer stamped on every element, and it hosts chrome (selection outline,
 * label chip) as a React portal above the document.
 */

/**
 * html/body stay content-sized so the iframe can shrink as well as grow, and the
 * frame never grows its own scrollbar — the workspace pane outside it is the only
 * scroller.
 */
const FRAME_RESET_CSS = "html,body{margin:0;padding:0;overflow:hidden}";

const CHROME_TOKENS = {
  "--editor-canvas-hover": "#93c5fd",
  "--editor-canvas-selected": "#2563eb",
  "--editor-canvas-selected-fg": "#fff",
  "--editor-canvas-generated": "#a855f7",
} as const;

/** Serialize only editor-owned chrome variables; the email's own selectors stay untouched. */
const frameChromeCss = (values: Readonly<Record<string, string | undefined>>): string =>
  `:root{${Object.entries(CHROME_TOKENS)
    .map(([token, fallback]) => `${token}:${values[token]?.trim() || fallback}`)
    .join(";")}}`;

const resolvedChromeTokens = (iframe: HTMLIFrameElement): Record<string, string> => {
  const parent = iframe.parentElement;
  if (parent === null) return {};
  const probe = document.createElement("span");
  probe.hidden = true;
  parent.appendChild(probe);
  const values = Object.fromEntries(
    Object.keys(CHROME_TOKENS).map((token) => {
      probe.style.color = `var(${token})`;
      return [token, getComputedStyle(probe).color];
    }),
  );
  probe.remove();
  return values;
};

/**
 * Simulate a `prefers-color-scheme` regardless of the OS theme by rewriting the
 * rendered `@media (prefers-color-scheme: dark)` gate: "dark" → `@media all` (the
 * dark rules always match), "light" → `@media not all` (they never match). There
 * is no browser API to set an iframe's effective prefers-color-scheme, which is
 * why the document itself is transformed. Callers pass the ORIGINAL html each
 * time, never a prior rewrite, so toggling is symmetric and reversible.
 */
const DARK_GATE = /@media\s*\(\s*prefers-color-scheme:\s*dark\s*\)/g;
const forceScheme = (html: string, scheme: "light" | "dark"): string =>
  html.replace(DARK_GATE, scheme === "dark" ? "@media all" : "@media not all");

const hasNavigationModifier = (event: MouseEvent): boolean =>
  event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.button !== 0;

/**
 * Fit an iframe to its document even when the document became shorter.
 *
 * `scrollHeight` is at least the iframe viewport height, which leaves a tall
 * iframe unable to shrink. The body's layout box is intrinsic to its flow content
 * because the reset gives html/body no viewport-filling min-height, so it can be
 * measured without collapsing the iframe and disturbing the outer canvas.
 */
const fitIframeHeight = (iframe: HTMLIFrameElement): number | null => {
  const idoc = iframe.contentDocument;
  if (idoc === null) return null;
  const bodyRect = idoc.body.getBoundingClientRect();
  const bodyHeight = Math.max(bodyRect.height, idoc.body.offsetHeight);
  const height = Math.ceil(
    bodyHeight > 0
      ? bodyHeight
      : Math.max(idoc.body.scrollHeight, idoc.documentElement.scrollHeight),
  );
  iframe.style.height = `${height}px`;
  return height;
};

export interface EmailFrameProps {
  /** The rendered email document, exactly as the host produced it. */
  readonly html: string;
  readonly width: number;
  /**
   * Simulate `prefers-color-scheme` for the email (preview overlay): force the
   * rendered dark rules on ("dark") or off ("light") regardless of the OS theme.
   * Omit on the editing canvas so it follows the OS.
   */
  readonly forceColorScheme?: "light" | "dark" | undefined;
  /** Chrome portalled above the document — the selection outline and its label. */
  readonly overlay?: ReactNode | undefined;
  readonly onSelect?: ((instancePath: string | null) => void) | undefined;
  readonly onHover?: ((instancePath: string | null) => void) | undefined;
  /** A context click inside the frame, with the point translated to page coordinates. */
  readonly onContextMenu?:
    | ((input: {
        readonly instancePath: string | null;
        readonly clientX: number;
        readonly clientY: number;
      }) => void)
    | undefined;
}

/**
 * Installing a document is a one-time act per frame: `EmailFrame` keys this on
 * the exact document it mounts, so a new render is a new iframe rather than a
 * rewrite underneath a live React portal.
 */
const FrameDocument = ({
  document_,
  mount,
  width,
  dark,
  overlay,
  onSelect,
  onHover,
  onContextMenu,
}: {
  readonly document_: string;
  readonly mount: PreparedPreviewDocument["mount"] | undefined;
  readonly width: number;
  readonly dark: boolean;
  readonly overlay?: ReactNode | undefined;
  readonly onSelect?: ((instancePath: string | null) => void) | undefined;
  readonly onHover?: ((instancePath: string | null) => void) | undefined;
  readonly onContextMenu?: EmailFrameProps["onContextMenu"];
}): ReactNode => {
  const ref = useRef<HTMLIFrameElement>(null);
  const [body, setBody] = useState<HTMLElement | null>(null);
  // Handlers are read at event time so re-attaching listeners is never needed for
  // a changed callback identity, and the document listeners live with the frame.
  const handlers = useRef({ onSelect, onHover, onContextMenu });
  useLayoutEffect(() => {
    handlers.current = { onSelect, onHover, onContextMenu };
  }, [onSelect, onHover, onContextMenu]);

  // Layout effect (not passive) so the frame is wired and the portal content is
  // committed before the browser paints — otherwise one empty frame flashes.
  useLayoutEffect(() => {
    const iframe = ref.current;
    if (iframe === null) return;
    const idoc = iframe.contentDocument;
    if (idoc === null) return;
    let cleanupDocument: (() => void) | undefined;

    let fitFrame: number | null = null;
    const scheduleFit = () => {
      // ResizeObserver callbacks run inside the browser's resize-delivery cycle.
      // Writing the iframe height synchronously from there can resize the observed
      // body again before delivery finishes, which Chrome reports as an
      // undelivered-notification loop.
      if (fitFrame !== null) return;
      fitFrame = requestAnimationFrame(() => {
        fitFrame = null;
        fitIframeHeight(iframe);
      });
    };
    const observer = new ResizeObserver(scheduleFit);
    const mutations = new MutationObserver(scheduleFit);

    const updateChrome = () => {
      let chrome = idoc.head.querySelector<HTMLStyleElement>("style[data-samva-editor-chrome]");
      if (chrome === null) {
        chrome = idoc.createElement("style");
        chrome.dataset.samvaEditorChrome = "";
        idoc.head.appendChild(chrome);
      }
      chrome.textContent = `${FRAME_RESET_CSS}${frameChromeCss(resolvedChromeTokens(iframe))}`;
    };

    const wire = () => {
      // A src-less same-origin iframe exposes its document synchronously, so the
      // rendered email is installed by writing it rather than through `srcdoc`,
      // whose load is asynchronous and would leave one empty frame on screen.
      idoc.open();
      idoc.write(document_);
      idoc.close();
      cleanupDocument = mount?.(idoc);
      updateChrome();
      setBody(idoc.body);
      observer.disconnect();
      observer.observe(idoc.body);
      mutations.disconnect();
      mutations.observe(idoc.body, { childList: true, subtree: true });
      fitIframeHeight(iframe);
    };

    const onClick = (event: MouseEvent) => {
      // The canvas is not a live email. A normal click selects an interactive
      // element without following its URL or submitting a form; a modified click
      // is preserved so a link can deliberately be opened in a new tab.
      if (!hasNavigationModifier(event) && isCanvasActivationTarget(event.target)) {
        event.preventDefault();
      }
      handlers.current.onSelect?.(resolveInstancePath(event.target));
    };
    const onMove = (event: MouseEvent) =>
      handlers.current.onHover?.(resolveInstancePath(event.target));
    const onLeave = () => handlers.current.onHover?.(null);
    const onContext = (event: MouseEvent) => {
      const report = handlers.current.onContextMenu;
      if (report === undefined) return;
      event.preventDefault();
      const frameRect = iframe.getBoundingClientRect();
      const scaleX = iframe.clientWidth === 0 ? 1 : frameRect.width / iframe.clientWidth;
      const scaleY = iframe.clientHeight === 0 ? 1 : frameRect.height / iframe.clientHeight;
      report({
        instancePath: resolveInstancePath(event.target),
        clientX: frameRect.left + event.clientX * scaleX,
        clientY: frameRect.top + event.clientY * scaleY,
      });
    };

    const attach = () => {
      idoc.addEventListener("click", onClick);
      idoc.addEventListener("mousemove", onMove);
      idoc.addEventListener("mouseleave", onLeave);
      idoc.addEventListener("contextmenu", onContext);
    };
    const detach = () => {
      idoc.removeEventListener("click", onClick);
      idoc.removeEventListener("mousemove", onMove);
      idoc.removeEventListener("mouseleave", onLeave);
      idoc.removeEventListener("contextmenu", onContext);
    };

    // Writing the document is what installs it, and `close()` fires the frame's
    // own load event — so this runs exactly once. Re-wiring from a load listener
    // would rewrite the document that listener was fired for, forever.
    wire();
    attach();
    // Every supported host changes mode through `html.dark`. A future host that
    // changes theme variables without changing that class must add an explicit
    // refresh signal here rather than silently relying on this observer.
    const themeObserver = new MutationObserver(updateChrome);
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => {
      detach();
      observer.disconnect();
      mutations.disconnect();
      themeObserver.disconnect();
      if (fitFrame !== null) cancelAnimationFrame(fitFrame);
      cleanupDocument?.();
    };
    // The frame key includes source, scheme, and preparation identity so a live
    // portal never survives replacement of its document.
  }, [document_, mount]);

  return (
    <iframe
      ref={ref}
      data-testid="canvas.frame"
      title="Email canvas"
      sandbox="allow-same-origin"
      style={{
        width,
        // Initial height only — the ResizeObserver above sizes it to the
        // document's content. `display:block` drops the inline replaced element's
        // baseline gap so no sliver shows below the email.
        height: 0,
        display: "block",
        border: "none",
        background: dark ? "#0a0a0a" : "var(--editor-canvas-document-bg, #fff)",
        colorScheme: dark ? "dark" : "light",
      }}
    >
      {body !== null && overlay !== undefined ? createPortal(overlay, body) : null}
    </iframe>
  );
};

export const EmailFrame = ({ html, forceColorScheme, ...rest }: EmailFrameProps): ReactNode => {
  const prepare = useContext(PreviewDocumentContext);
  const schemeHtml = forceColorScheme === undefined ? html : forceScheme(html, forceColorScheme);
  const prepared = useMemo(() => prepare?.(schemeHtml), [schemeHtml, prepare]);
  const [preparation, setPreparation] = useState({ prepare, generation: 0 });
  if (preparation.prepare !== prepare) {
    setPreparation({ prepare, generation: preparation.generation + 1 });
  }
  const document_ = prepared?.html ?? schemeHtml;
  return (
    <FrameDocument
      // Original HTML remains part of identity even when preparation strips the changed content.
      key={`${preparation.generation}:${forceColorScheme ?? ""}:${html}`}
      document_={document_}
      mount={prepared?.mount}
      dark={forceColorScheme === "dark"}
      {...rest}
    />
  );
};
