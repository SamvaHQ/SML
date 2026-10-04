import ArrowDown01Icon from "@hugeicons/core-free-icons/ArrowDown01Icon";
import ArrowExpand01Icon from "@hugeicons/core-free-icons/ArrowExpand01Icon";
import ArrowLeft01Icon from "@hugeicons/core-free-icons/ArrowLeft01Icon";
import ArrowLeft02Icon from "@hugeicons/core-free-icons/ArrowLeft02Icon";
import ArrowRight01Icon from "@hugeicons/core-free-icons/ArrowRight01Icon";
import ArrowShrink01Icon from "@hugeicons/core-free-icons/ArrowShrink01Icon";
import ArrowUp01Icon from "@hugeicons/core-free-icons/ArrowUp01Icon";
import BubbleChatIcon from "@hugeicons/core-free-icons/BubbleChatIcon";
import Cancel01Icon from "@hugeicons/core-free-icons/Cancel01Icon";
import ComputerIcon from "@hugeicons/core-free-icons/ComputerIcon";
import CursorPointer02Icon from "@hugeicons/core-free-icons/CursorPointer02Icon";
import Download04Icon from "@hugeicons/core-free-icons/Download04Icon";
import Files01Icon from "@hugeicons/core-free-icons/Files01Icon";
import FrameIcon from "@hugeicons/core-free-icons/FrameIcon";
import Heading01Icon from "@hugeicons/core-free-icons/Heading01Icon";
import Image01Icon from "@hugeicons/core-free-icons/Image01Icon";
import Layers01Icon from "@hugeicons/core-free-icons/Layers01Icon";
import Layout2ColumnIcon from "@hugeicons/core-free-icons/Layout2ColumnIcon";
import Layout3RowIcon from "@hugeicons/core-free-icons/Layout3RowIcon";
import LeftToRightListBulletIcon from "@hugeicons/core-free-icons/LeftToRightListBulletIcon";
import Mail01Icon from "@hugeicons/core-free-icons/Mail01Icon";
import Message01Icon from "@hugeicons/core-free-icons/Message01Icon";
import Moon02Icon from "@hugeicons/core-free-icons/Moon02Icon";
import PaintBoardIcon from "@hugeicons/core-free-icons/PaintBoardIcon";
import PanelLeftCloseIcon from "@hugeicons/core-free-icons/PanelLeftCloseIcon";
import PanelLeftIcon from "@hugeicons/core-free-icons/PanelLeftIcon";
import PanelRightCloseIcon from "@hugeicons/core-free-icons/PanelRightCloseIcon";
import PanelRightIcon from "@hugeicons/core-free-icons/PanelRightIcon";
import ParagraphIcon from "@hugeicons/core-free-icons/ParagraphIcon";
import SeparatorHorizontalIcon from "@hugeicons/core-free-icons/SeparatorHorizontalIcon";
import SlidersHorizontalIcon from "@hugeicons/core-free-icons/SlidersHorizontalIcon";
import SmartPhone01Icon from "@hugeicons/core-free-icons/SmartPhone01Icon";
import SparklesIcon from "@hugeicons/core-free-icons/SparklesIcon";
import Sun03Icon from "@hugeicons/core-free-icons/Sun03Icon";
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
  arrowLeft: hugeicon(ArrowLeft02Icon),
  arrowsExpand: hugeicon(ArrowExpand01Icon),
  arrowsToCenter: hugeicon(ArrowShrink01Icon),
  bulletList: hugeicon(LeftToRightListBulletIcon),
  buttonCursor: hugeicon(CursorPointer02Icon),
  chatBubble: hugeicon(BubbleChatIcon),
  chevronDown: hugeicon(ArrowDown01Icon),
  chevronLeft: hugeicon(ArrowLeft01Icon),
  chevronRight: hugeicon(ArrowRight01Icon),
  chevronUp: hugeicon(ArrowUp01Icon),
  dividerY: hugeicon(SeparatorHorizontalIcon),
  download: hugeicon(Download04Icon),
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
  monitor: hugeicon(ComputerIcon),
  moon: hugeicon(Moon02Icon),
  palette: hugeicon(PaintBoardIcon),
  paragraph: hugeicon(ParagraphIcon),
  sidebarLeft: hugeicon(PanelLeftIcon),
  sidebarLeftHide: hugeicon(PanelLeftCloseIcon),
  sidebarRight: hugeicon(PanelRightIcon),
  sidebarRightHide: hugeicon(PanelRightCloseIcon),
  sliders: hugeicon(SlidersHorizontalIcon),
  sparkle: hugeicon(SparklesIcon),
  sun: hugeicon(Sun03Icon),
  textColumns: hugeicon(Layout2ColumnIcon),
  xmark: hugeicon(Cancel01Icon),
} satisfies Record<string, EditorIcon>;

export type EditorIconName = keyof typeof DEFAULT_EDITOR_ICONS;

export type EditorIcons = { readonly [Name in EditorIconName]: EditorIcon };
