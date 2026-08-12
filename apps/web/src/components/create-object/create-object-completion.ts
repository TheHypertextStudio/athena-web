import type { SameWorkspaceCompletion } from './create-object-provider';

/** Inputs for the completion policy shared by every global composer host. */
export interface CompleteCreateObjectOptions<Created> {
  /** Object returned by the destination workspace's create endpoint. */
  readonly created: Created;
  /** Workspace captured when the launcher opened the composer. */
  readonly initialWorkspaceId: string | null;
  /** Workspace selected when the object was submitted. */
  readonly targetWorkspaceId: string | null;
  /** Completion requested by the launcher for an unchanged destination. */
  readonly sameWorkspaceCompletion: SameWorkspaceCompletion;
  /** Launcher-owned same-workspace update, suppressed after destination changes. */
  readonly onCreated?: (created: Created) => void;
  /** Destination query keys whose cached reads are stale after the create. */
  readonly invalidationKeys: readonly (readonly unknown[])[];
  /** Invalidate one destination key. */
  readonly invalidate: (queryKey: readonly unknown[]) => void;
  /**
   * Write the created object into the cache the destination reads from.
   *
   * @remarks
   * The create response already carries the whole record, and without this it is thrown away
   * apart from the id in the URL — so the destination page mounts against an empty cache and
   * shows a skeleton for something the client was just handed. Entity-specific because only the
   * composer knows which typed key holds its record.
   */
  readonly seed?: () => void;
  /** Open the destination object's canonical surface. */
  readonly openDestination: () => void;
  /** Whether this completion may navigate; false while a create-more flow continues. */
  readonly navigationEnabled?: boolean;
}

/**
 * Apply global create invalidation, callback, and navigation policy in one place.
 *
 * @remarks
 * Every success invalidates destination-owned reads. An unchanged destination honors the
 * launcher's stay/open choice and may notify its page. A changed destination always routes to the
 * created object's destination and never invokes an origin-page callback with foreign data.
 *
 * @param options - Created object, workspace comparison, invalidations, and completion effects.
 */
export function completeCreateObject<Created>(options: CompleteCreateObjectOptions<Created>): void {
  // Before anything else, and specifically before navigation: the destination page reads the
  // cache as it mounts, so a seed that lands afterwards is one the page has already rendered a
  // skeleton instead of. Best-effort like the launcher callback below — a cache write that fails
  // should cost a slower screen, never the screen itself.
  try {
    options.seed?.();
  } catch {
    // The destination can always fetch for itself; this only decides whether it has to.
  }

  for (const queryKey of options.invalidationKeys) options.invalidate(queryKey);

  const targetIsOriginalWorkspace = options.targetWorkspaceId === options.initialWorkspaceId;
  if (targetIsOriginalWorkspace && options.onCreated) {
    try {
      options.onCreated(options.created);
    } catch {
      // Launcher refresh/prepend effects are best-effort after a confirmed create. A page-local
      // failure must not turn the successful mutation into a composer error or block navigation.
    }
  }

  if (
    options.navigationEnabled !== false &&
    (!targetIsOriginalWorkspace || options.sameWorkspaceCompletion === 'open')
  ) {
    options.openDestination();
  }
}
