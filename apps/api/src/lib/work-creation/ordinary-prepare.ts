import { ConflictError } from '../../error';
import type { TemplateTransaction } from '../templates/persistence';
import { authorizeOrdinaryCreation } from './context';
import {
  prepareOrdinaryInitiative,
  prepareOrdinaryProgram,
  prepareOrdinaryProject,
} from './ordinary-containers';
import { prepareOrdinaryTask } from './ordinary-task';
import { prospectiveWorkReference } from './ordinary-prospective';
import type {
  OrdinaryWorkCommand,
  PreparedOrdinaryWork,
  OrdinaryPreparationContext,
} from './types';

/** Resolve and validate one ordinary node on the caller's transaction without inserting work. */
export async function prepareOrdinaryWork(
  tx: TemplateTransaction,
  command: OrdinaryWorkCommand,
  context?: OrdinaryPreparationContext,
): Promise<PreparedOrdinaryWork> {
  await authorizeOrdinaryCreation(tx, command);
  const prepared = await preparationByKind(tx, command, context);
  const id = command.invocation.prospectiveWorkId;
  if (id) {
    const prospective = prospectiveWorkReference(tx, command, context, command.kind, id);
    if (!prospective) throw new ConflictError('Prepared work reference changed');
    prepared.insert.values.id = prospective.id;
  }
  return prepared;
}

function preparationByKind(
  tx: TemplateTransaction,
  command: OrdinaryWorkCommand,
  context: OrdinaryPreparationContext | undefined,
): Promise<PreparedOrdinaryWork> {
  switch (command.kind) {
    case 'task':
      return prepareOrdinaryTask(tx, command, context);
    case 'project':
      return prepareOrdinaryProject(tx, command, context);
    case 'initiative':
      return prepareOrdinaryInitiative(tx, command, context);
    case 'program':
      return prepareOrdinaryProgram(tx, command, context);
  }
}
