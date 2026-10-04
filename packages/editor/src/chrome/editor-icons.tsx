import { useEditorIcons } from "./icon-context";
import type { EditorIcon, EditorIconName } from "./icon-set";

// Chrome draws icons through these components rather than a vendor package, so a host's icon set
// applies everywhere without a component knowing which set is in effect.

const icon = (name: EditorIconName): EditorIcon => {
  // oxlint-disable-next-line react/only-export-components -- Every export below is a component this factory builds; the rule cannot see through the call, and a hot update re-runs this module's importers as it should.
  const Drawn: EditorIcon = ({ className }) => {
    const Icon = useEditorIcons()[name];
    return <Icon {...(className === undefined ? {} : { className })} />;
  };
  Drawn.displayName = `EditorIcon(${name})`;
  return Drawn;
};

export const ArrowsExpand = icon("arrowsExpand");
export const ArrowsToCenter = icon("arrowsToCenter");
export const BulletList = icon("bulletList");
export const ButtonCursor = icon("buttonCursor");
export const ChevronDown = icon("chevronDown");
export const ChevronLeft = icon("chevronLeft");
export const ChevronRight = icon("chevronRight");
export const ChevronUp = icon("chevronUp");
export const DividerY = icon("dividerY");
export const Download = icon("download");
export const Envelope = icon("envelope");
export const Eye = icon("eye");
export const Files = icon("files");
export const Frame = icon("frame");
export const GridLayoutRows = icon("gridLayoutRows");
export const Heading1 = icon("heading1");
export const Image = icon("image");
export const Layers = icon("layers");
export const Mobile = icon("mobile");
export const Monitor = icon("monitor");
export const Palette = icon("palette");
export const Paragraph = icon("paragraph");
export const SidebarLeft = icon("sidebarLeft");
export const SidebarLeftHide = icon("sidebarLeftHide");
export const SidebarRight = icon("sidebarRight");
export const SidebarRightHide = icon("sidebarRightHide");
export const Sliders = icon("sliders");
export const Sparkle = icon("sparkle");
export const TextColumns = icon("textColumns");
export const Xmark = icon("xmark");
