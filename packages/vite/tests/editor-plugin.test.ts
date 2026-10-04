import { readFile, rm, writeFile } from "node:fs/promises";
import { createServer as createHttpServer, request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "@effect/vitest";
import { inspectSourceElement } from "@samva/markup/edit";
import type { EmailElementSelection } from "@samva/markup/render";
import { createServer, resolveConfig, type ViteDevServer } from "vite";

import { EDITOR_SOURCE_TOO_LARGE_MESSAGE } from "../src/editor-store";
import { samvaEditor, type SamvaEditorPluginOptions } from "../src/index";
import {
  cleanupProjects,
  emailTemplate,
  LOGO,
  multiChannelTemplate,
  tempProject,
  writeFiles,
} from "./support/project";

// Real Vite dev-server integration for the editor surface. Exercises the FULL
// transport a browser host drives — capabilities, template discovery, the
// executed email render with its assets, fixture switching, and the SSE change
// stream backed by the actual file watcher — inside a live Vite context.

const ROUTE = "/__samva";
/** A partial the templates import; changing it must reach every template that uses it. */
const GREETING = `export const Greeting = (props: { name: string }) => (
  <p className="font-body bg-brand">Hello from a dependency, {props.name}</p>
);
`;
const FONT = new TextEncoder().encode("wOF2 editor font bytes");

/** An email template that imports a shared constant, an image and a project font through the theme. */
const EMAIL = `import { defineTemplate } from "@samva/markup";
import { Email } from "@samva/markup/email";
import { jsonSchema } from "@samva/markup/input-schema";

import logo from "./logo.png";
import { Greeting } from "../greeting";

export default defineTemplate({
  id: "welcome",
  schema: jsonSchema<{ name: string }>({
    type: "object",
    additionalProperties: false,
    required: ["name"],
    properties: { name: { type: "string", examples: ["Ada"] } },
  }),
  fixtures: { first: { name: "Ada" }, returning: { name: "Grace" } },
  email: {
    subject: () => "Welcome",
    body: (input) => (
      <Email>
        <Greeting name={input.name} />
        <p>Lead</p>
        <img src={logo} alt="Samva" width="12" height="12" />
      </Email>
    ),
  },
});
`;

interface EmailRender {
  readonly revision: string;
  readonly subject: string;
  readonly html: string;
  readonly text: string;
  readonly selections: ReadonlyArray<EmailElementSelection>;
}

interface Snapshot {
  readonly id: null;
  readonly name: string;
  readonly channel: string;
  readonly rev: string;
  readonly variables: ReadonlyArray<{ readonly name: string }>;
  readonly metadata: Record<string, unknown>;
  readonly origin: {
    readonly kind: "tsx";
    readonly file: string;
    readonly authoredSource?: string | undefined;
  };
  readonly access: { readonly kind: "editable" };
  /** Email lane. */
  readonly fixtures?: ReadonlyArray<string> | undefined;
  readonly fixture?: string | null | undefined;
  readonly render?: EmailRender | null | undefined;
  readonly diagnostics?: ReadonlyArray<{ readonly code: string }> | undefined;
}

const json = async (origin: string, path: string): Promise<{ status: number; body: unknown }> => {
  const response = await fetch(origin + path);
  return { status: response.status, body: await response.json().catch(() => undefined) };
};

/**
 * Idle bound for a single catalog poll or SSE frame. A cold Vite server
 * re-evaluates the whole project on add/unlink, so any budget spanning several
 * of those is a race; this bounds the gap between events instead, and a genuine
 * hang still fails well inside vitest's suite timeout.
 */
const IDLE_TIMEOUT_MS = 30_000;

const waitForCatalog = async <A>(
  origin: string,
  read: (body: unknown) => A | undefined,
  timeoutMs = IDLE_TIMEOUT_MS,
): Promise<A> => {
  const started = Date.now();
  for (;;) {
    const value = read((await json(origin, `${ROUTE}/api/templates`)).body);
    if (value !== undefined) return value;
    if (Date.now() - started >= timeoutMs) {
      throw new Error("timed out waiting for catalog state");
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
};

interface ChangeFrame {
  readonly id: string;
  readonly rev: string;
  readonly channel: string;
  readonly fixture?: string | null | undefined;
  readonly render?: EmailRender | null | undefined;
  readonly authoredSource?: string | undefined;
  readonly origin: "self" | "external";
}

const subscriptions = new Set<AbortController>();

/**
 * Bound one step of the subscription without capping the subscription itself.
 * A signal deadline would abort the streaming body too, which is the budget
 * this file is removing; racing a timer bounds only the step being awaited.
 */
const within = async <A>(work: Promise<A>, timeoutMs: number, reason: string): Promise<A> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${reason} after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};

/** Observe the server's connected frame before allowing the test to mutate its project. */
const subscribe = async (url: string, event: string, idleTimeoutMs = IDLE_TIMEOUT_MS) => {
  const controller = new AbortController();
  subscriptions.add(controller);
  const response = await within(
    fetch(url, { signal: controller.signal }),
    idleTimeoutMs,
    `SSE ${event} sent no response headers`,
  );
  expect(response.status).toBe(200);
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const readFrame = async (): Promise<string> => {
    for (;;) {
      const separator = buffer.indexOf("\n\n");
      if (separator !== -1) {
        const frame = buffer.slice(0, separator);
        buffer = buffer.slice(separator + 2);
        return frame;
      }
      // The idle bound is per read, so it restarts on every chunk.
      const { value, done } = await within(
        reader.read(),
        idleTimeoutMs,
        `SSE stream idle before ${event}`,
      );
      if (done) throw new Error(`SSE stream ended before ${event}`);
      buffer += decoder.decode(value, { stream: true });
    }
  };
  expect(await readFrame()).toBe(": connected");
  return {
    next: async (): Promise<string> => {
      try {
        for (;;) {
          const lines = (await readFrame()).split("\n");
          if (!lines.includes(`event: ${event}`)) continue;
          const data = lines.find((line) => line.startsWith("data: "));
          if (data === undefined) throw new Error(`SSE ${event} frame has no data`);
          return data.slice("data: ".length);
        }
      } finally {
        controller.abort();
        subscriptions.delete(controller);
      }
    },
  };
};

const subscribeToChanges = async (url: string) => {
  const stream = await subscribe(url, "samva:change");
  return { next: async (): Promise<ChangeFrame> => JSON.parse(await stream.next()) };
};

const subscribeToCatalog = (url: string) => subscribe(url, "samva:catalog");

const bootServer = async (
  root: string,
  route: string | null = ROUTE,
  options: SamvaEditorPluginOptions = {},
): Promise<{ server: ViteDevServer; http: Server; origin: string }> => {
  const plugin =
    route === null
      ? samvaEditor({ ...options, templatesDir: "templates" })
      : samvaEditor({ ...options, templatesDir: "templates", route });
  const server = await createServer({
    root,
    logLevel: "silent",
    server: { middlewareMode: true, hmr: false },
    plugins: [plugin],
  });
  const http = createHttpServer(server.middlewares);
  await new Promise<void>((done) => http.listen(0, "127.0.0.1", done));
  const address = http.address() as AddressInfo;
  return { server, http, origin: `http://127.0.0.1:${address.port}` };
};

const HELPER = "export default function Shared() { return <p>Shared</p>; }\n";

const writeProject = async (root: string, files: Readonly<Record<string, string | Uint8Array>>) =>
  writeFiles(root, files);

describe("samvaEditor vite plugin", () => {
  let root: string;
  let server: ViteDevServer | undefined;
  let http: Server | undefined;
  let origin: string;

  beforeEach(async () => {
    server = undefined;
    http = undefined;
    vi.stubEnv("SAMVA_API_KEY", "");
    root = await tempProject({
      "templates/order.tsx": multiChannelTemplate("order"),
      "templates/welcome.tsx": EMAIL,
      "templates/logo.png": LOGO,
      "templates/named-only.tsx": `export const Named = () => null;\n`,
      "templates/helper.tsx": HELPER,
      "greeting.tsx": GREETING,
      "fonts/body.woff2": FONT,
      "theme.css": `@font-face { font-family: "Editor Body"; src: url("./fonts/body.woff2") format("woff2"); }\n@theme { --color-brand: #4f46e5; --color-brand-dark: #a5b4fc; --font-body: "Editor Body", Arial, sans-serif; }\n`,
    });
    ({ server, http, origin } = await bootServer(root));
  });

  afterEach(async () => {
    for (const controller of subscriptions) controller.abort();
    subscriptions.clear();
    try {
      if (http !== undefined) await new Promise<void>((done) => http!.close(() => done()));
    } finally {
      try {
        await server?.close();
      } finally {
        vi.unstubAllEnvs();
        await cleanupProjects();
      }
    }
  });

  it("reports the unauthenticated capability set with no API key", async () => {
    const { status, body } = await json(origin, `${ROUTE}/api/capabilities`);
    expect(status).toBe(200);
    expect(body).toEqual({ authenticated: false });
  });

  it("binds the editor server to loopback with a bounded localhost allowlist", () => {
    expect(server?.config.server.host).toBe("127.0.0.1");
    const allowedHosts = server?.config.server.allowedHosts;
    expect(Array.isArray(allowedHosts)).toBe(true);
    if (!Array.isArray(allowedHosts)) throw new Error("expected a bounded host allowlist");
    expect(allowedHosts).toEqual(expect.arrayContaining(["localhost", ".localhost"]));
    expect(
      allowedHosts.every((host) => ["localhost", ".localhost", "127.0.0.1"].includes(host)),
    ).toBe(true);
  });

  it("discovers one document per channel and leaves helper modules out", async () => {
    const { body } = await json(origin, `${ROUTE}/api/templates`);
    const catalog = body as {
      readonly templates: ReadonlyArray<{
        readonly id: string;
        readonly channel: string;
        readonly sourceKind: string;
      }>;
      readonly diagnostics: ReadonlyArray<{ readonly file: string; readonly code: string }>;
    };
    expect(catalog.templates).toEqual([
      expect.objectContaining({ id: "templates/order.tsx", channel: "email", sourceKind: "tsx" }),
      expect.objectContaining({ id: "templates/order.tsx#sms", channel: "sms" }),
      expect.objectContaining({ id: "templates/order.tsx#whatsapp", channel: "whatsapp" }),
      expect.objectContaining({ id: "templates/welcome.tsx", channel: "email" }),
    ]);
    expect(catalog.diagnostics).toEqual([]);
  });

  it("opens an email document as authored code plus one stamped render of the IR", async () => {
    const { status, body } = await json(origin, `${ROUTE}/api/document?id=templates/welcome.tsx`);
    expect(status).toBe(200);
    const snapshot = body as Snapshot;
    expect(snapshot.origin.kind).toBe("tsx");
    expect(snapshot.origin.file).toBe("templates/welcome.tsx");
    // The greeting paragraph comes from the partial, the lead paragraph from the template.
    const paragraph = snapshot.render?.selections.find(
      (selection) =>
        selection.tag === "p" && selection.origins[0]?.fileName === snapshot.origin.file,
    );
    const sourceOrigin = paragraph?.origins[0];
    expect(sourceOrigin?.fileName).toBe(snapshot.origin.file);
    expect(
      sourceOrigin && inspectSourceElement(EMAIL, snapshot.origin.file, sourceOrigin),
    ).not.toBeNull();
    expect(snapshot.origin.authoredSource).toBe(EMAIL);
    expect(snapshot.access.kind).toBe("editable");
    expect(snapshot.channel).toBe("email");
    expect(snapshot.fixtures).toEqual(["first", "returning"]);
    expect(snapshot.fixture).toBe("first");
    expect(snapshot.variables).toEqual([{ name: "name", required: true, sample: "Ada" }]);
    expect(snapshot.diagnostics).toEqual([]);
    expect(snapshot.render?.revision).toBe(snapshot.rev);
    expect(snapshot.render?.subject).toBe("Welcome");
    expect(snapshot.render?.html).toContain("Hello from a dependency, Ada");
    expect(snapshot.render?.html).toContain("data-samva-instance=");
  });

  it("serves the compiled asset a render points at", async () => {
    const snapshot = (await json(origin, `${ROUTE}/api/document?id=templates/welcome.tsx`))
      .body as Snapshot;
    const src = snapshot.render?.html.match(/src="([^"]+)"/)?.[1];
    expect(src).toMatch(new RegExp(`^${ROUTE}/api/assets/[0-9a-f]{64}\\.png$`));
    const response = await fetch(`${origin}${src!}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(LOGO);
    expect(await fetch(`${origin}${ROUTE}/api/assets/nope.png`).then((r) => r.status)).toBe(404);
  });

  it("serves the project font the theme declares from the same asset route", async () => {
    const snapshot = (await json(origin, `${ROUTE}/api/document?id=templates/welcome.tsx`))
      .body as Snapshot;
    expect(snapshot.diagnostics).toEqual([]);
    const html = snapshot.render?.html ?? "";
    const src = /@font-face\{[^}]*src:url\(([^)]+)\)/.exec(html)?.[1];
    expect(html).toMatch(/<!--\[if !mso\]><!--><style[^>]*>@font-face/);
    expect(src).toMatch(new RegExp(`^${ROUTE}/api/assets/[0-9a-f]{64}\\.woff2$`));
    const response = await fetch(`${origin}${src!}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("font/woff2");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(FONT);
  });

  it("opens the SMS and WhatsApp documents of the same template", async () => {
    const sms = (
      await json(
        origin,
        `${ROUTE}/api/document?id=${encodeURIComponent("templates/order.tsx#sms")}`,
      )
    ).body as { channel: string; render: { text: string }; origin: { file: string } };
    expect(sms).toMatchObject({
      channel: "sms",
      render: { text: "Hi Ada, your order shipped." },
      origin: { file: "templates/order.tsx" },
    });
    const whatsapp = (
      await json(
        origin,
        `${ROUTE}/api/document?id=${encodeURIComponent("templates/order.tsx#whatsapp")}`,
      )
    ).body as { channel: string; render: { body: string } };
    expect(whatsapp).toMatchObject({
      channel: "whatsapp",
      render: { body: "Hi Ada, your order shipped." },
    });
  });

  it("decodes UTF-8 once after collecting chunked HTTP bytes", async () => {
    const body = Buffer.from(JSON.stringify({ fixture: "é" }));
    const result = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const outgoing = request(
        `${origin}${ROUTE}/api/fixture?id=templates/welcome.tsx`,
        { method: "POST" },
        (incoming) => {
          let response = "";
          incoming.setEncoding("utf8");
          incoming.on("data", (chunk) => {
            response += chunk;
          });
          incoming.on("end", () => resolve({ status: incoming.statusCode!, body: response }));
          incoming.on("error", reject);
        },
      );
      outgoing.on("error", reject);
      for (const byte of body) outgoing.write(Buffer.from([byte]));
      outgoing.end();
    });
    expect(result.status).toBe(422);
    expect(JSON.parse(result.body).error).toContain('"é"');
  });

  it("bounds request and authored-source UTF-8 bytes without changing the entry", async () => {
    const endpoint = `${origin}${ROUTE}/api/document?id=templates/welcome.tsx`;
    const snapshot = (await (await fetch(endpoint)).json()) as { rev: string };
    const before = await readFile(join(root, "templates", "welcome.tsx"), "utf8");
    for (const body of [
      JSON.stringify({
        kind: "authoredSource",
        baseRev: snapshot.rev,
        authoredSource: "é".repeat(524289),
      }),
      JSON.stringify({ fixture: "x".repeat(7 * 1024 * 1024) }),
    ]) {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { Origin: origin },
        body,
      });
      expect(response.status).toBe(413);
      if (body.includes("authoredSource"))
        expect(((await response.json()) as { error: string }).error).toBe(
          EDITOR_SOURCE_TOO_LARGE_MESSAGE,
        );
    }
    expect(await readFile(join(root, "templates", "welcome.tsx"), "utf8")).toBe(before);
  });

  it("refuses obsolete unversioned source writes", async () => {
    const save = await fetch(`${origin}${ROUTE}/api/document?id=templates/welcome.tsx`, {
      method: "POST",
      headers: { "content-type": "application/json", Origin: origin },
      body: JSON.stringify({ kind: "source", source: "<Sms />" }),
    });
    expect(save.status).toBe(400);
    expect(await save.json()).toEqual({
      error: "Expected a revision-bound authored source update.",
    });
  });

  it("requires a loopback editor origin for privileged source saves", async () => {
    const endpoint = `${origin}${ROUTE}/api/document?id=templates/welcome.tsx`;
    const snapshot = (await (await fetch(endpoint)).json()) as { rev: string };
    const authoredSource = `${EMAIL}\n// saved through the privileged editor boundary\n`;
    const body = JSON.stringify({
      kind: "authoredSource",
      baseRev: snapshot.rev,
      authoredSource,
    });

    for (const headers of [
      { "content-type": "application/json" },
      {
        "content-type": "application/json",
        Host: "attacker.example",
        Origin: "https://attacker.example",
      },
    ]) {
      const response = await fetch(endpoint, { method: "POST", headers, body });
      expect(response.status).toBe(403);
    }

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", Origin: origin },
      body,
    });
    expect(response.status).toBe(200);
    expect(await readFile(join(root, "templates", "welcome.tsx"), "utf8")).toBe(authoredSource);
  });

  it("answers a stale save with a conflict and the revision on disk", async () => {
    const endpoint = `${origin}${ROUTE}/api/document?id=templates/welcome.tsx`;
    const snapshot = (await (await fetch(endpoint)).json()) as { rev: string };
    await writeFile(join(root, "templates", "welcome.tsx"), `${EMAIL}\n// elsewhere\n`, "utf8");
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", Origin: origin },
      body: JSON.stringify({
        kind: "authoredSource",
        baseRev: snapshot.rev,
        authoredSource: `${EMAIL}\n// mine\n`,
      }),
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ ok: false, kind: "conflict" });
    expect(await readFile(join(root, "templates", "welcome.tsx"), "utf8")).toContain(
      "// elsewhere",
    );
  });

  it("shows another declared fixture at the same revision", async () => {
    const opened = (await json(origin, `${ROUTE}/api/document?id=templates/welcome.tsx`))
      .body as Snapshot;
    const waiting = await subscribeToChanges(
      `${origin}${ROUTE}/api/events?id=templates/welcome.tsx&client=a`,
    );
    const response = await fetch(
      `${origin}${ROUTE}/api/fixture?id=templates/welcome.tsx&client=a`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fixture: "returning" }),
      },
    );
    expect(response.status).toBe(200);
    const change = await waiting.next();
    expect(change.origin).toBe("self");
    expect(change.rev).toBe(opened.rev);
    expect(change.fixture).toBe("returning");
    expect(change.render?.html).toContain("Hello from a dependency, Grace");
  });

  it("tells the saving client the change is its own and every other client it is external", async () => {
    // Two editors open on one document is the ordinary case — a second tab, or
    // the agent panel beside the canvas. The saver must see `self` so it does
    // not reload over its own edit, and everyone else `external` so they do.
    const saver = await subscribeToChanges(
      `${origin}${ROUTE}/api/events?id=templates/welcome.tsx&client=a`,
    );
    const observer = await subscribeToChanges(
      `${origin}${ROUTE}/api/events?id=templates/welcome.tsx&client=b`,
    );
    const saverFrame = saver.next();
    const observerFrame = observer.next();

    const response = await fetch(
      `${origin}${ROUTE}/api/fixture?id=templates/welcome.tsx&client=a`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fixture: "returning" }),
      },
    );
    expect(response.status).toBe(200);

    const [own, foreign] = await Promise.all([saverFrame, observerFrame]);
    expect(own.origin).toBe("self");
    expect(foreign.origin).toBe("external");
    // One change, delivered to both: the payload apart from origin is identical.
    expect(foreign.fixture).toBe("returning");
    expect(foreign.rev).toBe(own.rev);
    expect(foreign.render?.html).toBe(own.render?.html);
  });

  it("refuses an undeclared fixture, an unknown document, and a malformed body", async () => {
    const post = (path: string, body: string) =>
      fetch(`${origin}${ROUTE}/api/fixture?${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      });
    expect(
      await post("id=templates/welcome.tsx", JSON.stringify({ fixture: "nope" })).then(
        (r) => r.status,
      ),
    ).toBe(422);
    expect(
      await post("id=templates/missing.tsx", JSON.stringify({ fixture: "first" })).then(
        (r) => r.status,
      ),
    ).toBe(404);
    expect(await post("id=templates/welcome.tsx", "{not json").then((r) => r.status)).toBe(400);
    expect(
      await post("id=templates/welcome.tsx", JSON.stringify("a string")).then((r) => r.status),
    ).toBe(400);
  });

  it("redirects the bare route to a trailing slash so relative asset URLs resolve", async () => {
    const response = await fetch(`${origin}${ROUTE}`, { redirect: "manual" });
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(`${ROUTE}/`);
  });

  it("serves editor assets within a configured route", async () => {
    const html = await fetch(`${origin}${ROUTE}/`).then((response) => response.text());
    const asset = html.match(/\.\/assets\/[^"']+/)?.[0];
    expect(asset).toBeDefined();
    const response = await fetch(`${origin}${ROUTE}/${asset!.replace(/^\.\//, "")}`);
    expect(response.status).toBe(200);
  });

  it("404s an unknown API path", async () => {
    const { status } = await json(origin, `${ROUTE}/api/nope`);
    expect(status).toBe(404);
  });

  it("re-renders an email document when an imported dependency changes", async () => {
    const opened = (await json(origin, `${ROUTE}/api/document?id=templates/welcome.tsx`))
      .body as Snapshot;
    const waiting = await subscribeToChanges(
      `${origin}${ROUTE}/api/events?id=templates/welcome.tsx`,
    );
    await writeFile(
      join(root, "greeting.tsx"),
      GREETING.replace("Hello from a dependency", "Updated dependency"),
      "utf8",
    );
    const change = await waiting.next();
    expect(change.render?.html).toContain("Updated dependency, Ada");
    expect(change.rev).not.toBe(opened.rev);
    expect(change.authoredSource).toBe(EMAIL);
  });

  it("moves the revision when authored TSX changes", async () => {
    const id = encodeURIComponent("templates/order.tsx#sms");
    const opened = (await json(origin, `${ROUTE}/api/document?id=${id}`)).body as Snapshot;
    const authored = `${multiChannelTemplate("order")}\n// source-only comment\n`;
    const waiting = await subscribeToChanges(`${origin}${ROUTE}/api/events?id=${id}`);
    await writeFile(join(root, "templates", "order.tsx"), authored, "utf8");
    const change = await waiting.next();
    expect(change.rev).not.toBe(opened.rev);
    expect(change.authoredSource).toBe(authored);
    expect(change.origin).toBe("external");
  });

  it("publishes a distinct catalog refresh for add and unlink", async () => {
    const added = await subscribeToCatalog(`${origin}${ROUTE}/api/catalog-events`);
    const path = join(root, "templates", "temporary.tsx");
    await writeFile(path, emailTemplate("temporary"), "utf8");
    await added.next();
    await waitForCatalog(origin, (body) => {
      const catalog = body as { readonly templates: ReadonlyArray<{ readonly id: string }> };
      return catalog.templates.some((template) => template.id === "templates/temporary.tsx")
        ? catalog
        : undefined;
    });

    const removed = await subscribeToCatalog(`${origin}${ROUTE}/api/catalog-events`);
    await rm(path);
    await removed.next();
    await waitForCatalog(origin, (body) => {
      const catalog = body as { readonly templates: ReadonlyArray<{ readonly id: string }> };
      return catalog.templates.some((template) => template.id === "templates/temporary.tsx")
        ? undefined
        : catalog;
    });
  });

  it("renders theme fonts and colors and rebuilds the viewed fixture on theme changes", async () => {
    const opened = (await json(origin, `${ROUTE}/api/document?id=templates/welcome.tsx`))
      .body as Snapshot;
    expect(opened.render?.html).toContain("font-family:&quot;Editor Body&quot;, Arial, sans-serif");
    expect(opened.render?.html).toContain("background-color:#4f46e5");
    await fetch(`${origin}${ROUTE}/api/fixture?id=templates/welcome.tsx&client=theme-test`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fixture: "returning" }),
    });
    const changed = await subscribeToChanges(
      `${origin}${ROUTE}/api/events?id=templates/welcome.tsx&client=theme-test`,
    );
    await writeFile(
      join(root, "theme.css"),
      "@theme { --color-brand: #123456; --color-brand-dark: #654321; --font-body: Courier New, monospace; }",
    );
    const rendered = await changed.next();
    expect(rendered.fixture).toBe("returning");
    expect(rendered.render?.html).toContain("Grace");
    expect(rendered.render?.html).toContain("font-family:Courier New, monospace");
    expect(rendered.render?.html).toContain("background-color:#123456");
    expect(rendered.render?.html).not.toContain("#4f46e5");
    expect(rendered.render?.html).not.toContain("Editor Body");
    expect(rendered.render?.html).not.toContain("@font-face");
    const current = (await json(origin, `${ROUTE}/api/document?id=templates/welcome.tsx`))
      .body as Snapshot;
    expect(current.render?.html).toBe(rendered.render?.html);
    await fetch(`${origin}${ROUTE}/api/fixture?id=templates/welcome.tsx&client=theme-test`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fixture: "first" }),
    });
    const first = (await json(origin, `${ROUTE}/api/document?id=templates/welcome.tsx`))
      .body as Snapshot;
    expect(first.render?.html).toContain("Ada");
    expect(first.render?.html).toContain("background-color:#123456");
  });

  it("uses Tailwind validation for full CSS themes and refreshes after removal/restoration", async () => {
    expect((await json(origin, `${ROUTE}/api/document?id=templates/welcome.tsx`)).status).toBe(200);
    const themePath = join(root, "theme.css");
    const changed = await subscribeToChanges(
      `${origin}${ROUTE}/api/events?id=templates/welcome.tsx`,
    );
    await writeFile(
      themePath,
      "@theme { --color-brand: oklch(63.7% 0.237 25.331); --spacing-card: 1rem; }",
    );
    expect((await changed.next()).render?.html).toContain("background-color:#fb2c36");
    const catalog = (await json(origin, `${ROUTE}/api/templates`)).body as {
      diagnostics: ReadonlyArray<{ file: string }>;
    };
    expect(catalog.diagnostics.filter((finding) => finding.file === "theme.css")).toEqual([]);
    const removed = await subscribeToChanges(
      `${origin}${ROUTE}/api/events?id=templates/welcome.tsx`,
    );
    await rm(themePath);
    expect((await removed.next()).render?.html).not.toContain("background-color:#fb2c36");
    const restored = await subscribeToChanges(
      `${origin}${ROUTE}/api/events?id=templates/welcome.tsx`,
    );
    await writeFile(themePath, "@theme { --color-brand: #222222; }");
    expect((await restored.next()).render?.html).toContain("background-color:#222222");
  });

  it("keeps a document that stops compiling, with a null render and the findings, and recovers", async () => {
    const path = join(root, "templates", "welcome.tsx");
    const broken = await subscribeToChanges(
      `${origin}${ROUTE}/api/events?id=templates/welcome.tsx`,
    );
    await writeFile(
      path,
      EMAIL.replace("<Greeting name={input.name} />", "<p>{input.nmae}</p>"),
      "utf8",
    );
    const failed = await broken.next();
    expect(failed.render).toBeNull();
    const snapshot = (await json(origin, `${ROUTE}/api/document?id=templates/welcome.tsx`))
      .body as Snapshot;
    expect(snapshot.diagnostics).toContainEqual(expect.objectContaining({ code: "unknown-field" }));
    const catalog = (await json(origin, `${ROUTE}/api/templates`)).body as {
      templates: ReadonlyArray<{ id: string }>;
      diagnostics: ReadonlyArray<{ file: string; code: string }>;
    };
    expect(catalog.templates.map((template) => template.id)).toContain("templates/welcome.tsx");
    expect(catalog.diagnostics).toContainEqual(
      expect.objectContaining({ file: "templates/welcome.tsx", code: "unknown-field" }),
    );

    const fixed = await subscribeToChanges(`${origin}${ROUTE}/api/events?id=templates/welcome.tsx`);
    await writeFile(path, EMAIL, "utf8");
    expect((await fixed.next()).render?.html).toContain("Hello from a dependency, Ada");
  });

  it("removes a catalog entry when its source becomes an ordinary helper", async () => {
    const path = join(root, "templates", "welcome.tsx");
    const removed = await subscribeToCatalog(`${origin}${ROUTE}/api/catalog-events`);
    await writeFile(path, `export const Named = () => null;\n`, "utf8");
    await removed.next();
    await waitForCatalog(origin, (body) => {
      const catalog = body as { templates: ReadonlyArray<{ id: string }> };
      return catalog.templates.some((template) => template.id === "templates/welcome.tsx")
        ? undefined
        : catalog;
    });
    expect((await json(origin, `${ROUTE}/api/document?id=templates/welcome.tsx`)).status).toBe(404);
    const restored = await subscribeToCatalog(`${origin}${ROUTE}/api/catalog-events`);
    await writeFile(path, EMAIL, "utf8");
    await restored.next();
    await waitForCatalog(origin, (body) => {
      const payload = body as { templates: ReadonlyArray<{ id: string }> };
      return payload.templates.some((template) => template.id === "templates/welcome.tsx")
        ? payload
        : undefined;
    });
  });

  it("does not react to the brand cache under .samva", async () => {
    const opened = (await json(origin, `${ROUTE}/api/document?id=templates/welcome.tsx`))
      .body as Snapshot;
    await writeProject(root, { ".samva/brands/acme.json": "{}" });
    const marker = await subscribeToChanges(
      `${origin}${ROUTE}/api/events?id=templates/welcome.tsx`,
    );
    await writeFile(
      join(root, "greeting.tsx"),
      GREETING.replace("Hello from a dependency", "After cache"),
      "utf8",
    );
    const change = await marker.next();
    expect(change.render?.html).toContain("After cache");
    expect(change.rev).not.toBe(opened.rev);
  });

  it("does not capture a sibling path outside the route boundary", async () => {
    // `/__samva-other` must NOT be captured by a `/__samva` mount.
    const response = await fetch(`${origin}${ROUTE}ial/api/capabilities`);
    expect(await response.text()).not.toContain("authenticated");
  });

  it("renders a non-Samva brand through the plain plugin", async () => {
    vi.stubEnv("SAMVA_API_KEY", "");
    await writeProject(root, {
      "theme.css": '@import "studio:brand";',
      "templates/welcome.tsx": emailTemplate("welcome", "Hello", {
        imports: 'import { BrandFooter } from "studio:brand";',
        body: '<Email><p className="bg-brand">Hello {input.name}</p><BrandFooter /></Email>',
      }),
    });
    const branded = await bootServer(root, ROUTE, {
      brandPlugin: {
        specifier: "studio:brand",
        footerAttribute: "data-studio-footer",
        unsubscribeRowAttribute: "data-studio-unsubscribe",
        unsubscribeUrlPlaceholder: "{{studio.unsubscribe}}",
        noTrackAttribute: "data-studio-no-track",
      },
      brandResolver: {
        resolve: async () => ({
          ok: true,
          brand: { slug: "studio", css: "@theme { --color-brand: #e11d48; }" },
          source: "studio",
          warnings: [],
        }),
      },
    });
    try {
      const { status, body } = await json(
        branded.origin,
        `${ROUTE}/api/document?id=templates/welcome.tsx`,
      );
      expect(status).toBe(200);
      const html = (body as Snapshot).render?.html;
      expect(html).toContain("#e11d48");
      expect(html).toContain('data-studio-footer=""');
      expect(html).toContain("data-studio-no-track");
      expect(html).toContain('href="{{studio.unsubscribe}}"');
      expect((body as Snapshot).diagnostics).not.toContainEqual(
        expect.objectContaining({ code: "brand-unavailable" }),
      );
    } finally {
      await new Promise<void>((done) => branded.http.close(() => done()));
      await branded.server.close();
    }
  });

  it("lights up the authenticated capability set when the host enables it", async () => {
    const authed = await bootServer(root, ROUTE, { authenticated: true });
    try {
      const { body } = await json(authed.origin, `${ROUTE}/api/capabilities`);
      expect(body).toEqual({ authenticated: true });
    } finally {
      await new Promise<void>((done) => authed.http.close(() => done()));
      await authed.server.close();
    }
  });
});

