import { ActorId, TeamId } from '@docket/identity-access/ids';
import { CycleId } from '@docket/work/ids';
import { BlueprintError } from '@docket/work/blueprints';
import type {
  BlueprintFieldsByKind,
  BlueprintPlacement,
  ResolvedBlueprintFieldsByKind,
  ResolvedRootDraft,
  WorkKind,
} from '@docket/work/blueprints';
import { CanonicalTemplateDraft } from '@docket/work/template-contract';
import type { PreparedOrdinaryWork } from '../work-creation/types';

const FIELDS: Readonly<Record<WorkKind, readonly string[]>> = {
  task: ['title', 'summary', 'description', 'priority', 'state', 'estimate', 'estimateMinutes'],
  project: ['name', 'summary', 'description', 'status', 'health', 'priority'],
  initiative: ['name', 'summary', 'description', 'status', 'health', 'priority', 'updateCadence'],
  program: ['name', 'summary', 'description', 'status', 'health', 'visibility'],
};

function reference(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string')
    throw new BlueprintError(
      'blueprint_invalid',
      'Prepared work contains an unresolved reference.',
    );
  return value;
}

function civilDate(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  // Ordinary Task date-only values use midnight UTC solely as the timestamp storage coordinate.
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'string') return value;
  throw new BlueprintError('blueprint_invalid', 'Prepared work contains an unresolved date.');
}

function placement(values: Readonly<Record<string, unknown>>): BlueprintPlacement {
  return {
    programId: reference(values['programId']),
    projectId: reference(values['projectId']),
    milestoneId: reference(values['milestoneId']),
    parentTaskId: reference(values['parentTaskId']),
  };
}

const CONTEXT_FIELDS = {
  task: { team: 'teamId', actor: 'assigneeId', dates: ['startDate', 'dueDate'] },
  project: { team: 'teamId', actor: 'leadId', dates: ['startDate', 'targetDate'] },
  initiative: { team: 'leadTeamId', actor: 'ownerId', dates: ['targetDate'] },
  program: { team: null, actor: 'ownerId', dates: [] },
} as const;

function rootContext(kind: WorkKind, values: Readonly<Record<string, unknown>>) {
  const keys = CONTEXT_FIELDS[kind];
  const team = keys.team ? reference(values[keys.team]) : null;
  const actor = reference(values[keys.actor]);
  const cycle = kind === 'task' ? reference(values['cycleId']) : null;
  return {
    teamId: team === null ? null : TeamId.parse(team),
    responsibleActorId: actor === null ? null : ActorId.parse(actor),
    cycleId: cycle === null ? null : CycleId.parse(cycle),
    dates: Object.fromEntries(keys.dates.map((key) => [key, civilDate(values[key])])),
    placement: placement(values),
    documentPrepared: true,
    terminal: kind === 'task' && (values['completedAt'] != null || values['canceledAt'] != null),
  };
}

function resolvedFields<K extends WorkKind>(
  kind: K,
  fields: BlueprintFieldsByKind[K],
  values: Readonly<Record<string, unknown>>,
): ResolvedBlueprintFieldsByKind[K] {
  // Only ordinary nullable root fields are added to the validated reusable starting shape.
  return {
    ...fields,
    ...(values['summary'] === null ? { summary: null } : {}),
    ...(kind !== 'task' && values['health'] === null ? { health: null } : {}),
  };
}

function preparedRootContext(
  prepared: PreparedOrdinaryWork,
  kind: WorkKind,
  values: Readonly<Record<string, unknown>>,
) {
  const resolvedContext = rootContext(kind, values);
  const initiativeId =
    prepared.command.invocation.placement?.initiativeId ??
    (prepared.initiativeIds.length === 1 ? prepared.initiativeIds[0] : undefined);
  const context = {
    ...resolvedContext,
    placement: { ...resolvedContext.placement, ...(initiativeId ? { initiativeId } : {}) },
  };
  return context;
}

/**
 * Project validated ordinary insert values into the pure planner without reinterpreting dates or prose.
 * @throws {BlueprintError} If an adapter supplies a non-root kind or unresolved database expression.
 */
export function preparedBlueprintRoot(prepared: PreparedOrdinaryWork): ResolvedRootDraft {
  const { kind, values } = prepared.insert;
  if (kind === 'milestone' || kind !== prepared.command.kind)
    throw new BlueprintError(
      'blueprint_invalid',
      'A generation root must match its ordinary work kind.',
    );
  const selected = Object.fromEntries(
    Object.entries(values).filter(
      ([key, value]) =>
        FIELDS[kind].includes(key) &&
        value !== undefined &&
        (value !== null || key === 'estimateMinutes'),
    ),
  );
  if (values.description === null) selected['description'] = '';
  const payload = CanonicalTemplateDraft.parse({
    targetType: kind,
    ...selected,
    ...(kind === 'task' ? { labelIds: prepared.labels.map((label) => label.id) } : {}),
  });
  const context = preparedRootContext(prepared, kind, values);
  switch (payload.targetType) {
    case 'task': {
      const { targetType: _kind, ...fields } = payload;
      return { ...context, kind: 'task', fields: resolvedFields('task', fields, values) };
    }
    case 'project': {
      const { targetType: _kind, ...fields } = payload;
      return { ...context, kind: 'project', fields: resolvedFields('project', fields, values) };
    }
    case 'initiative': {
      const { targetType: _kind, ...fields } = payload;
      return {
        ...context,
        kind: 'initiative',
        fields: resolvedFields('initiative', fields, values),
      };
    }
    case 'program': {
      const { targetType: _kind, ...fields } = payload;
      return { ...context, kind: 'program', fields: resolvedFields('program', fields, values) };
    }
  }
}
