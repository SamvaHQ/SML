import type { EmailDiagnostic } from "./diagnostics";

// A file the project imports becomes a publication asset addressed by the hash
// of its bytes. The address is the identity: the same bytes are the same asset
// in every publication, a changed file is a new address, and a hosted URL can
// therefore be cached forever. External https images stay references — the
// compiler records that a template points at them and never fetches them.

/** Files a template may import, and what they are served as. */
export const ASSET_CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
};

export interface AssetEntry {
  /** Project-relative path the template imported. */
  readonly path: string;
  /** SHA-256 of the exact bytes, lowercase hex. */
  readonly digest: string;
  readonly bytes: number;
  readonly contentType: string;
  /** `<digest><ext>` — the name the asset has under any base. */
  readonly fileName: string;
}

export interface AssetManifest {
  /** Where these assets are served from in this build. */
  readonly base: string;
  readonly assets: readonly AssetEntry[];
}

const extensionOf = (path: string): string => {
  const dot = path.lastIndexOf(".");
  return dot < 0 ? "" : path.slice(dot).toLowerCase();
};

/** True when the compiler turns this import into a content-addressed asset. */
export const isAssetPath = (path: string): boolean =>
  Object.hasOwn(ASSET_CONTENT_TYPES, extensionOf(path));

const hex = (buffer: ArrayBuffer): string =>
  Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join("");

/** Address one file by its content. */
export const assetEntry = async (path: string, bytes: Uint8Array): Promise<AssetEntry> => {
  const extension = extensionOf(path);
  // Copy into a plain ArrayBuffer view: the caller's bytes may be a subarray of
  // a larger read buffer, and the digest must cover exactly this file.
  const view = new Uint8Array(bytes.byteLength);
  view.set(bytes);
  const digest = hex(await crypto.subtle.digest("SHA-256", view));
  return {
    path,
    digest,
    bytes: bytes.byteLength,
    contentType: ASSET_CONTENT_TYPES[extension] ?? "application/octet-stream",
    fileName: `${digest}${extension}`,
  };
};

/**
 * The URL an asset has under a base. The base is a build input: publication
 * passes its hosted origin, and a local export passes whatever it will serve
 * the exported files from.
 */
export const assetUrl = (entry: AssetEntry, base: string): string =>
  `${base.replace(/\/+$/, "")}/${entry.fileName}`;

const EXTERNAL_IMAGE = /^https:\/\//i;

/** Record, but never fetch, a URL the template points at. */
export const isExternalAsset = (reference: string): boolean => EXTERNAL_IMAGE.test(reference);

/**
 * Reject an asset base that would produce URLs a client will not load. The
 * relative forms are the ones a page on disk resolves against its own
 * directory, which is what a local export writes.
 */
export const checkAssetBase = (base: string): readonly EmailDiagnostic[] =>
  /^(https:\/\/|\.{1,2}\/|\/)/i.test(base)
    ? []
    : [
        {
          code: "invalid-asset-base",
          severity: "error",
          message: `Asset base ${JSON.stringify(base)} must be an https URL, an absolute path, or a relative path for a local export.`,
          origins: [],
        },
      ];
