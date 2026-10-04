import type { ReactNode, RefObject } from "react";

import { EditorPortalContext } from "./use-editor-portal";

export function EditorPortalProvider({
  container,
  children,
}: {
  readonly container: RefObject<HTMLDivElement | null>;
  readonly children: ReactNode;
}) {
  return <EditorPortalContext value={container}>{children}</EditorPortalContext>;
}
