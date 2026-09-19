/** Capability checks shared by the forward and replay command paths. */
import { canActor, canActorBatch, type Capability, type ResourceKind } from '@docket/authz';

import { CapabilityError, NotFoundError } from '../../error';
import type { CommandScope } from './types';

/** Require one capability on one resource, reporting an invisible resource as missing. */
export async function assertResourceCapability(
  scope: CommandScope,
  kind: ResourceKind,
  id: string,
  required: Capability,
): Promise<void> {
  const { database, orgId, actorId } = scope;
  const result = await canActor(actorId, required, { kind, id, orgId }, database);
  if (result.allow) return;
  if (result.effectiveCapability === null)
    throw new NotFoundError(`${kind.charAt(0).toUpperCase()}${kind.slice(1)} not found`);
  throw new CapabilityError();
}

/** Require one capability across a homogeneous selection in a single batched check. */
export async function assertResourceCapabilities(
  scope: CommandScope,
  kind: 'task' | 'project',
  ids: readonly string[],
  required: Capability,
): Promise<void> {
  const { database, orgId, actorId } = scope;
  const results = await canActorBatch(
    actorId,
    required,
    ids.map((id) => ({ kind, id, orgId })),
    database,
  );
  if (results.some((result) => !result.allow && result.effectiveCapability === null)) {
    throw new NotFoundError(`${kind === 'task' ? 'Task' : 'Project'} not found`);
  }
  if (results.some((result) => !result.allow)) throw new CapabilityError();
}
