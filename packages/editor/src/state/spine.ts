import type { DocumentChange, EditorDocument, RevisionToken } from "@samva/editor/host";
import type { AsyncEditorHost } from "@samva/editor/host";
import { Predicate } from "effect";

/**
 * The persistence spine: the document session (open/change stream) and the
 * serialized save queue, held as PLAIN fields outside React and outside the
 * store — none of this ever renders. The store observes it purely through
 * {@link SpineCallbacks}, which fire synchronously so a store transition can
 * commit the consequence in the same tick.
 */
export interface EditorSpine {
  /** Open the document session — attach the change stream, then deliver `onInitial`. */
  readonly open: () => void;
  /** Tear the session down; in-flight saves and a pending open abort without callbacks. */
  readonly dispose: () => void;
  /**
   * Discard local persistence state and re-open from the host's truth: drops the
   * queue, clears the conflict, releases flush waiters, and starts a new session —
   * a save from the old session that resolves late can never touch the new one.
   */
  readonly reload: () => void;
  /** Queue a canonical TSX file replacement; the render arrives through the self change. */
  readonly enqueueAuthoredSource: (
    authoredSource: string,
    options?: { readonly coalesceKey?: string | undefined },
  ) => void;
  /**
   * Resolves once the persist queue is empty and the last save has acked, so a
   * publish reads the just-saved source rather than a pre-save snapshot. Resolves
   * immediately when nothing is pending. Rejects when storage pauses the active
   * drain; retrying the save keeps the queued edit intact.
   */
  readonly flushSaves: () => Promise<RevisionToken>;
  /** Re-attempt the queued saves after a storage failure — non-destructive, keeps the queue. */
  readonly retrySave: () => void;
  /** Adopt the revision returned by a persisted lifecycle operation and clear any conflict. */
  readonly adoptRev: (rev: RevisionToken) => void;
}

/** How the store observes the spine. Every callback fires synchronously with spine state settled. */
export interface SpineCallbacks {
  /** The opened document snapshot — once per (re)open, before any buffered change replays. */
  readonly onInitial: (doc: EditorDocument) => void;
  /** The writer durably accepted a save, before any delayed self change arrives. */
  readonly onPersistedRevision: (rev: RevisionToken) => void;
  /**
   * Our own acked save, or a re-render the host published for it, came back
   * through the change stream. Local authored text may have moved further ahead
   * in a burst, so the store keeps the newer edit and takes everything else.
   */
  readonly onSelfAck: (change: DocumentChange) => void;
  /**
   * A foreign (agent/external) edit. The host is truth: replace source + rev and
   * fence undo. `saveInFlight` means our optimistic base was stale when it landed —
   * the spine has already stopped draining; surface the conflict.
   */
  readonly onForeignChange: (change: DocumentChange, saveInFlight: boolean) => void;
  /** A save rejected for a non-storage reason: local diverged from host. The queue was dropped. */
  readonly onConflict: () => void;
  /**
   * Storage availability changed: a reason when a save failed because the host's
   * store is full or blocked (queue kept, draining paused), `null` when a later
   * save landed and storage is writable again.
   */
  readonly onStorageError: (reason: string | null) => void;
  /**
   * The session could not open, or its live change stream failed — no session
   * remains. `retrySave` re-opens instead of draining while in this state, so
   * the same retry affordance recovers from both failure classes.
   */
  readonly onSessionError: (reason: string) => void;
}

/** A queued persist. `baseRev` is filled at drain time from the latest acked rev. */
type QueueItem = {
  readonly kind: "authoredSource";
  readonly authoredSource: string;
  readonly coalesceKey?: string | undefined;
};

/**
 * A save rejected because the host's storage is unavailable (quota exceeded, private
 * mode, blocked). Duck-typed on the tagged error the async facade rejects with — a
 * storage failure must not be mistaken for a document conflict.
 */
const isDocumentUnavailable = (
  error: unknown,
): error is { readonly _tag: "DocumentUnavailable"; readonly reason: string } =>
  Predicate.hasProperty(error, "_tag") &&
  error._tag === "DocumentUnavailable" &&
  Predicate.hasProperty(error, "reason") &&
  typeof error.reason === "string";

/** Human-readable reason for a failed open / dead change stream, best tag first. */
const sessionErrorReason = (error: unknown): string =>
  isDocumentUnavailable(error)
    ? error.reason
    : error instanceof Error
      ? error.message
      : "The document session failed.";

