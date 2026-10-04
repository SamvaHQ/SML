import { resolve } from "node:path";

import type { BrandPlugin } from "@samva/markup/brand";

import type { BrandResolver } from "./brand";
import { samvaEditor, type EditorAffordances } from "./editor";

// The local dev server runs Vite with no config file, the
// `samvaEditor()` plugin, and defaults that need nothing from the project. A
// project that needs more (templates in another repo, other Vite plugins) adds
// `samvaEditor()` to its own `vite.config.ts` instead.

export interface DevServerOptions {
  readonly brandResolver?: BrandResolver | undefined;
  readonly brandPlugin?: BrandPlugin | undefined;
  /** Whether the host provides authenticated editor capabilities. */
  readonly authenticated?: boolean | undefined;
  readonly editorAffordances?: EditorAffordances | undefined;
  /** The project root. Default: the working directory. */
  readonly root?: string | undefined;
  /** The templates directory, relative to `root`. Default: `templates/` and `emails/`, whichever exist. */
  readonly dir?: string | undefined;
  readonly port?: number | undefined;
  /** The interface to listen on. Default: loopback only. */
  readonly host?: string | undefined;
  /** Open the editor in a browser once the server is listening. */
  readonly open?: boolean | undefined;
}

export interface DevServer {
  /** Where the editor is served. */
  readonly url: string;
  readonly close: () => Promise<void>;
}

/** Start the local editor for a template project. */
export const startDevServer = async (options: DevServerOptions = {}): Promise<DevServer> => {
  const vite = await import("vite").catch(() => undefined);
  if (vite === undefined)
    // oxlint-disable-next-line samva/no-try-catch-or-throw, samva/no-error-constructor -- Plain library boundary: the optional `vite` peer is missing and the caller surfaces a user-facing message.
    throw new Error(
      "`vite` is required for the template dev server. Install it as a dev dependency.",
    );
  const root = resolve(options.root ?? process.cwd());
  const server = await vite.createServer({
    root,
    configFile: false,
    // The editor is a pre-built bundle and templates are compiled from source, so there is no
    // client dependency graph to scan or pre-bundle.
    appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] },
    server: {
      ...(options.port === undefined ? {} : { port: options.port }),
      ...(options.host === undefined ? {} : { host: options.host }),
      open: options.open === true,
    },
    plugins: [
      samvaEditor({
        templatesDir: options.dir,
        brandResolver: options.brandResolver,
        brandPlugin: options.brandPlugin,
        authenticated: options.authenticated,
        editorAffordances: options.editorAffordances,
      }),
    ],
  });
  // oxlint-disable-next-line samva/no-try-catch-or-throw -- Plain library boundary: release the server if it cannot bind.
  try {
    await server.listen();
  } catch (cause) {
    await server.close();
    throw cause; // oxlint-disable-line samva/no-try-catch-or-throw -- Rethrown unchanged after cleanup.
  }
  const url = server.resolvedUrls?.local[0] ?? server.resolvedUrls?.network[0];
  if (url === undefined) {
    await server.close();
    // oxlint-disable-next-line samva/no-try-catch-or-throw, samva/no-error-constructor -- Plain library boundary.
    throw new Error("The template dev server started without a URL.");
  }
  return { url, close: () => server.close() };
};
