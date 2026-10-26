/** What a reader loses when a component is lowered from the shared document to email. */
export interface EmailDegradation {
  readonly kind: "same" | "static" | "omitted";
  readonly note: string;
}

/** Content fidelity declarations; client-specific presentation is checked against the HTML. */
export const COMPONENT_DEGRADATIONS = {
  Email: {
    kind: "same",
    note: "Recipients get the full message with the theme's colors and font.",
  },
  Section: { kind: "same", note: "Recipients see the section and everything in it." },
  Columns: { kind: "same", note: "Recipients see every cell of every row." },
  Column: { kind: "same", note: "Recipients see the cell and everything in it." },
  Button: { kind: "same", note: "Recipients see the button's label and can follow its link." },
  Spacer: { kind: "same", note: "Recipients see the space between blocks." },
  Divider: { kind: "same", note: "Recipients see the horizontal rule." },
  Image: { kind: "same", note: "Recipients get the image and its alternative text." },
  Link: { kind: "same", note: "Recipients can follow the link." },
  BrandLogo: {
    kind: "same",
    note: "Recipients get the brand logo, with the dark version where their client supports it.",
  },
  BrandFooter: {
    kind: "same",
    note: "Recipients see the brand's contact details and links, including the unsubscribe link when supplied.",
  },
} as const satisfies Readonly<Record<string, EmailDegradation>>;

export type SemanticComponentName = keyof typeof COMPONENT_DEGRADATIONS;

/** The content fidelity declaration for one supported component. */
export const componentDegradation = (name: SemanticComponentName): EmailDegradation =>
  COMPONENT_DEGRADATIONS[name];
