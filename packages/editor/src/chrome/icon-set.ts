import Add01Icon from "@hugeicons/core-free-icons/Add01Icon";
import ArrowDown01Icon from "@hugeicons/core-free-icons/ArrowDown01Icon";
import ArrowExpand01Icon from "@hugeicons/core-free-icons/ArrowExpand01Icon";
import ArrowLeft01Icon from "@hugeicons/core-free-icons/ArrowLeft01Icon";
import ArrowLeft02Icon from "@hugeicons/core-free-icons/ArrowLeft02Icon";
import ArrowRight01Icon from "@hugeicons/core-free-icons/ArrowRight01Icon";
import ArrowShrink01Icon from "@hugeicons/core-free-icons/ArrowShrink01Icon";
import ArrowUp01Icon from "@hugeicons/core-free-icons/ArrowUp01Icon";
import ArrowUp02Icon from "@hugeicons/core-free-icons/ArrowUp02Icon";
import BubbleChatIcon from "@hugeicons/core-free-icons/BubbleChatIcon";
import Cancel01Icon from "@hugeicons/core-free-icons/Cancel01Icon";
import CheckListIcon from "@hugeicons/core-free-icons/CheckListIcon";
import Clock01Icon from "@hugeicons/core-free-icons/Clock01Icon";
import ComputerIcon from "@hugeicons/core-free-icons/ComputerIcon";
import Copy01Icon from "@hugeicons/core-free-icons/Copy01Icon";
import CursorPointer02Icon from "@hugeicons/core-free-icons/CursorPointer02Icon";
import Delete02Icon from "@hugeicons/core-free-icons/Delete02Icon";
import Download04Icon from "@hugeicons/core-free-icons/Download04Icon";
import Files01Icon from "@hugeicons/core-free-icons/Files01Icon";
import FrameIcon from "@hugeicons/core-free-icons/FrameIcon";
import GitCompareIcon from "@hugeicons/core-free-icons/GitCompareIcon";
import Heading01Icon from "@hugeicons/core-free-icons/Heading01Icon";
import Image01Icon from "@hugeicons/core-free-icons/Image01Icon";
import Layers01Icon from "@hugeicons/core-free-icons/Layers01Icon";
import Layout2ColumnIcon from "@hugeicons/core-free-icons/Layout2ColumnIcon";
import Layout3RowIcon from "@hugeicons/core-free-icons/Layout3RowIcon";
import LeftToRightListBulletIcon from "@hugeicons/core-free-icons/LeftToRightListBulletIcon";
import LinkSquare02Icon from "@hugeicons/core-free-icons/LinkSquare02Icon";
import Mail01Icon from "@hugeicons/core-free-icons/Mail01Icon";
import Message01Icon from "@hugeicons/core-free-icons/Message01Icon";
import MinusSignIcon from "@hugeicons/core-free-icons/MinusSignIcon";
import Moon02Icon from "@hugeicons/core-free-icons/Moon02Icon";
import MoreHorizontalIcon from "@hugeicons/core-free-icons/MoreHorizontalIcon";
import PaintBoardIcon from "@hugeicons/core-free-icons/PaintBoardIcon";
import PaintBrush04Icon from "@hugeicons/core-free-icons/PaintBrush04Icon";
import PanelLeftCloseIcon from "@hugeicons/core-free-icons/PanelLeftCloseIcon";
import PanelLeftIcon from "@hugeicons/core-free-icons/PanelLeftIcon";
import PanelRightCloseIcon from "@hugeicons/core-free-icons/PanelRightCloseIcon";
import PanelRightIcon from "@hugeicons/core-free-icons/PanelRightIcon";
import ParagraphIcon from "@hugeicons/core-free-icons/ParagraphIcon";
import Pin02Icon from "@hugeicons/core-free-icons/Pin02Icon";
import Redo02Icon from "@hugeicons/core-free-icons/Redo02Icon";
import RefreshIcon from "@hugeicons/core-free-icons/RefreshIcon";
import RotateLeft01Icon from "@hugeicons/core-free-icons/RotateLeft01Icon";
import Search01Icon from "@hugeicons/core-free-icons/Search01Icon";
import SeparatorHorizontalIcon from "@hugeicons/core-free-icons/SeparatorHorizontalIcon";
import SlidersHorizontalIcon from "@hugeicons/core-free-icons/SlidersHorizontalIcon";
import SmartPhone01Icon from "@hugeicons/core-free-icons/SmartPhone01Icon";
import SourceCodeIcon from "@hugeicons/core-free-icons/SourceCodeIcon";
import SparklesIcon from "@hugeicons/core-free-icons/SparklesIcon";
import Sun03Icon from "@hugeicons/core-free-icons/Sun03Icon";
import TextAlignCenterIcon from "@hugeicons/core-free-icons/TextAlignCenterIcon";
import TextAlignLeftIcon from "@hugeicons/core-free-icons/TextAlignLeftIcon";
import TextAlignRightIcon from "@hugeicons/core-free-icons/TextAlignRightIcon";
import Tick02Icon from "@hugeicons/core-free-icons/Tick02Icon";
import Undo02Icon from "@hugeicons/core-free-icons/Undo02Icon";
import ViewIcon from "@hugeicons/core-free-icons/ViewIcon";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { createElement, type ComponentType } from "react";

