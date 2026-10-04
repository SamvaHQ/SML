import { Dialog } from "@base-ui/react/dialog";
import { useState } from "react";

import { projectDiagnosticCheck, summarizeChecks } from "../state/derive";
import type { CheckItem } from "../state/types";
import { assessmentLabels } from "./assessment-labels";
import { CheckActions } from "./check-actions";
import { CheckDetails } from "./check-details";
import { useEditorPortalContainer } from "./use-editor-portal";

/** A compact repair surface; compatibility evidence lives in the roomy report. */
export function AttentionSummary({
  checks,
  editable = false,
}: {
  readonly checks: ReadonlyArray<CheckItem>;
  readonly editable?: boolean;
}) {
  const { actionable } = summarizeChecks(checks);
  const pending = checks.filter((check) =>
    check.diagnostics?.some((item) => item.compatibility?.assessment === "unverified"),
  ).length;
  return (
    <section className="space-y-3" aria-label="Needs attention">
      <h3 className="text-foreground text-[13px] font-semibold">
        Needs attention{actionable.length > 0 ? ` · ${actionable.length}` : ""}
      </h3>
      {actionable.length === 0 ? (
        <p className="text-muted-foreground text-xs">
          {checks.length === 0 ? "No checks yet." : "No known risks found."}
        </p>
      ) : (
        actionable.map((check) => (
          <CheckDetails
            key={check.id}
            check={check}
            actions={editable ? <CheckActions check={check} /> : undefined}
          />
        ))
      )}
      <CompatibilityReport checks={checks} editable={editable} />
      <p className="text-muted-foreground text-[11.5px]">
        {pending > 0
          ? `${pending} finding group${pending === 1 ? " needs" : "s need"} client verification.`
          : "These checks do not confirm rendering in every inbox."}
      </p>
    </section>
  );
}

/** Filters retain individual client and fixture evidence, even within a shared code. */
export function CompatibilityReport({
  checks,
  editable = false,
}: {
  readonly checks: ReadonlyArray<CheckItem>;
  readonly editable?: boolean;
}) {
  const container = useEditorPortalContainer();
  const counts = Object.fromEntries(
    Object.keys(assessmentLabels).map((value) => [
      value,
      checks.filter((check) =>
        check.diagnostics?.some((item) => item.compatibility?.assessment === value),
      ).length,
    ]),
  );
  const [assessment, setAssessment] = useState("all");
  const [client, setClient] = useState("all");
  const clients = [
    ...new Set(
      checks.flatMap((check) => check.diagnostics?.flatMap((item) => item.clients ?? []) ?? []),
    ),
  ].sort();
  const filtered = checks.flatMap((check) => {
    if (check.diagnostics === undefined)
      return assessment === "all" && client === "all" ? [check] : [];
    const diagnostics = check.diagnostics.filter(
      (item) =>
        (assessment === "all" || item.compatibility?.assessment === assessment) &&
        (client === "all" || item.clients?.includes(client)),
    );
    if (diagnostics.length === 0) return [];
    return [projectDiagnosticCheck(check.id, diagnostics)];
  });
  const priority = (check: CheckItem) => {
    if (check.severity === "error" || check.severity === "warn") return 0;
    if (check.diagnostics?.some((item) => item.compatibility?.assessment === "unverified"))
      return 1;
    if (check.diagnostics?.some((item) => item.compatibility?.assessment === "degradation"))
      return 2;
    return 3;
  };
  filtered.sort((a, b) => priority(a) - priority(b));
  return (
    <Dialog.Root
      onOpenChange={(open) => {
        if (!open) return;
        setAssessment(counts.unverified! > 0 ? "unverified" : "all");
        setClient("all");
      }}
    >
      <Dialog.Trigger
        data-testid="checks.compatibility-report"
        className="border-border text-foreground hover:bg-muted rounded-md border px-2.5 py-1.5 text-xs"
      >
        Compatibility report
      </Dialog.Trigger>
      <Dialog.Portal container={container}>
        <Dialog.Backdrop className="fixed inset-0 z-[130] bg-black/30" />
        <Dialog.Popup
          data-testid="checks.report"
          className="samva-editor-shell border-border bg-surface-elevated text-foreground fixed top-1/2 left-1/2 z-[131] flex max-h-[85dvh] w-[min(840px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border p-5 shadow-xl"
        >
          <div className="flex items-center justify-between gap-3">
            <Dialog.Title className="text-lg font-semibold">Compatibility report</Dialog.Title>
            <Dialog.Close
              data-testid="checks.report.close"
              aria-label="Close compatibility report"
              className="hover:bg-muted rounded border px-2 py-1 text-xs"
            >
              Close
            </Dialog.Close>
          </div>
          <Dialog.Description className="text-muted-foreground mt-2 text-sm">
            Client verification remains. Review known risks, unverified behavior and fallbacks
            before testing in your recipients’ inboxes.
          </Dialog.Description>
          <p className="text-muted-foreground mt-2 text-xs">
            {Object.entries(assessmentLabels)
              .map(([value, label]) => `${counts[value]} ${label.toLowerCase()}`)
              .join(" · ")}
            . Groups can appear in more than one category.
          </p>
          <div className="my-4 flex flex-wrap gap-3 text-xs">
            <label className="flex flex-col gap-1">
              Assessment
              <select
                data-testid="checks.report.assessment"
                aria-label="Assessment"
                value={assessment}
                onChange={(event) => setAssessment(event.target.value)}
                className="border-border bg-background rounded border p-2"
              >
                <option value="all">All assessments</option>
                {Object.entries(assessmentLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label} ({counts[value]})
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              Client
              <select
                data-testid="checks.report.client"
                aria-label="Client"
                value={client}
                onChange={(event) => setClient(event.target.value)}
                className="border-border bg-background rounded border p-2"
              >
                <option value="all">All clients</option>
                {clients.map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="samva-editor-scroll min-h-0 space-y-4 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="text-muted-foreground text-sm">No evidence matches these filters.</p>
            ) : (
              filtered.map((check) => (
                <div key={check.id} className="border-border-subtle border-t pt-3">
                  <CheckDetails
                    check={check}
                    actions={editable ? <CheckActions check={check} /> : undefined}
                  />
                </div>
              ))
            )}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
