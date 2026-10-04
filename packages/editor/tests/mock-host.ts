import type {
  AsyncEditableEditorHost,
  AsyncEditorHost,
  AsyncVersionsApi,
} from "@samva/editor/host";
import { toAsyncHost } from "@samva/editor/host/effect";
import { createMockHost, type MockHostControls } from "@samva/editor/mock";
import { Effect } from "effect";

/**
 * The controlled host component tests mount: the package's own mock, through the
 * async facade every real host is derived by. Tests drive it from the outside
 * (emit a foreign change, wrap one capability) rather than modelling editor
 * state a second time.
 */
export interface MockEditor {
  readonly host: AsyncEditableEditorHost;
  /** Publish a foreign change, with the render the host produced for it. */
  readonly emit: MockHostControls["emit"];
}

export const mockEditor = async (): Promise<MockEditor> => {
  const controls = await Effect.runPromise(createMockHost);
  return { host: toAsyncHost(controls.host), emit: controls.emit };
};

/** Publish a foreign change and settle the facade's delivery fiber. */
export const emitChange = async (
  editor: MockEditor,
  input: Parameters<MockHostControls["emit"]>[0],
): Promise<void> => {
  await Effect.runPromise(editor.emit(input));
  await settle();
};

/** Let the facade's stream fiber deliver whatever the mock just published. */
export const settle = (ms = 10): Promise<void> =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The same host, saving versions through `save` and reporting the saved head through `savedRevision`. */
export const withVersions = <Host extends AsyncEditorHost>(
  host: Host,
  save: AsyncVersionsApi["save"],
  savedRevision: AsyncVersionsApi["savedRevision"] = async () => null,
): Host => ({
  ...host,
  versions: { status: "ready", api: { save, savedRevision } },
});
