import type { TemplateTransaction } from './templates/persistence';
import type { SetTaskStateInput } from './task-state';
import type { BlueprintSnapshotAuthority } from './work-template-blueprints/snapshot-types';
import { snapshotCaller } from './work-template-blueprints/snapshot-access';
import { loadCreationActor } from './work-creation/context';
import { authorizeAutomationTaskState } from './automation/execution-authority';
import { ConflictError, NotFoundError } from '../error';

/** Resolve one checked live authority in the state transaction, independently of event attribution. */
export async function resolveTaskStateAuthority(
  tx: TemplateTransaction,
  input: SetTaskStateInput,
): Promise<BlueprintSnapshotAuthority | null> {
  if (input.automationExecution && input.blueprintAuthority)
    throw new ConflictError('Choose one checked mutation authority');
  const authority =
    (input.automationExecution
      ? await authorizeAutomationTaskState(tx, input.automationExecution, input)
      : input.blueprintAuthority) ??
    (input.actorId === null
      ? null
      : await loadCreationActor(tx, input.organizationId, input.actorId));
  if (authority && snapshotCaller(tx, authority).orgId !== input.organizationId)
    throw new NotFoundError('Task not found');
  return authority;
}
