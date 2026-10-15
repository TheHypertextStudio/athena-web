import { CapabilityError } from '../../error';
import type { TemplateTransaction } from '../templates/persistence';
import {
  prepareBlueprintChildTemplateCreation,
  prepareWorkTemplateCreation,
} from '../work-template-creation';
import { prospectiveWorkReference } from './ordinary-prospective';
import { retainedRootBinding } from './retained-authority';
import type {
  OrdinaryPreparationContext,
  OrdinaryWorkCommand,
  WorkCreateBodyByKind,
  WorkKind,
} from './types';

/** Apply the ordinary or authorized-child publication path without widening public offering rules. */
export async function ordinaryCreationDefaults(
  tx: TemplateTransaction,
  command: OrdinaryWorkCommand,
  context?: OrdinaryPreparationContext,
): Promise<WorkCreateBodyByKind[WorkKind]> {
  const id = command.invocation.prospectiveWorkId;
  if (id && !prospectiveWorkReference(tx, command, context, command.kind, id))
    throw new CapabilityError();
  if (retainedRootBinding(tx, command))
    return prepareBlueprintChildTemplateCreation(
      command.caller.orgId,
      command.kind,
      command.body,
      tx,
    );
  const child = id ? context?.publishedChildren.get(id) : undefined;
  if (!child)
    return prepareWorkTemplateCreation(command.caller.orgId, command.kind, command.body, tx);
  if (
    command.body.workTypeId !== child.workTypeId ||
    command.body.workTypeVersionId !== child.workTypeVersionId ||
    command.kind !== child.kind
  )
    throw new CapabilityError();
  return prepareBlueprintChildTemplateCreation(
    command.caller.orgId,
    command.kind,
    command.body,
    tx,
  );
}
