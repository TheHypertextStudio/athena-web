import { TaskCreate } from '@docket/work/task-model';
import { InitiativeCreate } from '@docket/work/initiative-contract';
import { ProgramCreate } from '@docket/work/program-contract';
import { ProjectCreate } from '../../contracts/project';
import { originFor } from '../provenance/context';
import type { WorkCreationCommand } from '../work-creation/types';
import type { PreparedSelectiveReview } from './selective-review';

/** Carry the real initiating actor to ordinary child preparation; this command never inserts its root. */
export function selectivePreparationCommand(review: PreparedSelectiveReview): WorkCreationCommand {
  const { caller, snapshot, graph } = review;
  const root = snapshot.root;
  const identity = { workTypeId: graph.root.workTypeId, workTypeVersionId: graph.root.versionId };
  const invocation = { origin: originFor('work_template_assignment') };
  const name =
    'title' in root.fields
      ? root.fields.title
      : 'name' in root.fields
        ? root.fields.name
        : undefined;
  switch (review.kind) {
    case 'task':
      return {
        caller,
        kind: 'task',
        invocation,
        body: TaskCreate.parse({ ...identity, title: name, teamId: root.teamId }),
      };
    case 'project':
      return {
        caller,
        kind: 'project',
        invocation,
        body: ProjectCreate.parse({ ...identity, name, teamId: root.teamId ?? undefined }),
      };
    case 'initiative':
      return {
        caller,
        kind: 'initiative',
        invocation,
        body: InitiativeCreate.parse({ ...identity, name, leadTeamId: root.teamId ?? undefined }),
      };
    case 'program':
      return {
        caller,
        kind: 'program',
        invocation,
        body: ProgramCreate.parse({ ...identity, name }),
      };
  }
}
