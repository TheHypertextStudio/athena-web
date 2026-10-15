import { TaskCreate } from '@docket/work/task-model';
import { InitiativeCreate } from '@docket/work/initiative-contract';
import { ProgramCreate } from '@docket/work/program-contract';
import { ProjectCreate } from '../../contracts/project';
import type { PlaceInput } from '../organize/place';
import { originFor } from '../provenance/context';
import type { TemplateTransaction } from '../templates/persistence';
import { loadCreationActor } from './context';
import type { WorkCreationCommand, TrustedCreationInvocation } from './types';

/** Translate an already-resolved existing plan item without changing name-match decisions. */
export async function commandForPlacedWork(
  tx: TemplateTransaction,
  input: PlaceInput,
): Promise<WorkCreationCommand> {
  const caller = await loadCreationActor(tx, input.orgId, input.actorId);
  const { item, at } = input;
  const invocation: TrustedCreationInvocation = {
    origin: input.origin ?? originFor('organize'),
    placement: {
      programId: at.programId,
      ...(item.visibility === undefined ? {} : { visibility: item.visibility }),
      initiativeId: at.initiativeId,
    },
    ...(item.labelIds === undefined ? {} : { labelIds: item.labelIds }),
  };
  const body = placementBody(input);
  switch (item.kind) {
    case 'initiative':
      return { caller, kind: item.kind, invocation, body: InitiativeCreate.parse(body) };
    case 'program':
      return { caller, kind: item.kind, invocation, body: ProgramCreate.parse(body) };
    case 'project':
      return { caller, kind: item.kind, invocation, body: ProjectCreate.parse(body) };
    case 'task':
      return { caller, kind: item.kind, invocation, body: TaskCreate.parse(body) };
    case 'milestone':
      throw new Error('Milestone placement uses the existing milestone writer');
  }
}

/** Keep resolved placement fields together before each public create schema strips unrelated fields. */
function placementBody(input: PlaceInput) {
  const { item, at } = input;
  return {
    description: item.description,
    summary: item.summary,
    workTypeId: item.workTypeId,
    workTypeVersionId: item.workTypeVersionId,
    name: item.title,
    title: item.title,
    ownerId: input.ownerId ?? undefined,
    leadId: input.leadId ?? undefined,
    teamId: input.teamId,
    programId: at.programId ?? undefined,
    projectId: at.projectId ?? undefined,
    milestoneId: at.milestoneId ?? undefined,
    parentTaskId: at.parentTaskId ?? undefined,
    assigneeId: input.assigneeId ?? undefined,
    health: item.health,
    priority: item.priority,
    status: item.status,
    state: input.state.state,
    updateCadence: item.updateCadence,
    visibility: item.visibility,
    targetDate: item.targetDate,
    dueDate: item.dueDate,
    labelIds: item.labelIds,
    labels: item.labelIds,
    initiativeIds: at.initiativeId ? [at.initiativeId] : [],
    templateId: input.templateId,
  };
}
