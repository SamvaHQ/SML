import { createServer } from "node:net";

import { afterEach, describe, expect, it } from "@effect/vitest";

import { startDevServer } from "../src/dev";
import {
  cleanupProjects,
  emailTemplate,
  multiChannelTemplate,
  tempProject,
} from "./support/project";

afterEach(cleanupProjects);

const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const probe = createServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });

describe("startDevServer", () => {
  it("serves the editor for a project with no config file, and closes", async () => {
    const root = await tempProject({
      // A config the server must not load.
      "vite.config.ts": 'throw new Error("vite.config.ts was loaded");\n',
      "templates/order.tsx": multiChannelTemplate("order"),
      "emails/welcome.tsx": emailTemplate("welcome"),
    });
    const port = await freePort();
    const server = await startDevServer({ root, port, host: "127.0.0.1" });
    try {
      expect(server.url).toBe(`http://127.0.0.1:${port}/`);
      const page = await fetch(server.url);
      expect(page.status).toBe(200);
      expect(await page.text()).toContain("<div id=");
      const catalog = (await (await fetch(`${server.url}api/templates`)).json()) as {
        templates: ReadonlyArray<{ id: string }>;
      };
      expect(catalog.templates.map((template) => template.id)).toEqual([
        "emails/welcome.tsx",
        "templates/order.tsx",
        "templates/order.tsx#sms",
        "templates/order.tsx#whatsapp",
      ]);
    } finally {
      await server.close();
    }
    await expect(fetch(server.url)).rejects.toThrow();
  });

  it("scans only the configured directory", async () => {
    const root = await tempProject({
      "templates/a.tsx": emailTemplate("a"),
      "custom/b.tsx": emailTemplate("b"),
    });
    const server = await startDevServer({ root, dir: "custom", port: await freePort() });
    try {
      const catalog = (await (await fetch(`${server.url}api/templates`)).json()) as {
        templates: ReadonlyArray<{ id: string }>;
      };
      expect(catalog.templates.map((template) => template.id)).toEqual(["custom/b.tsx"]);
    } finally {
      await server.close();
    }
  });
});
