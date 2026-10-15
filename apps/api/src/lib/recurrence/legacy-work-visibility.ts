import type { Database } from '@docket/db';
import { ApiError } from '../../error';
import { loadCreationActor } from '../work-creation/context';
import { loadBlueprintSnapshot, type BlueprintWorkRef } from '../work-template-blueprints/snapshot';

/**
 * Current work visibility uses the ordinary snapshot policy for private work and scoped grants.
 * @returns Stable `kind:id` keys, excluding missing or unreadable work without exposing its prose.
 * @throws For inactive membership or an unexpected storage failure.
 */
export async function readableLegacyWork(
  database: Database,
  identity: { readonly organizationId: string; readonly actorId: string },
  references: readonly BlueprintWorkRef[],
): Promise<ReadonlySet<string>> {
  if (!references.length) return new Set();
  return database.transaction(async (tx) => {
    const caller = await loadCreationActor(tx, identity.organizationId, identity.actorId);
    const visible = await Promise.all(
      references.map(async (reference) => {
        try {
          await loadBlueprintSnapshot(tx, caller, reference, {
            scope: 'reference',
            access: 'view',
          });
          return `${reference.kind}:${reference.id}`;
        } catch (error) {
          if (error instanceof ApiError && (error.status === 403 || error.status === 404))
            return null;
          throw error;
        }
      }),
    );
    return new Set(visible.filter((reference) => reference !== null));
  });
}

/**
 * Hide a missing or unauthorized generated-work reference, including revoked foreground membership.
 * @throws For unexpected storage failures, which must not masquerade as complete history.
 */
export async function visibleLegacyWorkReference(
  database: Database,
  input: { readonly organizationId: string; readonly actorId?: string | undefined },
  reference: BlueprintWorkRef,
): Promise<boolean> {
  if (!input.actorId) return false;
  try {
    const visible = await readableLegacyWork(database, { ...input, actorId: input.actorId }, [
      reference,
    ]);
    return visible.has(`${reference.kind}:${reference.id}`);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 403 || error.status === 404)) return false;
    throw error;
  }
}
