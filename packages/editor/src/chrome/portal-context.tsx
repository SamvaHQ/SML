import type { ReactNode } from "react";

import { EditorPortalContext } from "./use-editor-portal";

export function EditorPortalProvider({
  container,
  children,
}: {
  readonly container: HTMLDivElement | null;
  readonly children: ReactNode;
}) {
  return <EditorPortalContext value={container}>{children}</EditorPortalContext>;
}