describe("samvaEditor watcher configuration", () => {
  it("tracks pending writes even when the host chooses its own bind address", async () => {
    const config = await resolveConfig(
      { configFile: false, plugins: [samvaEditor()], server: { host: "127.0.0.2" } },
      "serve",
    );
    expect(config.server.host).toBe("127.0.0.2");
    expect(config.server.watch).toMatchObject({
      awaitWriteFinish: { stabilityThreshold: 50, pollInterval: 10 },
    });
  });

  it("preserves explicit watcher options", async () => {
    const watch = {
      ignored: ["**/custom-cache/**"],
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 20 },
    };
    const config = await resolveConfig(
      { configFile: false, plugins: [samvaEditor()], server: { watch } },
      "serve",
    );
    expect(config.server.watch).toMatchObject(watch);
  });

  it("preserves a disabled watcher", async () => {
    const config = await resolveConfig(
      { configFile: false, plugins: [samvaEditor()], server: { watch: null } },
      "serve",
    );
    expect(config.server.watch).toBeNull();
  });
});

describe("samvaEditor directories", () => {
  afterEach(cleanupProjects);

  it("finds templates/ and emails/ with no configuration", async () => {
    const root = await tempProject({
      "templates/a.tsx": emailTemplate("a"),
      "emails/b.tsx": emailTemplate("b"),
    });
    const server = await createServer({
      root,
      logLevel: "silent",
      server: { middlewareMode: true, hmr: false },
      plugins: [samvaEditor()],
    });
    const http = createHttpServer(server.middlewares);
    await new Promise<void>((done) => http.listen(0, "127.0.0.1", done));
    const origin = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
    try {
      const catalog = (await json(origin, "/api/templates")).body as {
        templates: ReadonlyArray<{ id: string }>;
      };
      expect(catalog.templates.map((template) => template.id)).toEqual([
        "emails/b.tsx",
        "templates/a.tsx",
      ]);
    } finally {
      await new Promise<void>((done) => http.close(() => done()));
      await server.close();
    }
  });

  it("honors templatesDir and a project root above the Vite root", async () => {
    const root = await tempProject({
      "packages/site/vite.config.ts": "export default {};\n",
      "shared/templates/c.tsx": emailTemplate("c"),
      "theme.css": "@theme { --color-brand: #abcdef; }\n",
    });
    const server = await createServer({
      root: join(root, "packages/site"),
      configFile: false,
      logLevel: "silent",
      server: { middlewareMode: true, hmr: false },
      plugins: [samvaEditor({ projectRoot: "../..", templatesDir: "shared/templates" })],
    });
    const http = createHttpServer(server.middlewares);
    await new Promise<void>((done) => http.listen(0, "127.0.0.1", done));
    const origin = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
    try {
      const catalog = (await json(origin, "/api/templates")).body as {
        templates: ReadonlyArray<{ id: string }>;
      };
      expect(catalog.templates.map((template) => template.id)).toEqual(["shared/templates/c.tsx"]);
      const document = (await json(origin, "/api/document?id=shared/templates/c.tsx"))
        .body as Snapshot;
      expect(document.render?.html).toContain("#abcdef");
    } finally {
      await new Promise<void>((done) => http.close(() => done()));
      await server.close();
    }
  });
});

