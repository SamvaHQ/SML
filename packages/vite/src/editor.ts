import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { isIP } from "node:net";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { BrandPlugin } from "@samva/markup/brand";
import type { Connect, Plugin, ResolvedConfig, ViteDevServer } from "vite";

import { type BrandResolution, type BrandResolver } from "./brand";
import {
  EditorFileStore,
  EDITOR_MAX_SOURCE_BYTES,
  EDITOR_SOURCE_TOO_LARGE_MESSAGE,
  type StoreChange,
} from "./editor-store";
import { isObject } from "./internal/guards";
import { isProjectFile, projectPath, SAMVA_DIR } from "./layout";

// samvaEditor() — the Vite dev-server surface for Samva templates. A template is
// one TSX file compiled without running it, so the plugin owns the catalog, the
// renders, the file watching and the transport, and evaluates nothing. The
// compile is `compileTemplate` from `@samva/markup/compiler` and the render is
// `renderIr`, the calls the hosted build makes, so a local render cannot drift
// from a published one. Source saves are privileged local-development
// operations: the server binds to loopback by default and accepts them only
// from a loopback client plus a strict localhost Origin, independent of the
// request Host header.
//
// Serving model: the editor UI is a PRE-BUILT static bundle (dist/editor),
// served by this middleware — the same pattern vite-plugin-inspect and
// @tanstack/devtools use. The bundle ships its own React, Tailwind (baked at
// build time), and editor chrome.
//
// Transport: the `{route}/api/*` branches in `configureServer` are the route
// table; editor-store.ts owns the revision/echo model behind them.

const DEFAULT_ROUTE = "/";

// The pre-built editor SPA ships beside the plugin bundle in dist/editor. The
// source-tree fallback keeps real middleware integration tests and local source
// execution on the same built artifact.
const packagedEditorDir = fileURLToPath(new URL("./editor/", import.meta.url));
const EDITOR_DIR = existsSync(packagedEditorDir)
  ? packagedEditorDir
  : fileURLToPath(new URL("../dist/editor/", import.meta.url));

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".map": "application/json",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

/** Host-owned text for authenticated and publishing capabilities. */
export interface EditorAffordances {
  readonly publishingInstructions?:
    | {
        readonly reason: string;
        readonly cta: { readonly label: string; readonly href: string };
      }
    | undefined;
  readonly authenticatedLabel: string;
  readonly authenticatedTitle: string;
}

export interface SamvaEditorPluginOptions {
  /** Host-owned brand resolution. Brand imports fail without it. */
  readonly brandResolver?: BrandResolver | undefined;
  /** Brand import specifier and footer markers passed to the compiler. */
  readonly brandPlugin?: BrandPlugin | undefined;
  /** Whether the host provides authenticated editor capabilities. */
  readonly authenticated?: boolean | undefined;
  readonly editorAffordances?: EditorAffordances | undefined;
  /**
   * The directory containing `.tsx` templates: an absolute path, or a path relative to the
   * project root. When set, only it is scanned. Otherwise `templates/` and `emails/` are, whichever
   * exist.
   */
  readonly templatesDir?: string | undefined;
  /**
   * The project root: the folder holding `theme.css`, shared imports and the generated `.samva/`
   * folder. A path relative to the Vite root; default the Vite root. Set it for templates that
   * live in another folder of a monorepo; the templates directory must be inside it.
   */
  readonly projectRoot?: string | undefined;
  /** Editor UI route. Default `/`; its API and assets are mounted as siblings below it. */
  readonly route?: string | undefined;
  /**
   * Project theme file: a path relative to the project root. Default `theme.css`; false compiles
   * without a project theme.
   */
  readonly theme?: string | false | undefined;
}

/** Normalize + validate the mount route: absolute, root allowed, no trailing slash. */
const normalizeRoute = (raw: string): string => {
  const route = raw === "/" ? "/" : raw.replace(/\/+$/, "");
  if (
    !route.startsWith("/") ||
    route === "" ||
    route.includes("//") ||
    route.includes("?") ||
    route.includes("#")
  ) {
    // oxlint-disable-next-line samva/no-try-catch-or-throw, samva/no-error-constructor -- vite plugin config validation boundary, not Effect domain
    throw new Error(
      `samvaEditor: \`route\` must be an absolute URL path (received ${JSON.stringify(raw)})`,
    );
  }
  return route;
};