/** One icon the editor draws. It receives the size and color as a class name and nothing else. */
export type EditorIcon = ComponentType<{ readonly className?: string }>;

// Per-glyph imports keep the bundle to the glyphs below; the package root holds thousands.
const hugeicon = (icon: IconSvgElement): EditorIcon => {
  const Glyph: EditorIcon = ({ className }) =>
    createElement(HugeiconsIcon, {
      icon,
      "aria-hidden": true,
      ...(className === undefined ? {} : { className }),
    });
  return Glyph;
};

/**
 * Every icon the editor draws, named by its glyph: the chrome's own, and the ones a host draws
 * beside it through `EditorGlyph`. The defaults are the Hugeicons free set (Stroke Rounded, MIT). A
 * host replaces any of them through `EditorProvider`'s `icons`; the rest keep these.
 */
export const DEFAULT_EDITOR_ICONS = {
  alignCenter: hugeicon(TextAlignCenterIcon),
  alignLeft: hugeicon(TextAlignLeftIcon),
  alignRight: hugeicon(TextAlignRightIcon),
  arrowLeft: hugeicon(ArrowLeft02Icon),
  arrowUp: hugeicon(ArrowUp02Icon),
  arrowsExpand: hugeicon(ArrowExpand01Icon),
  arrowsToCenter: hugeicon(ArrowShrink01Icon),
  bulletList: hugeicon(LeftToRightListBulletIcon),
  buttonCursor: hugeicon(CursorPointer02Icon),
  chatBubble: hugeicon(BubbleChatIcon),
  check: hugeicon(Tick02Icon),
  checkList: hugeicon(CheckListIcon),
  chevronDown: hugeicon(ArrowDown01Icon),
  chevronLeft: hugeicon(ArrowLeft01Icon),
  chevronRight: hugeicon(ArrowRight01Icon),
  chevronUp: hugeicon(ArrowUp01Icon),
  clock: hugeicon(Clock01Icon),
  code: hugeicon(SourceCodeIcon),
  compare: hugeicon(GitCompareIcon),
  dividerY: hugeicon(SeparatorHorizontalIcon),
  download: hugeicon(Download04Icon),
  duplicate: hugeicon(Copy01Icon),
  envelope: hugeicon(Mail01Icon),
  eye: hugeicon(ViewIcon),
  files: hugeicon(Files01Icon),
  frame: hugeicon(FrameIcon),
  gridLayoutRows: hugeicon(Layout3RowIcon),
  heading1: hugeicon(Heading01Icon),
  image: hugeicon(Image01Icon),
  layers: hugeicon(Layers01Icon),
  message: hugeicon(Message01Icon),
  mobile: hugeicon(SmartPhone01Icon),
  minus: hugeicon(MinusSignIcon),
  monitor: hugeicon(ComputerIcon),
  moon: hugeicon(Moon02Icon),
  moreHorizontal: hugeicon(MoreHorizontalIcon),
  openExternal: hugeicon(LinkSquare02Icon),
  paintBrush: hugeicon(PaintBrush04Icon),
  palette: hugeicon(PaintBoardIcon),
  paragraph: hugeicon(ParagraphIcon),
  pin: hugeicon(Pin02Icon),
  plus: hugeicon(Add01Icon),
  redo: hugeicon(Redo02Icon),
  refresh: hugeicon(RefreshIcon),
  reset: hugeicon(RotateLeft01Icon),
  search: hugeicon(Search01Icon),
  sidebarLeft: hugeicon(PanelLeftIcon),
  sidebarLeftHide: hugeicon(PanelLeftCloseIcon),
  sidebarRight: hugeicon(PanelRightIcon),
  sidebarRightHide: hugeicon(PanelRightCloseIcon),
  sliders: hugeicon(SlidersHorizontalIcon),
  sparkle: hugeicon(SparklesIcon),
  sun: hugeicon(Sun03Icon),
  textColumns: hugeicon(Layout2ColumnIcon),
  trash: hugeicon(Delete02Icon),
  undo: hugeicon(Undo02Icon),
  xmark: hugeicon(Cancel01Icon),
} satisfies Record<string, EditorIcon>;

export type EditorIconName = keyof typeof DEFAULT_EDITOR_ICONS;

export type EditorIcons = { readonly [Name in EditorIconName]: EditorIcon };