describe("samvaEditor stylesheet isolation", () => {
  afterEach(cleanupProjects);

  it("renders each entry with only its own imported stylesheet", async () => {
    const files: Record<string, string | Uint8Array> = {
      "greeting.tsx": GREETING,
      "templates/logo.png": LOGO,
    };
    for (const [id, color] of [
      ["first", "#112233"],
      ["second", "#445566"],
    ] as const) {
      files[`templates/${id}.css`] = `.entry { color: ${color}; }`;
      files[`templates/${id}.tsx`] = EMAIL.replace('id: "welcome"', `id: "${id}"`)
        .replace("import logo from", `import "./${id}.css";\nimport logo from`)
        .replace("<p>Lead</p>", '<p className="entry">Lead</p>');
    }
    const root = await tempProject(files);
    const running = await bootServer(root);
    try {
      await json(running.origin, `${ROUTE}/api/templates`);
      const first = (await json(running.origin, `${ROUTE}/api/document?id=templates/first.tsx`))
        .body as Snapshot;
      const second = (await json(running.origin, `${ROUTE}/api/document?id=templates/second.tsx`))
        .body as Snapshot;
      expect(first.render?.html).toContain("color:#112233");
      expect(first.render?.html).not.toContain("#445566");
      expect(second.render?.html).toContain("color:#445566");
      expect(second.render?.html).not.toContain("#112233");
    } finally {
      await new Promise<void>((done) => running.http.close(() => done()));
      await running.server.close();
    }
  });
});

