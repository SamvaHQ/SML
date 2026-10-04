import type { SmsCategory } from "./channel-specs";
import { Fragment, jsx, type EmailChild, type EmailNode } from "./email/jsx-runtime";

export type { SmsCategory } from "./channel-specs";

export interface SmsProps {
  readonly category?: SmsCategory | undefined;
  readonly children?: EmailChild;
}

/**
 * The root of an SMS body: plain text with bindings, conditionals and formatters. The compiler
 * reads it from source; executed, it is a fragment of its children so a template file that also
 * declares an email body still evaluates.
 */
export const Sms = (props: SmsProps): EmailNode => jsx(Fragment, { children: props.children });
