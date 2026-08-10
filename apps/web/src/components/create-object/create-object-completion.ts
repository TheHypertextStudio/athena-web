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
  for (const queryKey of options.invalidationKeys) options.invalidate(queryKey);

  const targetIsOriginalWorkspace = options.targetWorkspaceId === options.initialWorkspaceId;
  if (targetIsOriginalWorkspace) options.onCreated?.(options.created);

  if (
    options.navigationEnabled !== false &&
    (!targetIsOriginalWorkspace || options.sameWorkspaceCompletion === 'open')
  ) {
    options.openDestination();
  }
}
