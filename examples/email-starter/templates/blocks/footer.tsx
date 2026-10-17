/** @jsxImportSource @samva/markup/email */
import { Section } from "@samva/markup/email";
import type { EmailChild } from "@samva/markup/email/jsx-runtime";

/**
 * Why the reader got this email and who sent it, on the page color below the message. A brand
 * import's `BrandFooter` adds your postal address, social links and unsubscribe row.
 */
export const Footer = ({ sender, children }: { sender: string; children?: EmailChild }) => (
  <Section width={560} className="px-1 pt-6 pb-10">
    <p className="text-muted-foreground m-0 text-[13px] leading-[20px]">{children}</p>
    <p className="text-muted-foreground mt-3 mb-0 text-[13px] leading-[20px]">{sender}</p>
  </Section>
);
