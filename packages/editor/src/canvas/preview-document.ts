import { createContext } from "react";

/** Host-prepared HTML and resources owned by one mounted preview document. */
export interface PreparedPreviewDocument {
  /** The only HTML written to the attached iframe's parser. */
  readonly html: string;
  /**
   * Runs synchronously after document.close(), before measurement and paint.
   * Returns cleanup for this exact document, including StrictMode effect replay.
   */
  readonly mount: (document: Document) => () => void;
}

export const PreviewDocumentContext = createContext<
  ((html: string) => PreparedPreviewDocument) | undefined
>(undefined);
