/** @jsxImportSource @samva/markup/email */
import type { EmailChild } from "@samva/markup/email/jsx-runtime";

/** Facts the reader may need to look up later, one per row: a label and its value. */
export const KeyValue = ({ children }: { children?: EmailChild }) => (
  <table
    role="presentation"
    width="100%"
    cellpadding={0}
    cellspacing={0}
    className="border-border border-t"
  >
    <tbody>{children}</tbody>
  </table>
);

/** One row of a `KeyValue`. The value wraps rather than pushing the label off a phone screen. */
export const KeyValueRow = ({ label, children }: { label: string; children?: EmailChild }) => (
  <tr>
    <td
      width="36%"
      valign="top"
      className="border-border text-muted-foreground border-b py-3 pr-4 text-[14px] leading-[20px]"
    >
      {label}
    </td>
    <td
      valign="top"
      className="border-border text-card-foreground border-b py-3 text-[14px] leading-[20px]"
    >
      {children}
    </td>
  </tr>
);
