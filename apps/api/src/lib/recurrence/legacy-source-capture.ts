import type { Database } from '@docket/db';
import { NotFoundError } from '../../error';
import { loadCreationActor } from '../work-creation/context';
import { loadBlueprintSnapshot } from '../work-template-blueprints/snapshot';
import type { TemplateTransaction } from '../templates/persistence';
import { requireLegacyActor } from './legacy-definition-access';

/**
 * Capture legacy source prose only after checking and locking its complete current ordinary-work tree.
 * @param capture - Reads the authorized source on the same transaction, before its locks release.
 * @throws For missing or hidden work, excessive trees, changed membership, or a failed capture.
 */
export async function captureLegacyProjectSource<T>(
  database: Database,
  input: {
    readonly organizationId: string;
    readonly actorId?: string | undefined;
    readonly projectId: string;
  },
  capture: (tx: TemplateTransaction) => Promise<T>,
): Promise<T> {
  return database.transaction(async (tx) => {
    const actorId = requireLegacyActor(input.actorId);
    const caller = await loadCreationActor(tx, input.organizationId, actorId);
    try {
      await loadBlueprintSnapshot(
        tx,
        caller,
        { kind: 'project', id: input.projectId },
        { scope: 'tree', access: 'view', forUpdate: true },
      );
    } catch (error) {
      if (error instanceof NotFoundError) throw new NotFoundError('Project not found');
      throw error;
    }
    return capture(tx);
  });
}
