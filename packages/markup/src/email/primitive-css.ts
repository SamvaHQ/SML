// The email primitives' own rules. Every project compiles them beneath its own styles: they sit in
// the `components` layer, below Tailwind's utilities and the project's unlayered CSS, so a class
// an author puts on a primitive overrides the primitive's default, while a prop the author sets
// is an inline style that overrides both. Each default reads the theme vocabulary, so a theme
// restyles the primitives and its dark-mode block switches them.

/** A stacking `Columns` row stacks on a viewport narrower than this. */
export const STACK_BREAKPOINT_PX = 600;

/** The classes the primitives put on the elements they generate. */
export const PRIMITIVE_CLASSES = {
  email: "sml-email",
  button: "sml-button",
  link: "sml-link",
  divider: "sml-divider",
  stack: "sml-stack",
} as const;

export const PRIMITIVE_CSS = `@layer components {
  .${PRIMITIVE_CLASSES.email} {
    color: var(--color-foreground);
    font-family: var(--font-sans);
    padding-left: 16px;
    padding-right: 16px;
  }
  .${PRIMITIVE_CLASSES.button} {
    background-color: var(--color-primary);
    color: var(--color-primary-foreground);
    font-family: var(--font-sans);
    border-radius: var(--radius);
  }
  .${PRIMITIVE_CLASSES.link} {
    color: var(--color-primary);
    text-decoration: underline;
  }
  .${PRIMITIVE_CLASSES.divider} {
    border-top: 1px solid var(--color-border);
  }
}
@media only screen and (max-width: ${STACK_BREAKPOINT_PX - 1}px) {
  .${PRIMITIVE_CLASSES.stack} {
    display: block;
    width: 100%;
    max-width: 100%;
  }
}
`;
