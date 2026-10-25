import { type ReactNode, useContext, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { isCanvasActivationTarget, resolveInstancePath } from "./instance-dom";
import { PreviewDocumentContext, type PreparedPreviewDocument } from "./preview-document";
import { isZoomWheel, zoomKeyOf, type ZoomGesture } from "./zoom";

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

/**
 * The editor's own chrome inside the frame (the Design toolbar and pins). The frame holds none of
 * the editor's stylesheets, and the email's own rules must not reach the chrome, so it is styled
 * here under the overlay's attribute and resets what an email might set on its elements.
 */
const OVERLAY_CSS = [
  "[data-samva-overlay] .samva-tb-anchor{position:fixed;z-index:2147483647;pointer-events:auto}",
  "[data-samva-overlay] .samva-tb{display:flex;align-items:center;gap:2px;padding:3px;border-radius:9px;background:var(--editor-canvas-toolbar-bg);color:var(--editor-canvas-toolbar-fg);box-shadow:inset 0 0 0 1px rgba(255,255,255,.14),0 0 0 1px rgba(0,0,0,.08),0 6px 18px rgba(0,0,0,.22);font:500 11.5px/1 ui-sans-serif,system-ui,sans-serif;white-space:nowrap}",
  "[data-samva-overlay] .samva-tb button{all:unset;box-sizing:border-box;display:inline-grid;place-items:center;width:26px;height:26px;border-radius:6px;cursor:pointer;color:inherit}",
  "[data-samva-overlay] .samva-tb button:hover{background:rgba(255,255,255,.14)}",
  "[data-samva-overlay] .samva-tb button:focus-visible{outline:2px solid var(--editor-canvas-hover);outline-offset:-2px}",
  "[data-samva-overlay] .samva-tb button:disabled{opacity:.35;cursor:default;background:none}",
  "[data-samva-overlay] .samva-tb svg{width:14px;height:14px}",
  "[data-samva-overlay] .samva-tb-label{padding:0 6px 0 7px;max-width:180px;overflow:hidden;text-overflow:ellipsis}",
  "[data-samva-overlay] .samva-tb-sep{width:1px;height:14px;margin:0 2px;background:rgba(255,255,255,.22)}",
  "[data-samva-overlay] .samva-pin{position:fixed;z-index:2147483647;box-sizing:border-box;width:20px;height:20px;border-radius:999px;background:var(--editor-canvas-selected);color:var(--editor-canvas-selected-fg);font:700 10px/20px ui-sans-serif,system-ui,sans-serif;text-align:center;box-shadow:0 0 0 2px #fff,0 2px 6px rgba(0,0,0,.3);pointer-events:none}",
].join("");

/** True for an event on the editor's own chrome in the frame, which is not the email. */
const onOverlay = (target: EventTarget | null): boolean =>
  target !== null &&
  "closest" in target &&
  typeof target.closest === "function" &&
  target.closest("[data-samva-overlay]") !== null;

const CHROME_TOKENS = {
  "--editor-canvas-hover": "#93c5fd",
  "--editor-canvas-selected": "#2563eb",
  "--editor-canvas-selected-fg": "#fff",
  "--editor-canvas-generated": "#a855f7",
  "--editor-canvas-toolbar-bg": "#18181b",
  "--editor-canvas-toolbar-fg": "#fafafa",
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
  /**
   * A pinch, Ctrl/⌘ + wheel, or ⌘/Ctrl with +, − or 0 inside the email. The frame keeps the
   * browser from zooming the page and reports the gesture so the canvas zooms instead.
   */
  readonly onZoomGesture?: ((gesture: ZoomGesture) => void) | undefined;
  /** Mount the document again when this changes, as a refresh does. */
  readonly epoch?: number | undefined;
  /** The frame's accessible name; the web page is shown in the same frame with its own. */
  readonly title?: string | undefined;
  readonly testId?: string | undefined;
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
  onZoomGesture,
  title = "Email canvas",
  testId = "canvas.frame",
}: {
  readonly document_: string;
  readonly mount: PreparedPreviewDocument["mount"] | undefined;
  readonly width: number;
  readonly dark: boolean;
  readonly overlay?: ReactNode | undefined;
  readonly onSelect?: ((instancePath: string | null) => void) | undefined;
  readonly onHover?: ((instancePath: string | null) => void) | undefined;
  readonly onContextMenu?: EmailFrameProps["onContextMenu"];
  readonly onZoomGesture?: EmailFrameProps["onZoomGesture"];
  readonly title?: string | undefined;
  readonly testId?: string | undefined;
}): ReactNode => {
  const ref = useRef<HTMLIFrameElement>(null);
  const [body, setBody] = useState<HTMLElement | null>(null);
  // Handlers are read at event time so re-attaching listeners is never needed for
  // a changed callback identity, and the document listeners live with the frame.
  const handlers = useRef({ onSelect, onHover, onContextMenu, onZoomGesture });
  useLayoutEffect(() => {
    handlers.current = { onSelect, onHover, onContextMenu, onZoomGesture };
  }, [onSelect, onHover, onContextMenu, onZoomGesture]);

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
      chrome.textContent = `${FRAME_RESET_CSS}${OVERLAY_CSS}${frameChromeCss(resolvedChromeTokens(iframe))}`;
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
      if (onOverlay(event.target)) return;
      // The canvas is not a live email. A normal click selects an interactive
      // element without following its URL or submitting a form; a modified click
      // is preserved so a link can deliberately be opened in a new tab.
      if (!hasNavigationModifier(event) && isCanvasActivationTarget(event.target)) {
        event.preventDefault();
      }
      handlers.current.onSelect?.(resolveInstancePath(event.target));
    };
    const onMove = (event: MouseEvent) => {
      if (!onOverlay(event.target)) handlers.current.onHover?.(resolveInstancePath(event.target));
    };
    const onLeave = () => handlers.current.onHover?.(null);
    const onContext = (event: MouseEvent) => {
      const report = handlers.current.onContextMenu;
      if (report === undefined || onOverlay(event.target)) return;
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

    // Events inside the email never reach the page, so a pinch or a zoom chord over it would
    // zoom the whole page. Take those here and hand them to the canvas.
    const onWheel = (event: WheelEvent) => {
      const report = handlers.current.onZoomGesture;
      if (report === undefined || !isZoomWheel(event)) return;
      event.preventDefault();
      report({ kind: "wheel", deltaY: event.deltaY });
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const report = handlers.current.onZoomGesture;
      const direction = zoomKeyOf(event);
      if (report === undefined || direction === null) return;
      event.preventDefault();
      report({ kind: "key", direction });
    };

    const attach = () => {
      idoc.addEventListener("click", onClick);
      idoc.addEventListener("mousemove", onMove);
      idoc.addEventListener("mouseleave", onLeave);
      idoc.addEventListener("contextmenu", onContext);
      idoc.addEventListener("wheel", onWheel, { passive: false });
      idoc.addEventListener("keydown", onKeyDown);
    };
    const detach = () => {
      idoc.removeEventListener("click", onClick);
      idoc.removeEventListener("mousemove", onMove);
      idoc.removeEventListener("mouseleave", onLeave);
      idoc.removeEventListener("contextmenu", onContext);
      idoc.removeEventListener("wheel", onWheel);
      idoc.removeEventListener("keydown", onKeyDown);
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
      data-testid={testId}
      title={title}
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

export const EmailFrame = ({
  html,
  forceColorScheme,
  epoch = 0,
  ...rest
}: EmailFrameProps): ReactNode => {
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
      key={`${epoch}:${preparation.generation}:${forceColorScheme ?? ""}:${html}`}
      document_={document_}
      mount={prepared?.mount}
      dark={forceColorScheme === "dark"}
      {...rest}
    />
  );
};
