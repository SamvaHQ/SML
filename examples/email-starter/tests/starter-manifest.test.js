import { test } from "bun:test";
import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const digestFiles = async (base, files) => {
  const hash = createHash("sha256");
  const contents = await Promise.all(
    [...files].sort().map(async (file) => [file, await readFile(resolve(base, file))]),
  );

  for (const [file, content] of contents) {
    hash.update(file);
    hash.update("\0");
    hash.update(content);
    hash.update("\0");
  }

  return hash.digest("hex");
};

const payloadFiles = async (base) => {
  const walk = async (directory, prefix = "") => {
    const entries = await readdir(directory, { withFileTypes: true });
    const nested = await Promise.all(
      entries.map(async (entry) => {
        // `.samva` is the gitignored brand snapshot `samva brands pull` writes.
        if (
          [".git", "node_modules", "dist", ".vite", ".samva", "starter-manifest.json"].includes(
            entry.name,
          )
        )
          return [];
        const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
        return entry.isDirectory() ? walk(resolve(directory, entry.name), relative) : [relative];
      }),
    );
    return nested.flat();
  };
  return (await walk(base)).sort();
};

const runBun = async (cwd, ...args) => {
  const child = Bun.spawn(["bun", ...args], {
    cwd,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);

  assert.equal(exitCode, 0, `${["bun", ...args].join(" ")} failed:\n${stdout}\n${stderr}`);
  return stdout;
};

const verifyPackedInstall = async (destination, name, tarball) => {
  const extracted = await mkdtemp(join(tmpdir(), "samva-authoring-pack-"));
  // oxlint-disable-next-line samva/no-try-catch-or-throw -- Remove only this test's package extraction after byte verification.
  try {
    const unpack = Bun.spawnSync(["tar", "-xzf", tarball, "-C", extracted]);
    assert.equal(unpack.exitCode, 0, "could not inspect local package artifact");
    const listing = Bun.spawnSync(["tar", "-tzf", tarball]);
    assert.equal(listing.exitCode, 0, "could not list local package artifact");
    const files = listing.stdout
      .toString()
      .trim()
      .split("\n")
      .filter((path) => !path.endsWith("/"));
    await Promise.all(
      files.map(async (path) => {
        assert.ok(path.startsWith("package/") && !path.includes(".."), "unexpected packed path");
        const [expected, installed] = await Promise.all([
          readFile(join(extracted, path)),
          readFile(join(destination, "node_modules", name, path.slice("package/".length))),
        ]);
        const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
        assert.equal(
          digest(installed),
          digest(expected),
          `${name}/${path} differs from the requested pack`,
        );
      }),
    );
  } finally {
    await rm(extracted, { recursive: true, force: true });
  }
};

test("@samva/markup keeps a template project's dependency graph to rendering and checking", async () => {
  // This project pins the published authoring releases, so whatever @samva/markup declares
  // is what a template author installs, and apps/agents/src/editor/template-project-starter.ts
  // ships the resolved lockfile verbatim into every hosted project. The package carries what
  // rendering needs and what `samva templates check` needs to compile a template (Babel, the
  // Tailwind compiler, css-tree, the client matrix) and nothing more. The lockfile carries the
  // dependency block of the release on npm; the workspace package is the source
  // scripts/refresh-starter.ts resolves it against after the next authoring publish.
  const markup = await readFile(resolve(root, "../../packages/markup/package.json"), "utf8").then(
    JSON.parse,
  );

  assert.deepEqual(
    Object.keys(markup.dependencies).sort(),
    [
      "@babel/parser",
      "@cfworker/json-schema",
      "@standard-schema/spec",
      "better-result",
      "caniemail",
      "css-tree",
      "tailwindcss",
    ],
    "@samva/markup installs its dependencies into every template project; keep them to rendering and checking",
  );
});

test("the starter manifest describes the exact canonical payload", async () => {
  const manifest = JSON.parse(await readFile(resolve(root, "starter-manifest.json"), "utf8"));
  assert.deepEqual(manifest.files, [...manifest.files].sort());
  assert.deepEqual(manifest.files, await payloadFiles(root));
  assert.equal(await digestFiles(root, manifest.files), manifest.sha256);
});

test("the complete starter installs and checks outside the monorepo", async () => {
  // Release auditing supplies both exact local packs; ordinary consumers verify the registry lock.
  // oxlint-disable-next-line node/no-process-env -- Standalone release audit supplies the exact local package artifact.
  const markupPack = process.env.SAMVA_STARTER_MARKUP_TARBALL;
  // oxlint-disable-next-line node/no-process-env -- Both release artifacts must be supplied together.
  const vitePack = process.env.SAMVA_STARTER_VITE_TARBALL;
  assert.equal(Boolean(markupPack), Boolean(vitePack), "provide both authoring tarballs");
  const destination = await mkdtemp(join(tmpdir(), "samva-email-starter-"));

  // oxlint-disable-next-line samva/no-try-catch-or-throw -- Node temp-directory cleanup must run after every adapter outcome.
  try {
    await cp(root, destination, {
      filter: (source) => !["node_modules", "dist", ".vite"].includes(source.split("/").at(-1)),
      recursive: true,
    });
    if (markupPack && vitePack) {
      const manifestPath = join(destination, "package.json");
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      manifest.dependencies["@samva/markup"] = resolve(markupPack);
      manifest.devDependencies["@samva/vite"] = resolve(vitePack);
      // The unpublished packs retain their workspace version; replace transitive registry
      // resolution too, so Vite cannot install the older published bytes under that version.
      manifest.overrides = { "@samva/markup": resolve(markupPack) };
      await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
      await runBun(destination, "install");
      await verifyPackedInstall(destination, "@samva/markup", resolve(markupPack));
      await verifyPackedInstall(destination, "@samva/vite", resolve(vitePack));
    } else {
      await runBun(destination, "install", "--frozen-lockfile");
    }
    await mkdir(join(destination, "templates", "components"), { recursive: true });
    await writeFile(
      join(destination, "templates", "components", "greeting.tsx"),
      `
      /** @jsxImportSource @samva/markup/email */
      export const Greeting = ({ name }: { name: string }) => <h1>Hello, {name}</h1>;
    `,
    );
    await writeFile(
      join(destination, "templates", "receipt.tsx"),
      `
      /** @jsxImportSource @samva/markup/email */
      import { defineTemplate } from "@samva/markup";
      import { Email } from "@samva/markup/email";
      import { jsonSchema } from "@samva/markup/input-schema";
      import { Greeting } from "./components/greeting";
      export default defineTemplate({
        id: "receipt",
        schema: jsonSchema<{ user: { name: string }; items: string[] }>({
          type: "object",
          properties: {
            user: {
              type: "object",
              properties: { name: { type: "string" } },
              required: ["name"],
              additionalProperties: false,
            },
            items: { type: "array", items: { type: "string" } },
          },
          required: ["user", "items"],
          additionalProperties: false,
        }),
        fixtures: {
          empty: { user: { name: "Maya" }, items: [] },
          ordered: { user: { name: "Sam" }, items: ["Tea", "Coffee"] },
        },
        email: {
          subject: (input) => \`Receipt for \${input.user.name}\`,
          body: (input) => (
            <Email>
              <Greeting name={input.user.name} />
              {input.items.length ? <ul>{input.items.map((item) => <li>{item}</li>)}</ul> : <p>No items</p>}
            </Email>
          ),
        },
      });
    `,
    );
    await runBun(destination, "run", "typecheck");
    await runBun(destination, "run", "build");
    await runBun(destination, "run", "check");
    const buildDigestScript = `
      import { createHash } from "node:crypto";
      import { buildTemplates } from "@samva/vite/build";
      const result = await buildTemplates({ root: "." });
      if (result.files.length !== 2) throw new Error("unexpected catalog: " + JSON.stringify(result.files.map(({ id, diagnostics }) => ({ id, diagnostics }))));
      const welcome = result.files.find((entry) => entry.id === "templates/welcome.tsx")?.template;
      const receipt = result.files.find((entry) => entry.id === "templates/receipt.tsx")?.template;
      const ordered = receipt?.fixtures.find((fixture) => fixture.name === "ordered");
      const empty = receipt?.fixtures.find((fixture) => fixture.name === "empty");
      if (!receipt?.ok || !ordered?.email?.html.includes("Hello, Sam") || !ordered.email.html.includes("Coffee") || !empty?.email?.html.includes("No items")) {
        throw new Error("nested input, imported helper, loop or conditional failed: " + JSON.stringify(receipt));
      }
      if (!welcome?.ok || welcome.fixtures.length !== 2 || !welcome.fixtures.every((fixture) => fixture.ok)) {
        throw new Error("canonical starter did not produce two valid email fixtures: " + JSON.stringify(result));
      }
      if (!welcome.fixtures.find((fixture) => fixture.name === "team")?.email?.html.includes("Design team")) {
        throw new Error("the nondefault fixture did not render its actual input");
      }
      const digest = createHash("sha256").update(welcome.source).update("\\0").update(JSON.stringify(welcome.fixtures)).digest("hex");
      console.log(JSON.stringify({ digest, source: welcome.source }));
    `;
    const firstBuild = await runBun(destination, "-e", buildDigestScript);
    const secondBuild = await runBun(destination, "-e", buildDigestScript);
    assert.equal(firstBuild, secondBuild, "fixture output was not deterministic");
    await runBun(
      destination,
      "-e",
      `
      import { readFile } from "node:fs/promises";
      import { exportProject } from "@samva/vite/project";
      const receipt = await exportProject({ root: ".", out: "export" });
      if (receipt.diagnostics.some((finding) => finding.severity === "error")) throw new Error(JSON.stringify(receipt.diagnostics));
      const html = await readFile("export/templates/welcome/team.html", "utf8");
      if (!html.includes("Design team")) throw new Error("export lost fixture content");
    `,
    );
  } finally {
    await rm(destination, { force: true, recursive: true });
  }
}, 180_000);
