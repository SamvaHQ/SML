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
  LinkChain,
  Rule,
  Spacer,
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
  a: LinkChain,
  button: ButtonCursor,
  img: Image,
  hr: DividerY,
  br: ArrowsExpand,
  ul: BulletList,
  ol: BulletList,
  li: BulletList,
};

export const iconForTag = (tag: string): EditorIcon => TAG_ICON[tag.toLowerCase()] ?? Frame;

/**
 * The icon for an authored layer: the component it names where the tag would mislead (a
 * Section, Spacer, Divider and Button all render as tables), the tag otherwise.
 */
const LAYER_ICON: Readonly<Record<string, EditorIcon>> = {
  Section: GridLayoutRows,
  Container: GridLayoutRows,
  Spacer,
  Divider: Rule,
  Button: ButtonCursor,
  Columns: TextColumns,
  Column: TextColumns,
  Link: LinkChain,
};

export const iconForLayer = (name: string, tag: string): EditorIcon =>
  LAYER_ICON[name] ?? iconForTag(tag);
