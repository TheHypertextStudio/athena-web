import { ActorId, TeamId } from '@docket/identity-access/ids';
import { BlueprintStepId, CycleId, WorkTypeId, WorkTypeVersionId } from '@docket/work/ids';
import type {
  BlueprintDateField,
  ExistingBlueprintNode,
  ResolvedBlueprintFields,
} from '@docket/work/blueprints';
import type { BlueprintSnapshotRow } from './snapshot-types';

/** Date-only storage coordinates must not be shifted through the actor's timezone. */
export function snapshotCivilDate(date: Date | null): string | null {
  return date?.toISOString().slice(0, 10) ?? null;
}
function fields({ work }: BlueprintSnapshotRow): ResolvedBlueprintFields {
  switch (work.kind) {
    case 'task':
      return {
        title: work.row.title,
        summary: work.row.summary,
        description: work.row.description ?? '',
        state: work.row.state,
        priority: work.row.priority,
        ...(work.row.estimate === null ? {} : { estimate: work.row.estimate }),
        estimateMinutes: work.row.estimateMinutes,
      };
    case 'project':
      return {
        name: work.row.name,
        summary: work.row.summary,
        description: work.row.description ?? '',
        status: work.row.status,
        priority: work.row.priority,
        health: work.row.health,
      };
    case 'initiative':
      return {
        name: work.row.name,
        summary: work.row.summary,
        description: work.row.description ?? '',
        status: work.row.status,
        priority: work.row.priority,
        health: work.row.health,
        updateCadence: work.row.updateCadence,
      };
    case 'program':
      return {
        name: work.row.name,
        summary: work.row.summary,
        description: work.row.description ?? '',
        status: work.row.status,
        health: work.row.health,
        visibility: work.row.visibility,
      };
    case 'milestone':
      return { name: work.row.name, description: work.row.description ?? '' };
  }
}
function contextRefs({ work }: BlueprintSnapshotRow) {
  const team =
    work.kind === 'task' || work.kind === 'project'
      ? work.row.teamId
      : work.kind === 'initiative'
        ? work.row.leadTeamId
        : null;
  const responsible =
    work.kind === 'task'
      ? work.row.assigneeId
      : work.kind === 'project'
        ? work.row.leadId
        : work.kind === 'milestone'
          ? null
          : work.row.ownerId;
  return {
    teamId: team === null ? null : TeamId.parse(team),
    responsibleActorId: responsible === null ? null : ActorId.parse(responsible),
    cycleId:
      work.kind === 'task' && work.row.cycleId !== null ? CycleId.parse(work.row.cycleId) : null,
  };
}
function dates({ work }: BlueprintSnapshotRow): Partial<Record<BlueprintDateField, string | null>> {
  switch (work.kind) {
    case 'task':
      return {
        startDate: snapshotCivilDate(work.row.startDate),
        dueDate: snapshotCivilDate(work.row.dueDate),
      };
    case 'project':
      return {
        startDate: snapshotCivilDate(work.row.startDate),
        targetDate: snapshotCivilDate(work.row.targetDate),
      };
    case 'initiative':
    case 'milestone':
      return { targetDate: snapshotCivilDate(work.row.targetDate) };
    case 'program':
      return {};
  }
}
function lifecycle(
  entry: BlueprintSnapshotRow,
  categories: ReadonlyMap<string, string>,
): ExistingBlueprintNode['state'] {
  const { work } = entry;
  if (work.kind === 'milestone') return 'unstarted';
  if (work.kind === 'task') {
    if (work.row.completedAt) return 'completed';
    if (work.row.canceledAt) return 'canceled';
  }
  const category = categories.get(work.row.statusId);
  if (category === 'completed' || category === 'canceled') return category;
  return category === 'started' ? 'started' : 'unstarted';
}
function identityFields(work: BlueprintSnapshotRow['work']) {
  if (work.kind === 'milestone') return { workTypeId: null, workTypeVersionId: null };
  return {
    workTypeId: work.row.workTypeId ? WorkTypeId.parse(work.row.workTypeId) : null,
    workTypeVersionId: work.row.workTypeVersionId
      ? WorkTypeVersionId.parse(work.row.workTypeVersionId)
      : null,
  };
}
/** Project database rows into pure facts without changing authored body, accepted bindings or origin. */
export function mapBlueprintNodes(
  rows: readonly BlueprintSnapshotRow[],
  categories: ReadonlyMap<string, string>,
  sourceTypes: ReadonlyMap<string, string>,
): ExistingBlueprintNode[] {
  const paths = new Map<string, readonly string[]>();
  return rows.map((entry) => {
    const { work, parent } = entry;
    const parentPath = parent ? (paths.get(`${parent.kind}:${parent.id}`) ?? null) : null;
    // Synthetic capture coordinates are unique physical IDs; immutable creation paths stay in rowsByRef.
    const path = parent ? [...(parentPath ?? []), `w_${work.id.toLowerCase()}`] : [];
    paths.set(`${work.kind}:${work.id}`, path);
    const sourceType = work.row.blueprintSourceVersionId
      ? sourceTypes.get(work.row.blueprintSourceVersionId)
      : undefined;
    return {
      id: work.id,
      kind: work.kind,
      parentId: parent?.id ?? null,
      parentPath,
      path,
      sourceWorkTypeId: sourceType ? WorkTypeId.parse(sourceType) : null,
      sourceStepId: work.row.blueprintStepId
        ? BlueprintStepId.parse(work.row.blueprintStepId)
        : null,
      ...identityFields(work),
      fields: fields(entry),
      dates: dates(entry),
      dateBindings: work.row.blueprintDateBindings,
      ...contextRefs(entry),
      state: lifecycle(entry, categories),
      everStarted: work.row.blueprintEverStarted,
      cancellable: work.kind === 'task',
    };
  });
}
