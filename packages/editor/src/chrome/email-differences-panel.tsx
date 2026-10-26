import { useShallow } from "zustand/react/shallow";

import { useEditorStore } from "../state/context";
import { Button } from "../ui/button";
import { useEmailDifferences } from "./email-differences";
import { usePart, type PartProps } from "./part";
import { cn, revealOnRowHover } from "./ui-classes";

/** The state an `EmailDifferences` panel exposes. */
export interface EmailDifferencesState extends Record<string, unknown> {
  /** How many components differ. */
  readonly count: number;
}

/**
 * The parts of a page that are simpler in email, at the top of the Checks tab: each component,
 * what email readers get, and how many times it appears. Show switches the preview to the email
 * and selects the first one.
 */
export function EmailDifferences(props: PartProps<"section", EmailDifferencesState>) {
  const rows = useEmailDifferences();
  const { setPreviewTarget, select } = useEditorStore(
    useShallow((state) => ({
      setPreviewTarget: state.actions.setPreviewTarget,
      select: state.actions.select,
    })),
  );
  const show = (path: string) => {
    setPreviewTarget("email");
    select(path);
  };
  return usePart<EmailDifferencesState>(
    "editor-email-differences",
    { "aria-label": "Email differences", "data-testid": "checks.email-differences", ...props },
    {
      state: { count: rows.length },
      tag: "section",
      className: "space-y-2",
      props: {
        children: (
          <>
            <div>
              <h3 className="text-foreground text-[13px] font-semibold">Email differences</h3>
              <p className="text-muted-foreground text-xs">
                Some parts of this page are simpler in email.
              </p>
            </div>
            {rows.length === 0 ? (
              <p
                data-testid="checks.email-differences.empty"
                className="text-muted-foreground text-xs"
              >
                This looks the same in email and on the web.
              </p>
            ) : (
              <ul className="border-border-subtle divide-border-subtle divide-y rounded-md border">
                {rows.map((row) => (
                  <li
                    key={row.component}
                    data-slot="editor-email-differences-row"
                    data-testid="checks.email-differences.row"
                    className="group/row flex items-start gap-2 px-2.5 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-foreground flex items-baseline gap-1.5 text-xs font-medium">
                        <span>{row.component}</span>
                        {row.count > 0 && (
                          <span className="text-muted-foreground font-normal tabular-nums">
                            {row.count === 1 ? "1 place" : `${row.count} places`}
                          </span>
                        )}
                      </div>
                      <p className="text-muted-foreground mt-0.5 text-xs">{row.note}</p>
                    </div>
                    {row.first !== null && (
                      <Button
                        variant="ghost"
                        size="sm"
                        data-testid="checks.email-differences.show"
                        data-editor-control=""
                        aria-label={`Show ${row.component} in the email`}
                        onClick={() => show(row.first!)}
                        className={cn("shrink-0", revealOnRowHover)}
                      >
                        Show
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        ),
      },
    },
  );
}
