import { initiative, program, project, task, milestone } from '@docket/db';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { satisfies } from '@docket/authz';
import { CapabilityError, NotFoundError, ValidationError } from '../../error';
import {
  resolveResourceAccessForActors,
  resourceAccessKey,
  type ResourceAccessRef,
} from '../../permissions/resource-access';
import { requirePlacementForest } from './forest-state';
import type { TemplateTransaction } from '../templates/persistence';
import { rawResultRows } from '../raw-result';
import type { Kind, PlaceInput, Placement } from './place';
import type { ForestMatch, PreparedPlacementForest } from './forest-types';

const tables = { initiative, program, project, task, milestone } as const;

/** Normalize prospective names with the same database lowercase operation used by live matching. */
export async function normalizedForestName(
  tx: TemplateTransaction,
  forest: PreparedPlacementForest,
  title: string,
): Promise<string> {
  const cached = forest.normalizedNames.get(title);
  if (cached !== undefined) return cached;
  const result = await tx.execute(sql`SELECT lower(${title}) AS name`);
  const name = rawResultRows<{ name: string }>(result)[0]?.name;
  if (name === undefined) throw new Error('Name normalization returned no value');
  forest.normalizedNames.set(title, name);
  return name;
}

/** Keep Task parent/Project/Program precedence and container matching identical for prospective rows. */
export function forestMatchKey(kind: Kind, normalizedTitle: string, at: Placement): string {
  let scope: readonly (string | null)[] = [];
  if (kind === 'project') scope = ['program', at.programId];
  if (kind === 'milestone') scope = ['project', at.projectId];
  if (kind === 'task') scope = taskScopeKey(at);
  return JSON.stringify([kind, scope, normalizedTitle]);
}
function taskScopeKey(at: Placement): readonly (string | null)[] {
  if (at.parentTaskId) return ['task', at.parentTaskId];
  if (at.projectId) return ['project', at.projectId];
  if (at.programId) return ['program', at.programId];
  return [];
}
function existingScope(kind: Kind, at: Placement) {
  if (kind === 'project')
    return at.programId ? eq(project.programId, at.programId) : isNull(project.programId);
  if (kind === 'milestone') {
    if (!at.projectId)
      throw new ValidationError([{ path: ['parent'], message: 'A checkpoint needs a Project.' }]);
    return eq(milestone.projectId, at.projectId);
  }
  if (kind !== 'task') return undefined;
  if (at.parentTaskId) return eq(task.parentTaskId, at.parentTaskId);
  if (at.projectId) return eq(task.projectId, at.projectId);
  if (at.programId) return eq(task.programId, at.programId);
  return and(isNull(task.projectId), isNull(task.programId), isNull(task.parentTaskId));
}

function matchingColumns(kind: Kind) {
  const table = tables[kind];
  const common = {
    id: table.id,
    title: kind === 'task' ? task.title : tables[kind].name,
    projectId: sql<string | null>`null`,
    programId: sql<string | null>`null`,
    parentTaskId: sql<string | null>`null`,
    milestoneId: sql<string | null>`null`,
    visibility: sql<'public' | 'private'>`'public'`,
  };
  switch (kind) {
    case 'task':
      return {
        ...common,
        projectId: task.projectId,
        programId: task.programId,
        parentTaskId: task.parentTaskId,
        milestoneId: task.milestoneId,
        visibility: task.visibility,
      };
    case 'project':
      return { ...common, programId: project.programId, visibility: project.visibility };
    case 'program':
      return { ...common, visibility: program.visibility };
    case 'milestone':
      return { ...common, projectId: milestone.projectId };
    case 'initiative':
      return common;
  }
}

/** Read a live name match without inserting work or attaching it to anything. */
export async function readExistingForestMatch(
  tx: TemplateTransaction,
  input: PlaceInput,
): Promise<ForestMatch | undefined> {
  const kind = input.item.kind;
  const table = tables[kind];
  const columns = matchingColumns(kind);
  const [row] = await tx
    .select(columns)
    .from(table)
    .where(
      and(
        eq(table.organizationId, input.orgId),
        kind === 'milestone' ? undefined : isNull(table.archivedAt),
        sql`lower(${columns.title}) = lower(${input.item.title})`,
        existingScope(kind, input.at),
      ),
    )
    .limit(1);
  return row
    ? {
        id: row.id,
        kind,
        title: row.title,
        visibility: row.visibility,
        existing: true,
        placement: {
          projectId: row.projectId,
          programId: row.programId,
          parentTaskId: row.parentTaskId,
          milestoneId: row.milestoneId,
          initiativeId: null,
        },
      }
    : undefined;
}

/** Require live access on a matched row before returning its identity or staging an attachment. */
export async function authorizeForestMatch(
  tx: TemplateTransaction,
  forest: PreparedPlacementForest,
  input: PlaceInput,
  match: ForestMatch,
  required?: 'view' | 'contribute',
): Promise<void> {
  if (!match.existing) return;
  const ref = matchedResource(input.orgId, match);
  await requireForestReference(tx, forest, ref, required ?? matchedCapability(input, match));
}

/** Check every live graph association while accepting only exact transaction-proven prospective IDs. */
export async function requireForestReference(
  tx: TemplateTransaction,
  forest: PreparedPlacementForest,
  ref: ResourceAccessRef,
  capability: 'view' | 'contribute',
): Promise<void> {
  requirePlacementForest(tx, forest);
  if (ref.organizationId !== forest.caller.orgId) throw new NotFoundError('Work not found');
  const prospective = forest.prospective.get(ref.id);
  if (prospective) {
    if (prospective.kind !== ref.kind) throw new NotFoundError('Work not found');
    return;
  }
  const decisions = await resolveResourceAccessForActors([forest.access], [ref], tx);
  const decision = decisions.get(resourceAccessKey(ref));
  if (!decision?.canView || !decision.effectiveCapability)
    throw new NotFoundError('Work not found');
  if (!satisfies(decision.effectiveCapability, capability)) throw new CapabilityError();
}

function matchedResource(orgId: string, match: ForestMatch) {
  return match.kind === 'milestone'
    ? { organizationId: orgId, kind: 'project', id: match.placement.projectId ?? '' }
    : { organizationId: orgId, kind: match.kind, id: match.id };
}
function matchedCapability(input: PlaceInput, match: ForestMatch): 'view' | 'contribute' {
  const attachment =
    match.kind === 'task' &&
    input.at.milestoneId !== null &&
    match.placement.milestoneId !== input.at.milestoneId;
  const link =
    (match.kind === 'project' || match.kind === 'program') && input.at.initiativeId !== null;
  return attachment || link ? 'contribute' : 'view';
}
