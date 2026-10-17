/** @jsxImportSource @samva/markup/email */
import type { EmailChild } from "@samva/markup/email/jsx-runtime";

/** The message's headline and its opening paragraph. */
export const Hero = ({ title, children }: { title: string; children?: EmailChild }) => (
  <div>
    <h1 className="font-heading text-card-foreground m-0 text-[30px] leading-[38px] font-normal">
      {title}
    </h1>
    <p className="text-card-foreground mt-4 mb-0 text-[16px] leading-[26px]">{children}</p>
  </div>
);
