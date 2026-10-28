/** @jsxImportSource @samva/markup/email */
/* oxlint-disable react/style-prop-object -- IssueDate's style selects a fmt.date style, not CSS. */
import { IssueContent, IssueDate, IssueTitle } from "@samva/markup/email";

export const issueHeading = (
  <>
    <h1>
      <IssueTitle />
    </h1>
    <p>
      <IssueDate />
    </p>
    <IssueContent />
  </>
);
export const localizedDate = <IssueDate style="long" locale="en-GB" />;
// @ts-expect-error IssueTitle takes no props.
export const titleProps = <IssueTitle className="heading" />;
// @ts-expect-error Date styles follow fmt.date.
export const invalidDateStyle = <IssueDate style="iso" />;
// @ts-expect-error Directives take no children.
export const dateChildren = <IssueDate>Today</IssueDate>;