export const createEditorSpine = (
  host: AsyncEditorHost,
  callbacks: SpineCallbacks,
): EditorSpine => {
  // `rev` is the last ACKED rev and is advanced by the drainer (from `save()`),
  // revision-only self changes, foreign changes, and adopted lifecycle
  // snapshots. Ordinary self acks still do not replace the drainer's value, so
  // a save always carries a baseRev the host will accept, even under rapid edits.
  let rev: RevisionToken = "";
  let queue: QueueItem[] = [];
  let draining = false;
  let authoredSourceDrainTimer: ReturnType<typeof setTimeout> | undefined;
  let conflicted = false;
  // True from a delivered initial until the stream errors or the session closes.
  // While false, retrySave re-opens the session instead of draining.
  let sessionLive = false;
  let closeSession: (() => void) | undefined;
  // Waiters for in-flight flushSaves() calls, settled when the active drain
  // completes or storage pauses it.
  let flushWaiters: Array<{
    readonly resolve: (rev: RevisionToken) => void;
    readonly reject: (error: unknown) => void;
  }> = [];
  // A session token bumped on every (re)open and on dispose. The drainer and the
  // open handshake capture it and re-check after each await; anything that
  // resolves for a superseded session aborts without touching shared state, so a
  // late ack from a pre-reload save can never clobber `rev` or `shift()` a
  // post-reload item off the queue. Dispose is just a bump with no re-open, so a
  // disposed spine can be opened again (StrictMode re-runs mount effects on the
  // same store bundle).
  let generation = 0;

  // Release every pending flushSaves() resolver — the persist queue has settled
  // (fully drained, or stopped on a conflict/reload that cleared it).
  const settleFlush = () => {
    const waiters = flushWaiters;
    flushWaiters = [];
    for (const waiter of waiters) waiter.resolve(rev);
  };

  const rejectFlush = (error: unknown) => {
    const waiters = flushWaiters;
    flushWaiters = [];
    for (const waiter of waiters) waiter.reject(error);
  };

  // Drain queued persists one at a time. Serialization is required because host
  // revisions are opaque tokens the editor can't predict: each save must carry
  // the freshest ACKED rev as `baseRev`, which is only known once the prior save
  // returns. A rejected save (conflict or transport) means local ≠ host, so we
  // stop, drop the queue, and leave recovery to the reload path.
  const drain = () => {
    if (authoredSourceDrainTimer !== undefined) {
      clearTimeout(authoredSourceDrainTimer);
      authoredSourceDrainTimer = undefined;
    }
    if (host.access !== "editable") return;
    const writer = host.writer;
    if (draining) return;
    draining = true;
    const drainGeneration = generation;
    void (async () => {
      while (queue.length > 0 && !conflicted) {
        const item = queue[0]!;
        const update = {
          kind: "authoredSource" as const,
          baseRev: rev,
          authoredSource: item.authoredSource,
        };
        // oxlint-disable-next-line samva/no-try-catch-or-throw -- Async host facade boundary (not Effect domain): `save` is a promise that rejects with the host's DocumentError; any rejection means our optimistic base diverged, which the spine resolves via the conflict/reload path.
        try {
          // oxlint-disable-next-line no-await-in-loop -- Serialization is the point: opaque host revs can't be predicted, so each save must carry the freshest ACKED rev, known only once the prior save returns. Parallelizing would break baseRev ordering.
          const result = await writer.save(update);
          // A reload/dispose happened while this save was in flight: the queue and
          // rev now belong to a new session — leave them alone.
          if (generation !== drainGeneration) return;
          rev = result.rev;
          callbacks.onPersistedRevision(rev);
          queue.shift();
          // A save landed — storage is writable again, so clear any prior storage error.
          callbacks.onStorageError(null);
        } catch (error) {
          if (generation !== drainGeneration) return;
          // A storage-unavailable rejection (quota / blocked store) is NOT a conflict:
          // the optimistic source is still correct and the host didn't advance. Keep
          // the queue intact, surface the reason, and stop draining until a retry —
          // never send the user down the discard-your-edit reload path.
          if (isDocumentUnavailable(error)) {
            callbacks.onStorageError(error.reason);
            draining = false;
            rejectFlush(error);
            return;
          }
          queue = [];
          conflicted = true;
          callbacks.onConflict();
          break;
        }
      }
      // Only the live drain owns the lock; a stale one already returned above.
      if (generation !== drainGeneration) return;
      draining = false;
      // Settled — the queue is empty, or a conflict stopped and cleared it.
      settleFlush();
    })();
  };

  // Open a fresh session. `open` attaches the change subscription before it
  // resolves `initial` (no missed-change gap); a change that arrives between the
  // subscription attaching and `initial` applying is buffered and replayed —
  // through the SAME handler as live changes — in arrival order, so a buffered
  // agent/external edit fences undo and surfaces conflicts exactly like a live one.
  const open = () => {
    generation += 1;
    // Any in-flight drain from the previous session is now stale and will abort
    // on its next await, so release the drain lock here.
    draining = false;
    sessionLive = false;
    const openGeneration = generation;
    let initialApplied = false;
    const buffered: DocumentChange[] = [];
    const handleChange = (change: DocumentChange) => {
      if (generation !== openGeneration) return;
      if (change.origin === "self") {
        // Our own save, or a re-render the host published for the revision we
        // already hold. The store adopts the payload; `rev` stays whatever the
        // drainer last acked so the next save still carries a baseRev the host
        // accepts.
        callbacks.onSelfAck(change);
        return;
      }
      // A foreign change arriving while our own save is still in flight (the item
      // stays at queue[0] until acked) means our optimistic base is stale.
      const saveInFlight = queue.length > 0;
      if (saveInFlight) conflicted = true;
      rev = change.rev;
      callbacks.onForeignChange(change, saveInFlight);
    };
    host.document
      .open(
        (change) => {
          if (initialApplied) handleChange(change);
          else buffered.push(change);
        },
        // The live change stream died (transport drop, host teardown). The session
        // is gone; surface it and let retrySave re-open.
        (error) => {
          if (generation !== openGeneration) return;
          sessionLive = false;
          callbacks.onSessionError(sessionErrorReason(error));
        },
      )
      .then(({ initial, close }) => {
        if (generation !== openGeneration) {
          close();
          return;
        }
        closeSession = close;
        initialApplied = true;
        sessionLive = true;
        rev = initial.rev;
        callbacks.onInitial(initial);
        for (const change of buffered) handleChange(change);
        buffered.length = 0;
        // A session re-opened by retrySave may still hold queued edits from the
        // dead one: resume the drain against the fresh rev — the host adjudicates
        // (and rejects into the conflict path) if they no longer apply.
        if (queue.length > 0) drain();
      })
      // The open handshake itself rejected (auth, permission, transport): without
      // this the editor would sit on a silent endless loading state.
      .catch((error: unknown) => {
        if (generation !== openGeneration) return;
        callbacks.onSessionError(sessionErrorReason(error));
      });
  };

  return {
    open,
    dispose: () => {
      generation += 1;
      if (authoredSourceDrainTimer !== undefined) clearTimeout(authoredSourceDrainTimer);
      authoredSourceDrainTimer = undefined;
      sessionLive = false;
      closeSession?.();
      closeSession = undefined;
    },
    reload: () => {
      conflicted = false;
      queue = [];
      draining = false;
      if (authoredSourceDrainTimer !== undefined) clearTimeout(authoredSourceDrainTimer);
      authoredSourceDrainTimer = undefined;
      // The old session's drain won't settle (its generation goes stale below),
      // so release any flush waiters here — the queue is empty as of this reset.
      settleFlush();
      closeSession?.();
      closeSession = undefined;
      open();
    },
    enqueueAuthoredSource: (authoredSource, options) => {
      if (host.access !== "editable") return;
      const next: QueueItem = {
        kind: "authoredSource",
        authoredSource,
        coalesceKey: options?.coalesceKey,
      };
      const tailIndex = queue.length - 1;
      const tail = queue[tailIndex];
      const tailIsUnsent = tailIndex >= (draining ? 1 : 0);
      if (
        next.coalesceKey !== undefined &&
        tailIsUnsent &&
        tail?.kind === "authoredSource" &&
        tail.coalesceKey === next.coalesceKey
      ) {
        queue[tailIndex] = next;
      } else {
        queue.push(next);
      }
      if (authoredSourceDrainTimer !== undefined) clearTimeout(authoredSourceDrainTimer);
      authoredSourceDrainTimer = setTimeout(drain, 300);
    },
    flushSaves: () => {
      if (authoredSourceDrainTimer !== undefined) drain();
      return queue.length === 0 && !draining
        ? Promise.resolve(rev)
        : new Promise<RevisionToken>((resolve, reject) => {
            flushWaiters.push({ resolve, reject });
          });
    },
    retrySave: () => {
      if (host.access !== "editable") return;
      callbacks.onStorageError(null);
      // No live session (the open failed or the stream died): retry means
      // re-open, not drain — the queue is re-based once the new initial lands.
      if (!sessionLive) {
        closeSession?.();
        closeSession = undefined;
        open();
        return;
      }
      drain();
    },
    adoptRev: (adopted) => {
      rev = adopted;
      conflicted = false;
    },
  };
};
