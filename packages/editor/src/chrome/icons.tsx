import {
  ArrowsExpand,
  BulletList,
  ButtonCursor,
  DividerY,
  Envelope,
  Frame,
  GridLayoutRows,
  Heading1,
  Image,
  Paragraph,
  TextColumns,
} from "./editor-icons";
import type { EditorIcon } from "./icon-set";

/** Per-element icon for the layers tree and breadcrumb, keyed by rendered HTML tag. */
const TAG_ICON: Readonly<Record<string, EditorIcon>> = {
  body: Envelope,
  div: Frame,
  table: GridLayoutRows,
  tbody: GridLayoutRows,
  tr: GridLayoutRows,
  td: TextColumns,
  th: TextColumns,
  h1: Heading1,
  h2: Heading1,
  h3: Heading1,
  h4: Heading1,
  h5: Heading1,
  h6: Heading1,
  p: Paragraph,
  span: Paragraph,
  a: ButtonCursor,
  button: ButtonCursor,
  img: Image,
  hr: DividerY,
  br: ArrowsExpand,
  ul: BulletList,
  ol: BulletList,
  li: BulletList,
};

export const iconForTag = (tag: string): EditorIcon => TAG_ICON[tag.toLowerCase()] ?? Frame;
