/**
 * @vitest-environment happy-dom
 * @jsxImportSource react
 */
import { afterEach, expect, it } from "@effect/vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";

import { AttentionSummary } from "../src/chrome/compatibility-report";
import { describeChecks } from "../src/state/derive";
import type { CheckItem } from "../src/state/types";

afterEach(cleanup);

it("keeps verification pending with zero known risks and filters distinct client evidence", async () => {
  const checks: ReadonlyArray<CheckItem> = [
    {
      id: "compat:feature",
      severity: "info",
      label: "Rendering needs verification",
      detail: "2 variants",
      diagnostics: [
        {
          code: "feature",
          severity: "info",
          message: "Verify Outlook rendering",
          origins: [],
          clients: ["Outlook"],
          fixtures: ["long"],
          provenance: "pinned matrix",
          compatibility: { assessment: "unverified", title: "Rendering needs verification" },
        },
        {
          code: "feature",
          severity: "info",
          message: "Gmail uses the fallback",
          origins: [],
          clients: ["Gmail"],
          fixtures: ["default"],
          compatibility: { assessment: "degradation", title: "Fallback appearance" },
        },
      ],
    },
  ];
  const view = render(<AttentionSummary checks={checks} />);
  expect(view.baseElement.textContent).toContain("No issues found");
  expect(view.baseElement.textContent).toContain("1 tip to check in specific email clients.");
  // Nothing is actionable, so the panel settles instead of heading an empty section.
  expect(view.baseElement.textContent).not.toContain("Needs attention");
  expect(view.baseElement.textContent).not.toContain("No known risks found");
  expect(view.baseElement.textContent).not.toContain("All checks passing");
  fireEvent.click(view.getByTestId("checks.compatibility-report"));
  const report = await view.findByTestId("checks.report");
  fireEvent.change(view.getByTestId("checks.report.client"), { target: { value: "Outlook" } });
  fireEvent.change(view.getByTestId("checks.report.assessment"), {
    target: { value: "unverified" },
  });
  expect(report.textContent).toContain("Fixtures: long");
  expect(report.textContent).toContain("pinned matrix");
  expect(report.textContent).not.toContain("Gmail uses the fallback");
  fireEvent.change(view.getByTestId("checks.report.assessment"), {
    target: { value: "degradation" },
  });
  expect(report.textContent).toContain("No evidence matches");
  fireEvent.change(view.getByTestId("checks.report.client"), { target: { value: "Gmail" } });
  expect(report.textContent).toContain("Fixtures: default");
  expect(report.textContent).toContain("Fallback appearance");
  expect(report.querySelector('[data-testid="check.fix-target"]')).toBeNull();
});

it("does not present a document without checks as clear", () => {
  const view = render(<AttentionSummary checks={[]} />);
  expect(view.baseElement.textContent).toContain("No checks yet");
  expect(view.baseElement.textContent).not.toContain("No issues found");
});

it("shows Needs attention only while a check is actionable", () => {
  const view = render(
    <AttentionSummary
      checks={[{ id: "size", severity: "warn", label: "Large message", detail: "120 KB" }]}
    />,
  );
  expect(view.baseElement.textContent).toContain("Needs attention · 1");
  expect(view.queryByTestId("checks.settled")).toBeNull();
});

it("uses checks loaded after mount when opening and resets filters on reopen", async () => {
  const view = render(<AttentionSummary checks={[]} />);
  const checks: ReadonlyArray<CheckItem> = [
    {
      id: "compat:late",
      severity: "info",
      label: "Verify rendering",
      detail: "1 finding",
      diagnostics: [
        {
          code: "late",
          severity: "info",
          message: "Verify this client",
          origins: [],
          clients: ["Outlook"],
          compatibility: { assessment: "unverified", title: "Verify rendering" },
        },
      ],
    },
  ];
  view.rerender(<AttentionSummary checks={checks} />);
  fireEvent.click(view.getByTestId("checks.compatibility-report"));
  const assessment = (await view.findByTestId("checks.report.assessment")) as HTMLSelectElement;
  expect(assessment.value).toBe("unverified");
  fireEvent.change(assessment, { target: { value: "all" } });
  fireEvent.change(view.getByTestId("checks.report.client"), { target: { value: "Outlook" } });
  fireEvent.click(view.getByTestId("checks.report.close"));
  await waitFor(() => expect(view.queryByTestId("checks.report")).toBeNull());
  fireEvent.click(view.getByTestId("checks.compatibility-report"));
  expect(((await view.findByTestId("checks.report.assessment")) as HTMLSelectElement).value).toBe(
    "unverified",
  );
  expect((view.getByTestId("checks.report.client") as HTMLSelectElement).value).toBe("all");
});

it("counts tips the way the status bar does when a warning shares the finding", () => {
  const checks: ReadonlyArray<CheckItem> = [
    {
      id: "compat:mixed",
      severity: "warn",
      label: "Mixed",
      detail: "",
      diagnostics: [
        {
          code: "feature",
          severity: "info",
          message: "Verify Outlook rendering",
          origins: [],
          compatibility: { assessment: "unverified", title: "Rendering needs verification" },
        },
      ],
    },
  ];
  const view = render(<AttentionSummary checks={checks} />);
  expect(describeChecks(checks).text).toBe("1 warning");
  expect(view.baseElement.textContent).toContain("These checks do not confirm rendering");
  expect(view.baseElement.textContent).not.toContain("tip");
});
