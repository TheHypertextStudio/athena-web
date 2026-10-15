import type {
  BlueprintPlacement,
  ExistingBlueprintNode,
  ResolvedRootDraft,
} from '@docket/work/blueprints';
import type { AuthorizedBlueprintSnapshot, BlueprintStoredWork } from './snapshot-types';

/** Actual physical placement, independent of an immutable generated logical path. */
export function selectivePlacement(work: BlueprintStoredWork): BlueprintPlacement {
  switch (work.kind) {
    case 'task':
      return {
        programId: work.row.programId,
        projectId: work.row.projectId,
        milestoneId: work.row.milestoneId,
        parentTaskId: work.row.parentTaskId,
      };
    case 'project':
      return { programId: work.row.programId };
    case 'milestone':
      return { projectId: work.row.projectId };
    case 'initiative':
    case 'program':
      return {};
  }
}

/** Keep manual snapshot paths separate while matching generated rows through stored source coordinates. */
export function selectiveCurrentNodes(
  snapshot: AuthorizedBlueprintSnapshot,
): ExistingBlueprintNode[] {
  return snapshot.nodes.map((node) => {
    const work = snapshot.rowsByRef.get(`${node.kind}:${node.id}`);
    const path = node.parentPath === null ? [] : work?.row.blueprintPath;
    if (!path || !node.sourceStepId || !node.sourceWorkTypeId) return node;
    return { ...node, path, parentPath: path.length === 0 ? null : path.slice(0, -1) };
  });
}

/** Existing root prose and anchor context for planning; this projection is never inserted as a new root. */
export function selectiveRootDraft(snapshot: AuthorizedBlueprintSnapshot): ResolvedRootDraft {
  const root = snapshot.root;
  const work = snapshot.rowsByRef.get(`${root.kind}:${root.id}`);
  if (!work || work.kind === 'milestone') throw new Error('Missing authorized root');
  const common = {
    teamId: root.teamId,
    responsibleActorId: root.responsibleActorId,
    cycleId: root.cycleId,
    dates: root.dates,
    placement: selectivePlacement(work),
    documentPrepared: true,
    terminal: root.state === 'completed' || root.state === 'canceled',
  };
  switch (work.kind) {
    case 'task':
      return { ...common, kind: 'task', fields: root.fields };
    case 'project':
      return { ...common, kind: 'project', fields: root.fields };
    case 'initiative':
      return {
        ...common,
        kind: 'initiative',
        fields: {
          name: work.row.name,
          summary: work.row.summary,
          description: work.row.description ?? '',
          priority: work.row.priority,
          status: work.row.status,
          health: work.row.health,
          updateCadence: work.row.updateCadence,
        },
      };
    case 'program':
      return { ...common, kind: 'program', fields: root.fields };
  }
}
