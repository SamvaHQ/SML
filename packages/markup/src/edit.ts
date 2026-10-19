// The edit entry: source spans and the precise source edits the visual editor and agents apply,
// and the preview an editor shows, with the identity of every rendered element.
export * from "./source-edit";
export * from "./channel-edit";
export * from "./source-locations";
export {
  emailAuthoringTarget,
  emailDefinitionInstances,
  emailSelectionAncestry,
  emailSelectionIndex,
  emailSelections,
  emailSelectionSiblings,
  INSTANCE_PATH_ATTRIBUTE,
  previewEmail,
  type EmailElementSelection,
  type EmailPreview,
  type EmittedPosition,
} from "./preview";