const sendJson = (res: ServerResponse, status: number, body: unknown): void => {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
};

/** Serve a file under the built editor dir; returns false (untouched res) if absent/outside. */
const serveStatic = async (res: ServerResponse, filePath: string): Promise<boolean> => {
  const resolved = resolve(filePath);
  const root = EDITOR_DIR.replace(/\/$/, "");
  if (resolved !== root && !resolved.startsWith(`${root}/`)) return false;
  const body = await readFile(resolved).catch(() => undefined);
  if (body === undefined) return false;
  res.statusCode = 200;
  res.setHeader("content-type", MIME[extname(resolved)] ?? "application/octet-stream");
  res.end(body);
  return true;
};

const VITE_INTERNAL_PREFIXES = [
  "/@vite/",
  "/@id/",
  "/@fs/",
  "/@react-refresh",
  "/__vite",
  "/node_modules/.vite/",
] as const;

const isViteInternalPath = (pathname: string): boolean =>
  VITE_INTERNAL_PREFIXES.some(
    (prefix) => pathname === prefix.replace(/\/$/, "") || pathname.startsWith(prefix),
  );

const hasFileExtension = (pathname: string): boolean => extname(pathname) !== "";

const underRoute = (route: string, pathname: string): boolean =>
  route === "/" || pathname === route || pathname.startsWith(`${route}/`);

const childRoute = (route: string, child: string): string =>
  route === "/" ? `/${child}` : `${route}/${child}`;

const isLoopbackHostname = (hostname: string): boolean => {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized === "localhost" || normalized.endsWith(".localhost") || normalized === "::1")
    return true;
  if (isIP(normalized) !== 4) return false;
  return normalized.split(".")[0] === "127";
};

const isLoopbackAddress = (address: string | undefined): boolean => {
  if (address === undefined) return false;
  const normalized = address.startsWith("::ffff:") ? address.slice("::ffff:".length) : address;
  return isLoopbackHostname(normalized);
};

const isTrustedSourceSave = (req: IncomingMessage): boolean => {
  if (!isLoopbackAddress(req.socket.remoteAddress)) return false;
  const origin = req.headers.origin;
  if (origin === undefined) return false;
  // oxlint-disable-next-line samva/no-try-catch-or-throw -- the local HTTP request adapter treats malformed Origin headers as an untrusted source.
  try {
    const parsed = new URL(origin);
    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      parsed.username === "" &&
      parsed.password === "" &&
      isLoopbackHostname(parsed.hostname)
    );
  } catch {
    return false;
  }
};

// JSON may escape each source byte as six characters, plus the revision envelope.
const MAX_BODY_BYTES = EDITOR_MAX_SOURCE_BYTES * 6 + 4096;
class EditorBodyTooLarge extends Error {}

const readBody = (req: IncomingMessage): Promise<string> =>
  new Promise((done, fail) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    req.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        chunks.length = 0;
        fail(new EditorBodyTooLarge("Request body exceeds the editor limit."));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => done(Buffer.concat(chunks).toString("utf8")));
    req.on("error", fail);
    // oxlint-disable-next-line samva/no-error-constructor -- native HTTP stream failure boundary
    req.on("aborted", () => fail(new Error("Request body aborted.")));
  });

/** One SSE connection watching one document. Honors write backpressure by coalescing to latest-change-wins (revisions make intermediate frames droppable). */
interface SseClient {
  readonly res: ServerResponse;
  readonly docId: string;
  readonly clientId: string | undefined;
  push(payload: Record<string, unknown>): void;
}

const createSseClient = (
  res: ServerResponse,
  docId: string,
  clientId: string | undefined,
): SseClient => {
  let pending: string | undefined;
  let draining = false;

  const flush = (): void => {
    if (pending === undefined) {
      draining = false;
      return;
    }
    const frame = pending;
    pending = undefined;
    if (res.write(frame)) flush();
    else draining = true;
  };
  res.on("drain", flush);

  return {
    res,
    docId,
    clientId,
    push(payload) {
      const frame = `event: samva:change\ndata: ${JSON.stringify(payload)}\n\n`;
      if (draining) {
        pending = frame; // latest-change-wins: an older queued frame is superseded
        return;
      }
      if (!res.write(frame)) draining = true;
    },
  };
};

