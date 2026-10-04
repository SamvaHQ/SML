import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "@effect/vitest";

import { buildTemplates, createTemplateBuildSession } from "../src/build";
import {
  cleanupProjects,
  emailTemplate,
  LOGO,
  multiChannelTemplate,
  SIGNATURE_PARTIAL,
  tempProject,
  THEME,
} from "./support/project";

const themed = fileURLToPath(new URL("./fixtures/themed/", import.meta.url));

afterEach(cleanupProjects);

/** Real-time bound for a watcher notification, so a missed change fails with its reason. */
const WATCH_TIMEOUT_MS = 30_000;

const withTimeout = async <A>(promise: Promise<A>, reason: string): Promise<A> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${reason} after ${WATCH_TIMEOUT_MS}ms`)),
          WATCH_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};

/** The next change to `path`; the OS may replay the events of the files a test just wrote. */
const changeTo = (
  session: { subscribe: (l: (path: string) => void) => () => void },
  path: string,
) =>
  new Promise<string>((resolve) => {
    const unsubscribe = session.subscribe((changed) => {
      if (changed !== path) return;
      unsubscribe();
      resolve(changed);
    });
  });

describe("buildTemplates", () => {
  it("compiles every template and renders every fixture through every channel", async () => {
    const root = await tempProject({
      "templates/welcome.tsx": emailTemplate("welcome", "Welcome"),
      "templates/order.tsx": multiChannelTemplate("order"),
    });
    const result = await buildTemplates({ root });

    expect(result.ok).toBe(true);
    expect(result.compilerVersion).toMatch(/^@samva\/markup@/);
    expect(result.files.map((file) => file.id)).toEqual([
      "templates/order.tsx",
      "templates/welcome.tsx",
    ]);
    const welcome = result.files.find((file) => file.id === "templates/welcome.tsx")?.template;
    expect(welcome?.fixtures.map((fixture) => fixture.name)).toEqual(["first", "second"]);
    expect(welcome?.fixtures[1]?.email?.subject).toBe("Welcome, Grace");
    expect(welcome?.inputSchema).toMatchObject({ type: "object", required: ["name"] });
    const order = result.files.find((file) => file.id === "templates/order.tsx")?.template;
    expect(order?.channels).toEqual(["email", "sms", "whatsapp"]);
    expect(order?.fixtures[0]?.sms).toBe("Hi Ada, your order shipped.");
    expect(order?.fixtures[0]?.whatsapp?.body).toBe("Hi Ada, your order shipped.");
  });

  it("themes templates from the project root and compiles without a theme when disabled", async () => {
    const themedResult = await buildTemplates({ root: themed });
    const html = themedResult.files[0]?.template?.fixtures[0]?.email?.html ?? "";
    expect(html).toContain("#4f46e5");
    expect(html).toContain("#a5b4fc");
    expect(html).toContain("Hi Ada");

    const plain = await buildTemplates({ root: themed, theme: false });
    const unthemed = plain.files[0];
    expect(unthemed?.template?.fixtures[0]?.email?.html ?? "").not.toContain("#4f46e5");
  });

  it("reports a fixture the input schema rejects on its template", async () => {
    const root = await tempProject({
      "templates/bad.tsx": emailTemplate("bad", "Hello", { fixtures: "{ first: { name: 3 } }" }),
    });
    const result = await buildTemplates({ root });
    expect(result.ok).toBe(false);
    const file = result.files[0];
    expect(file?.ok).toBe(false);
    expect(file?.diagnostics.map((item) => item.code)).toContain("fixture-invalid");
  });

  it("requires an https asset base for imported assets and accepts one", async () => {
    const root = await tempProject({
      "assets/logo.png": LOGO,
      "templates/logo.tsx": emailTemplate("logo", "Hello", {
        imports: 'import logo from "../assets/logo.png";',
        body: '<Email><img src={logo} alt="Samva" width="12" height="12" /></Email>',
      }),
    });
    const without = await buildTemplates({ root });
    expect(without.files[0]?.diagnostics.map((item) => item.code)).toEqual(["missing-asset-base"]);
    const relative = await buildTemplates({ root, assetBase: "/assets" });
    expect(relative.files[0]?.diagnostics.map((item) => item.code)).toEqual(["invalid-asset-base"]);
    const served = await buildTemplates({ root, assetBase: "https://cdn.samva.test/a" });
    expect(served.ok).toBe(true);
    expect(served.files[0]?.template?.fixtures[0]?.email?.html).toContain(
      "https://cdn.samva.test/a/",
    );
  });

  it("excludes helper modules from the results and reports duplicate declared ids", async () => {
    const root = await tempProject({
      "templates/one.tsx": emailTemplate("stable-id"),
      "templates/helper.tsx": "export const Help = () => <p>Helper</p>;\n",
      "templates/default-helper.tsx":
        "export default function Shared() { return <p>Shared</p>; }\n",
    });
    const first = await buildTemplates({ root });
    expect(first.files.map((file) => file.id)).toEqual(["templates/one.tsx"]);
    await writeFile(join(root, "templates/two.tsx"), emailTemplate("stable-id"));
    const duplicate = await buildTemplates({ root });
    expect(duplicate.ok).toBe(false);
    expect(duplicate.diagnostics.map((item) => item.code)).toEqual(["duplicate-template-id"]);
  });

  it("reports a broken theme on every template and keeps building the rest", async () => {
    const root = await tempProject({
      "templates/email.tsx": emailTemplate("email"),
      "theme.css": "@theme { --color-brand: #ffffff;",
    });
    const broken = await buildTemplates({ root });
    expect(broken.files[0]?.ok).toBe(false);
    expect(broken.files[0]?.diagnostics.length).toBeGreaterThan(0);
    await writeFile(join(root, "theme.css"), THEME);
    const fixed = await buildTemplates({ root });
    expect(fixed.files[0]?.ok).toBe(true);
  });
});

describe("createTemplateBuildSession", () => {
  it("rebuilds on a template change and on a partial change, and closes its watcher", async () => {
    const root = await tempProject({
      "templates/watch.tsx": emailTemplate("watch", "one", {
        imports: 'import { Signature } from "../components/signature";',
        body: "<Email><p>one, {input.name}</p><Signature /></Email>",
      }),
      "components/signature.tsx": SIGNATURE_PARTIAL,
    });
    const session = createTemplateBuildSession({ root });
    try {
      const initial = await session.build();
      expect(initial.files[0]?.template?.fixtures[0]?.email?.html).toContain("The Samva team");

      const changed = changeTo(session, "components/signature.tsx");
      await writeFile(
        join(root, "components/signature.tsx"),
        SIGNATURE_PARTIAL.replace("The Samva team", "Someone else"),
      );
      expect(await withTimeout(changed, "watcher reported no change")).toBe(
        "components/signature.tsx",
      );
      const updated = await session.build();
      expect(updated.files[0]?.template?.fixtures[0]?.email?.html).toContain("Someone else");
    } finally {
      await session.close();
    }
    await expect(session.close()).resolves.toBeUndefined();
  });

  it("does not report the tool's own .samva output as a change", async () => {
    const root = await tempProject({ "templates/a.tsx": emailTemplate("a") });
    const session = createTemplateBuildSession({ root });
    try {
      const seen: string[] = [];
      session.subscribe((path) => seen.push(path));
      await mkdir(join(root, ".samva/brands"), { recursive: true });
      await writeFile(join(root, ".samva/brands/acme.json"), "{}");
      const marker = changeTo(session, "templates/a.tsx");
      await writeFile(join(root, "templates/a.tsx"), emailTemplate("a", "changed"));
      await withTimeout(marker, "watcher reported no change");
      expect(seen.every((path) => !path.startsWith(".samva"))).toBe(true);
    } finally {
      await session.close();
    }
  });
});
