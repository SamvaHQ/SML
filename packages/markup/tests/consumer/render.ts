import type { EmailNode } from "@samva/markup/email/jsx-runtime";

export const renderReceipt = (input: {
  customer: { name: string };
  items: readonly string[];
}): EmailNode => ({
  type: "Text",
  value: `${input.customer.name}: ${input.items.join(", ")}`,
});