describe("samvaEditor with an unparseable file in the project", () => {
  afterEach(cleanupProjects);

  // The compiler reads an entry and the files it imports, so a file it cannot parse is a finding on
  // that file and every template that does not import it keeps its render.
  it("reports the file and keeps rendering the templates that do not import it", async () => {
    const root = await tempProject({
      "greeting.tsx": GREETING,
      "templates/logo.png": LOGO,
      "templates/welcome.tsx": EMAIL,
    });
    const running = await bootServer(root);
    try {
      const opened = (await json(running.origin, `${ROUTE}/api/document?id=templates/welcome.tsx`))
        .body as Snapshot;
      expect(opened.render).not.toBeNull();
      await writeFile(join(root, "templates/malformed.tsx"), `export default function (\n`, "utf8");
      const catalog = await waitForCatalog(running.origin, (body) => {
        const payload = body as {
          readonly diagnostics: ReadonlyArray<{ readonly file: string; readonly code: string }>;
        };
        return payload.diagnostics.some((item) => item.file === "templates/malformed.tsx")
          ? payload
          : undefined;
      });
      expect(catalog.diagnostics).toContainEqual(
        expect.objectContaining({ file: "templates/malformed.tsx", code: "syntax-error" }),
      );
      const snapshot = (
        await json(running.origin, `${ROUTE}/api/document?id=templates/welcome.tsx`)
      ).body as Snapshot;
      expect(snapshot.render).not.toBeNull();
      expect(snapshot.diagnostics).not.toContainEqual(
        expect.objectContaining({ file: "templates/malformed.tsx" }),
      );
    } finally {
      await new Promise<void>((done) => running.http.close(() => done()));
      await running.server.close();
    }
  });
});

