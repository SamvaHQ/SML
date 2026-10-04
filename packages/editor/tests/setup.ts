// happy-dom does not implement the Web Animations API. Base UI's ScrollArea waits for descendant
// animations before measuring its thumb, so tests need the no-animation result a settled document
// returns.
if (typeof HTMLElement !== "undefined" && HTMLElement.prototype.getAnimations === undefined) {
  HTMLElement.prototype.getAnimations = () => [];
}