export const samvaEditor = (options: SamvaEditorPluginOptions = {}): Plugin => {
  const route = normalizeRoute(options.route ?? DEFAULT_ROUTE);
  const apiPrefix = childRoute(route, "api");
  let root = process.cwd();
  let store = new EditorFileStore({ root });
  const authenticated = options.authenticated === true;

  const clients = new Set<SseClient>();
  const catalogClients = new Set<ServerResponse>();
  let refreshTail: Promise<unknown> = Promise.resolve();

  const queueStoreRefresh = (
    server: ViteDevServer,
    run: () => Promise<unknown>,
  ): Promise<unknown> => {
    refreshTail = refreshTail.then(run, run).catch((cause: unknown) => {
      server.config.logger.error(
        `samvaEditor refresh failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    });
    return refreshTail;
  };

  return {
    name: "samva-editor",

    config(user) {
      // A host the project chose is its own decision; the default binds to loopback only.
      return {
        server: {
          ...(user.server?.host === undefined
            ? { host: "127.0.0.1", allowedHosts: ["localhost", ".localhost"] }
            : {}),
          watch:
            user.server?.watch === null
              ? null
              : {
                  // Chokidar otherwise drops a second Linux change within 50ms. Its pending-write
                  // tracking coalesces writes and delivers the final contents instead.
                  awaitWriteFinish: user.server?.watch?.awaitWriteFinish ?? {
                    stabilityThreshold: 50,
                    pollInterval: 10,
                  },
                },
        },
      };
    },

    configResolved(resolved: ResolvedConfig) {
      root = resolve(resolved.root, options.projectRoot ?? ".");
    },

    async configureServer(server: ViteDevServer) {
      let brandReport = "";
      // A resolution is reused across refreshes, so report only what changed.
      const reportBrand = (resolution: BrandResolution): void => {
        const text = resolution.ok
          ? resolution.warnings.map((warning) => warning.message).join("\n")
          : resolution.message;
        if (text === brandReport) return;
        brandReport = text;
        if (text === "") return;
        if (resolution.ok) server.config.logger.warn(`samvaEditor: ${text}`);
        else server.config.logger.error(`samvaEditor: ${text}`);
      };
      store = new EditorFileStore({
        root,
        dir: options.templatesDir,
        theme: options.theme,
        // The dev server is the origin and it is not https, so a local render points at its asset
        // route by path. Nothing here is delivered.
        assetBase: childRoute(apiPrefix, "assets"),
        brandResolver: options.brandResolver,
        brandPlugin: options.brandPlugin,
        onProject: (project) => reportBrand(project.brand),
      });

      if (root !== server.config.root) server.watcher.add(root);

      // Watcher events arrive in bursts: an editor save writes through a temporary file, a
      // formatter rewrites a folder, and macOS replays a directory copy the instant the watcher
      // attaches. One rebuild re-reads the whole project from disk, so a rebuild that has not
      // started yet already covers every event queued before it — only events arriving while
      // it runs need another pass.
      let burst = new Set<string>();
      let burstQueued = false;

      // Only files a compile can read matter, and never the tool's own output: the brand cache
      // under `.samva/` is written by the rebuild itself.
      const relevant = (path: string): boolean => {
        const relative = projectPath(root, path);
        if (relative.startsWith("..") || relative === SAMVA_DIR) return false;
        if (relative.startsWith(`${SAMVA_DIR}/`)) return false;
        if (relative.split("/").includes("node_modules")) return false;
        return isProjectFile(relative);
      };

      const onFileEvent = (path: string): void => {
        if (!relevant(path)) return;
        burst.add(path);
        if (burstQueued) return;
        burstQueued = true;
        void queueStoreRefresh(server, async () => {
          const paths = burst;
          burst = new Set();
          burstQueued = false;
          // The store decides whether a single changed file actually moved: its own write-back
          // arrives here as a change event like any other, and recompiling for it would
          // republish the document as a foreign edit. A burst spanning several files is always
          // a real change.
          const only = paths.size === 1 ? [...paths][0] : undefined;
          return store.refreshAll({ documents: true, changed: only });
        });
      };
      server.watcher.on("change", onFileEvent);
      server.watcher.on("add", onFileEvent);
      server.watcher.on("unlink", onFileEvent);

      // Fan each store change out to the clients watching that document, attributing
      // origin per client: the client that saved sees `self`, everyone else `external`.
      const unsubscribe = store.subscribe((change: StoreChange) => {
        const { sourceClient, ...document } = change;
        server.ws.send({ type: "custom", event: "samva:document", data: document });
        for (const client of clients) {
          if (client.docId !== change.id) continue;
          const origin =
            sourceClient !== undefined && sourceClient === client.clientId ? "self" : "external";
          client.push({ ...document, origin });
        }
      });
      const unsubscribeCatalog = store.subscribeCatalog(() => {
        for (const res of catalogClients) {
          res.write("event: samva:catalog\ndata: refresh\n\n");
        }
        server.ws.send({ type: "custom", event: "samva:catalog" });
      });

      let cleaned = false;
      const cleanup = (): void => {
        if (cleaned) return;
        cleaned = true;
        server.watcher.off("change", onFileEvent);
        server.watcher.off("add", onFileEvent);
        server.watcher.off("unlink", onFileEvent);
        server.watcher.off("close", cleanup);
        server.httpServer?.off("close", cleanup);
        unsubscribe();
        unsubscribeCatalog();
        for (const client of clients) client.res.end();
        clients.clear();
        for (const res of catalogClients) res.end();
        catalogClients.clear();
      };
      // In full mode this fires on server close; in middleware mode (no httpServer)
      // Vite closes the watcher with the server, which also covers middleware mode.
      server.httpServer?.once("close", cleanup);
      server.watcher.once("close", cleanup);

      const handler: Connect.NextHandleFunction = (req, res, next) => {
        const url = req.url ?? "";
        const pathname = url.split("?")[0] || "/";
        const query = new URLSearchParams(url.split("?")[1] ?? "");

        const apiRequest = pathname === apiPrefix || pathname.startsWith(`${apiPrefix}/`);
        if (!apiRequest && !underRoute(route, pathname)) return next();

        // A root-mounted editor is the default dedicated-server surface, but it
        // must never intercept Vite's own runtime/module URLs. Static requests
        // that are not editor bundle assets also fall through below.
        if (!apiRequest && route === "/" && isViteInternalPath(pathname)) return next();

        void (async () => {
          // ── JSON / SSE API ──
          if (pathname === `${apiPrefix}/capabilities`) {
            return sendJson(res, 200, {
              authenticated,
              ...(options.editorAffordances === undefined
                ? {}
                : { editorAffordances: options.editorAffordances }),
            });
          }

          if (pathname === `${apiPrefix}/templates`) {
            const catalog = await store.catalog();
            return sendJson(res, 200, {
              templates: catalog.templates,
              diagnostics: catalog.diagnostics,
            });
          }

          if (pathname === `${apiPrefix}/document`) {
            const id = query.get("id");
            if (!id) return sendJson(res, 400, { error: "missing id" });
            if (req.method === "POST") {
              if (!isTrustedSourceSave(req)) {
                return sendJson(res, 403, { error: "Source saves require the editor origin." });
              }
              let body: unknown;
              // oxlint-disable-next-line samva/no-try-catch-or-throw -- raw HTTP JSON parsing boundary
              try {
                body = JSON.parse(await readBody(req));
              } catch (error) {
                if (error instanceof EditorBodyTooLarge)
                  return sendJson(res, 413, { error: error.message });
                return sendJson(res, 400, { error: "malformed JSON body" });
              }
              if (
                !isObject(body) ||
                body["kind"] !== "authoredSource" ||
                typeof body["baseRev"] !== "string" ||
                typeof body["authoredSource"] !== "string"
              ) {
                return sendJson(res, 400, {
                  error: "Expected a revision-bound authored source update.",
                });
              }
              if (Buffer.byteLength(body["authoredSource"], "utf8") > EDITOR_MAX_SOURCE_BYTES)
                return sendJson(res, 413, { error: EDITOR_SOURCE_TOO_LARGE_MESSAGE });
              const outcome = await store.saveSource(
                id,
                body["baseRev"],
                body["authoredSource"],
                query.get("client") ?? undefined,
              );
              if (outcome.ok) return sendJson(res, 200, { rev: outcome.rev });
              return sendJson(
                res,
                outcome.kind === "conflict" ? 409 : outcome.kind === "missing" ? 404 : 422,
                outcome,
              );
            }
            if (req.method !== "GET") return sendJson(res, 405, { error: "Use GET or POST." });
            const snapshot = await store.open(id);
            if (snapshot === undefined) return sendJson(res, 404, { error: "template not found" });
            return sendJson(res, 200, snapshot);
          }

          if (pathname === `${apiPrefix}/fixture`) {
            const id = query.get("id");
            if (!id) return sendJson(res, 400, { error: "missing id" });
            if (req.method !== "POST") {
              return sendJson(res, 405, { error: "viewing a fixture is a POST" });
            }
            const raw = await readBody(req);
            // Raw HTTP boundary: malformed JSON is a client error, not a server crash.
            let body: unknown;
            // oxlint-disable-next-line samva/no-try-catch-or-throw -- raw HTTP JSON parsing boundary
            try {
              body = JSON.parse(raw);
            } catch {
              return sendJson(res, 400, { error: "malformed JSON body" });
            }
            if (!isObject(body) || typeof body["fixture"] !== "string") {
              return sendJson(res, 400, { error: "malformed JSON body" });
            }
            const outcome = await store.viewFixture(
              id,
              body["fixture"],
              query.get("client") ?? undefined,
            );
            if (outcome.ok) return sendJson(res, 200, {});
            return sendJson(res, outcome.kind === "missing" ? 404 : 422, { error: outcome.error });
          }

          // The compiled bytes a render points at, under the content address the
          // compiler wrote into it.
          if (pathname.startsWith(`${apiPrefix}/assets/`)) {
            const asset = store.asset(pathname.slice(`${apiPrefix}/assets/`.length));
            if (asset === undefined) return sendJson(res, 404, { error: "asset not found" });
            res.statusCode = 200;
            res.setHeader("content-type", asset.contentType);
            res.end(Buffer.from(asset.bytes));
            return;
          }

          if (pathname === `${apiPrefix}/events`) {
            const id = query.get("id");
            if (!id) return sendJson(res, 400, { error: "missing id" });
            // A subscription needs a baseline before the first edit, including when no document
            // or catalog request preceded it. Otherwise the edit becomes the initial load.
            await store.catalog();
            res.statusCode = 200;
            res.setHeader("content-type", "text/event-stream");
            res.setHeader("cache-control", "no-cache");
            res.setHeader("connection", "keep-alive");
            res.write(": connected\n\n");
            const client = createSseClient(res, id, query.get("client") ?? undefined);
            clients.add(client);
            req.on("close", () => clients.delete(client));
            return;
          }

          if (pathname === `${apiPrefix}/catalog-events`) {
            await store.catalog();
            res.statusCode = 200;
            res.setHeader("content-type", "text/event-stream");
            res.setHeader("cache-control", "no-cache");
            res.setHeader("connection", "keep-alive");
            res.write(": connected\n\n");
            catalogClients.add(res);
            req.on("close", () => catalogClients.delete(res));
            return;
          }

          if (apiRequest) return sendJson(res, 404, { error: "not found" });

          // ── Static editor SPA (mounted at `route`) ──
          // A page served at `route/` makes relative asset URLs resolve under it,
          // so a bare `route` must redirect to `route/` first.
          if (route !== "/" && pathname === route) {
            res.statusCode = 302;
            res.setHeader("location", `${route}/`);
            res.end();
            return;
          }
          const rel =
            route === "/"
              ? pathname.replace(/^\//, "")
              : pathname.slice(route.length).replace(/^\//, "");
          const file = rel === "" ? "index.html" : rel;
          if (await serveStatic(res, join(EDITOR_DIR, file))) return;
          // Never answer a missing asset with HTML. Let Vite or later customer
          // middleware own file-like paths; only navigation paths get the SPA.
          const assetPrefix = childRoute(route, "assets");
          if (
            hasFileExtension(pathname) ||
            pathname === assetPrefix ||
            pathname.startsWith(`${assetPrefix}/`)
          ) {
            return next();
          }
          // SPA fallback: unknown navigation paths render the app shell.
          if (await serveStatic(res, join(EDITOR_DIR, "index.html"))) return;
          return next();
        })().catch((error: unknown) => {
          sendJson(res, error instanceof EditorBodyTooLarge ? 413 : 500, {
            error: error instanceof Error ? error.message : String(error),
          });
        });
      };

      server.middlewares.use(handler);
    },
  };
};
