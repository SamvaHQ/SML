/** @jsxImportSource @samva/markup/email */
import { Section } from "@samva/markup/email";
import type { EmailChild } from "@samva/markup/email/jsx-runtime";

/** A note set apart from the message: what to do if something is off, or one thing to know. */
export const Callout = ({ title, children }: { title: string; children?: EmailChild }) => (
  <Section className="bg-accent text-accent-foreground rounded-md px-5 py-4">
    <p className="m-0 text-[15px] leading-[22px] font-semibold">{title}</p>
    <p className="mt-1 mb-0 text-[14px] leading-[22px]">{children}</p>
  </Section>
);
