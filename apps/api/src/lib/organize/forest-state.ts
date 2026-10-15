import { actor, role } from '@docket/db';
import { and, eq } from 'drizzle-orm';
import { CapabilityError, NotFoundError } from '../../error';
import { loadCreationActor } from '../work-creation/context';
import type { TemplateTransaction } from '../templates/persistence';
import type { PreparedPlacementForest } from './forest-types';

const forestTransactions = new WeakMap<PreparedPlacementForest, TemplateTransaction>();

/** Start one read-first reconciliation forest with its current persisted initiating authority. */
export async function createPlacementForest(
  tx: TemplateTransaction,
  orgId: string,
  actorId: string,
): Promise<PreparedPlacementForest> {
  const caller = await loadCreationActor(tx, orgId, actorId);
  const [principal] = await tx
    .select({ kind: actor.kind, roleKey: role.key, roleVisibility: role.defaultVisibility })
    .from(actor)
    .leftJoin(role, and(eq(actor.roleId, role.id), eq(role.organizationId, orgId)))
    .where(and(eq(actor.id, actorId), eq(actor.organizationId, orgId)))
    .limit(1);
  if (!principal) throw new NotFoundError('Workspace not found');
  const forest: PreparedPlacementForest = {
    caller,
    access: {
      organizationId: orgId,
      actorId,
      roleId: caller.roleId,
      isGuest:
        principal.kind !== 'human' ||
        principal.roleKey === 'guest' ||
        principal.roleVisibility === 'private',
    },
    operations: [],
    trees: [],
    placed: [],
    byRef: new Map(),
    matches: new Map(),
    prospective: new Map(),
    normalizedNames: new Map(),
    checkpointSorts: new Map(),
    rowCount: 0,
  };
  forestTransactions.set(forest, tx);
  return forest;
}

/** Refuse copied or cross-transaction planning state before any read or mutation uses its authority. */
export function requirePlacementForest(
  tx: TemplateTransaction,
  forest: PreparedPlacementForest,
): void {
  if (forestTransactions.get(forest) !== tx) throw new CapabilityError();
}
