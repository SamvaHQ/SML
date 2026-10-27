import type { EmailNode } from "./email/jsx-runtime";
import type { DateStyle } from "./fmt";

/** Static layout directive replaced by parsed issue content during compilation. Takes no props. */
export const IssueContent = (): EmailNode | null => null;

/** Static layout directive replaced by the issue's title as escaped text. Takes no props. */
export const IssueTitle = (): EmailNode | null => null;

export interface IssueDateProps {
  /** Same date styles as fmt.date; defaults to medium. */
  readonly style?: DateStyle;
  /** Literal locale, default en-US. Formatting happens at compile time in UTC. */
  readonly locale?: string;
}

/** Static layout directive; an absent frontmatter date produces no text. */
export const IssueDate = (_props: IssueDateProps): EmailNode | null => null;
