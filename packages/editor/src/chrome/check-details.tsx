import type { ReactNode } from "react";

import type { CheckItem } from "../state/types";
import { assessmentLabels } from "./assessment-labels";
import { formatOrigin } from "./email-outline";

/** The same expandable evidence in the inspector, status popover and preview. */
export function CheckDetails({
  check,
  actions,
}: {
  readonly check: CheckItem;
  readonly actions?: ReactNode;
}) {
  if (check.diagnostics === undefined)
    return (
      <div>
        <p className="text-foreground text-[12.5px]">{check.label}</p>
        <p className="text-muted-foreground text-[11.5px]">{check.detail}</p>
      </div>
    );
  return (
    <details className="min-w-0 flex-1" data-testid={`check.${check.id}`}>
      <summary className="text-foreground cursor-pointer text-[12.5px] break-words">
        {check.label}
        <span className="text-muted-foreground mt-0.5 block text-[11.5px]">{check.detail}</span>
      </summary>
      <div className="mt-2 space-y-3 text-[11.5px] break-words">
        {check.diagnostics.map((diagnostic, index) => (
          <div key={index} className="border-border-subtle border-l pl-2">
            {diagnostic.compatibility !== undefined && (
              <p className="mb-1 font-medium">
                {diagnostic.compatibility.title} ·{" "}
                {assessmentLabels[diagnostic.compatibility.assessment]}
              </p>
            )}
            <p>{diagnostic.message}</p>
            {diagnostic.clients !== undefined &&
              !diagnostic.clients.every((client) => diagnostic.message.includes(client)) && (
                <p className="mt-1">Clients: {diagnostic.clients.join(", ")}</p>
              )}
            {diagnostic.notes !== undefined && (
              <p className="text-muted-foreground mt-1">{diagnostic.notes}</p>
            )}
            {(diagnostic.fixtures?.length ?? 0) > 0 && (
              <p className="mt-1">Fixtures: {diagnostic.fixtures!.join(", ")}</p>
            )}
            {(diagnostic.occurrences ?? [diagnostic.origins]).map((origins, occurrence) =>
              origins.length === 0 ? null : (
                <p key={occurrence} className="text-muted-foreground mt-1 break-all">
                  {origins.map(formatOrigin).join(" → ")}
                </p>
              ),
            )}
            {diagnostic.provenance !== undefined && (
              <p className="text-muted-foreground mt-1">{diagnostic.provenance}</p>
            )}
          </div>
        ))}
        <p className="text-muted-foreground font-mono break-all">{check.diagnostics[0]?.code}</p>
        {actions}
      </div>
    </details>
  );
}
