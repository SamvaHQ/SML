import type { WhatsAppCategory, WhatsAppHeaderType } from "./channel-specs";
import { Fragment, jsx, type EmailChild, type EmailNode } from "./email/jsx-runtime";

export type { WhatsAppCategory, WhatsAppHeaderType } from "./channel-specs";

export interface WhatsAppProps {
  readonly name?: string | undefined;
  /** The Meta language code, for example `en_US`. */
  readonly language: string;
  readonly category: WhatsAppCategory;
  readonly children?: EmailChild;
}

export interface WhatsAppHeaderProps {
  /** `text` by default; for `image`, `video` and `document` the child is the media URL. */
  readonly type?: WhatsAppHeaderType | undefined;
  readonly children?: EmailChild;
}

export interface WhatsAppTextProps {
  readonly children?: EmailChild;
}

export interface WhatsAppButtonsProps {
  readonly children?: EmailChild;
}

export interface WhatsAppUrlButtonProps {
  readonly url: string;
  /** The button label. */
  readonly children?: EmailChild;
}

export interface WhatsAppPhoneButtonProps {
  readonly phone: string;
  /** The button label. */
  readonly children?: EmailChild;
}

export interface WhatsAppQuickReplyButtonProps {
  /** The button label. */
  readonly children?: EmailChild;
}

export interface WhatsAppCopyCodeButtonProps {
  /** The code the button copies. */
  readonly children?: EmailChild;
}

// Executed, every part is a fragment of its children; the compiler reads the structure from source.
const fragment = (children: EmailChild): EmailNode => jsx(Fragment, { children });

/**
 * The root of a WhatsApp body. Meta's template anatomy is the vocabulary: `WhatsApp.Header`,
 * `WhatsApp.Body`, `WhatsApp.Footer` and `WhatsApp.Buttons`, whose children are the four button
 * kinds.
 */
export const WhatsApp = Object.assign(
  (props: WhatsAppProps): EmailNode => fragment(props.children),
  {
    Header: (props: WhatsAppHeaderProps): EmailNode => fragment(props.children),
    Body: (props: WhatsAppTextProps): EmailNode => fragment(props.children),
    Footer: (props: WhatsAppTextProps): EmailNode => fragment(props.children),
    Buttons: (props: WhatsAppButtonsProps): EmailNode => fragment(props.children),
    UrlButton: (props: WhatsAppUrlButtonProps): EmailNode => fragment(props.children),
    QuickReplyButton: (props: WhatsAppQuickReplyButtonProps): EmailNode => fragment(props.children),
    PhoneButton: (props: WhatsAppPhoneButtonProps): EmailNode => fragment(props.children),
    CopyCodeButton: (props: WhatsAppCopyCodeButtonProps): EmailNode => fragment(props.children),
  },
);
