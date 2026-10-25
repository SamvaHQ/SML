import type { EmailElementSelection } from "@samva/markup/edit";
import { useMemo, useState, type ReactNode } from "react";

import type { PageRender } from "../host/types";
import { correspondingPath } from "../state/target-map";
import { EmailFrame, type EmailFrameProps } from "./email-frame";
import { SelectionOverlay } from "./selection-overlay";

export interface PageFrameProps {
  readonly page: PageRender;
  /** The selected email element's instance path, which the page maps onto its own element. */
  readonly selectedEmailPath: string | null;
  /** The email render's selections, the space the selection lives in. */
  readonly emailSelections: ReadonlyArray<EmailElementSelection>;
  readonly width: number;
  readonly epoch?: number | undefined;
  /** A click on the page, as the page's own instance path (null outside any element). */
  readonly onSelect: (pagePath: string | null) => void;
  readonly onZoomGesture?: EmailFrameProps["onZoomGesture"];
}

/**
 * The web page the same authoring renders as, in the email frame's sandbox and with its click
 * contract: a click resolves `data-samva-instance` to a page path, and the selection stays in
 * email paths, drawn on the page element that corresponds to it. A selection with no page
 * counterpart draws nothing and is kept. Prose editing in the page would attach here, beside
 * `onSelect`.
 */
export const PageFrame = ({
  page,
  selectedEmailPath,
  emailSelections,
  width,
  epoch,
  onSelect,
  onZoomGesture,
}: PageFrameProps): ReactNode => {
  const [hoveredPath, setHoveredPath] = useState<string | null>(null);
  const selectedPath = useMemo(
    () =>
      selectedEmailPath === null
        ? null
        : correspondingPath(emailSelections, page.selections, selectedEmailPath),
    [emailSelections, page.selections, selectedEmailPath],
  );
  const find = (path: string | null) =>
    path === null ? null : (page.selections.find((entry) => entry.instancePath === path) ?? null);
  return (
    <EmailFrame
      html={page.html}
      width={width}
      epoch={epoch}
      title="Web page canvas"
      testId="canvas.page-frame"
      onSelect={onSelect}
      onHover={setHoveredPath}
      onZoomGesture={onZoomGesture}
      overlay={
        <SelectionOverlay
          renderRevision={page.revision}
          selected={find(selectedPath)}
          hovered={find(hoveredPath)}
        />
      }
    />
  );
};
