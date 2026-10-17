/** @jsxImportSource @samva/markup/email */
import { Button } from "@samva/markup/email";

/**
 * The message's one call to action, in the theme's primary fill. Classic Outlook draws the
 * button from `height` and `borderRadius`, which match `rounded-md` at the default radius.
 */
export const PrimaryButton = ({ href, label }: { href: string; label: string }) => (
  <Button
    href={href}
    height={46}
    paddingX={22}
    borderRadius={4}
    fontSize={15}
    className="rounded-md"
  >
    {label}
  </Button>
);