describe("samvaEditor route validation", () => {
  afterEach(cleanupProjects);

  it("accepts root and normalized nested routes but rejects invalid paths", () => {
    expect(() => samvaEditor({ route: "editor" })).toThrow();
    expect(() => samvaEditor({ route: "/bad//route" })).toThrow();
    expect(() => samvaEditor({ route: "/" })).not.toThrow();
    expect(() => samvaEditor({ route: "/__samva/" })).not.toThrow();
  });

  it("defaults to a dedicated root UI with sibling API/assets and passes Vite internals through", async () => {
    const root = await tempProject({ "templates/order.tsx": multiChannelTemplate("order") });
    const running = await bootServer(root, null);
    try {
      const ui = await fetch(`${running.origin}/`);
      expect(ui.status).toBe(200);
      const html = await ui.text();
      const asset = html.match(/\.\/assets\/[^"']+/)?.[0];
      expect(asset).toBeDefined();
      expect(
        await fetch(`${running.origin}/${asset!.replace(/^\.\//, "")}`).then(
          (response) => response.status,
        ),
      ).toBe(200);
      expect((await json(running.origin, "/api/capabilities")).status).toBe(200);
      expect(
        await fetch(`${running.origin}/nested/editor/path`).then((response) => response.status),
      ).toBe(200);
      expect(await fetch(`${running.origin}/missing.svg`).then((response) => response.status)).toBe(
        404,
      );
      expect(
        await fetch(`${running.origin}/missing.dark.svg`).then((response) => response.status),
      ).toBe(404);
      expect(
        await fetch(`${running.origin}/@vite/client`).then((response) => response.status),
      ).toBe(200);
    } finally {
      await new Promise<void>((done) => running.http.close(() => done()));
      await running.server.close();
    }
  });
});
