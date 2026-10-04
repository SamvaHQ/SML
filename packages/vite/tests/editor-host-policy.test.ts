import { describe, expect, it } from "@effect/vitest";

import { createFileHost } from "../editor/src/host";

describe("Vite file host source access", () => {
  it("exposes revision-bound authored source persistence for email", () => {
    const host = createFileHost({ id: "welcome.tsx" });

    expect(host.access).toBe("editable");
    expect(host.sourceAccess).toBe("editable");
    expect(host.writer).toBeDefined();
  });

  it("can always show another declared fixture", () => {
    const host = createFileHost({ id: "welcome.tsx" });

    expect(host.fixtures?.status).toBe("ready");
  });
});
