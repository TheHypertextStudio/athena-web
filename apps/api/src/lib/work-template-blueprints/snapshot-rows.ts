import {
  initiative,
  initiativeProgram,
  initiativeProject,
  milestone,
  program,
  project,
  task,
} from '@docket/db';
import { BlueprintError } from '@docket/work/blueprints';
import { and, eq, inArray, isNull, isNotNull, or, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { NotFoundError } from '../../error';
import type { TemplateTransaction } from '../templates/persistence';
import type { BlueprintSnapshotRow, BlueprintStoredWork, BlueprintWorkRef } from './snapshot-types';

/** Trusted query selection for reflow; no public caller can raise the physical read bound. */
export interface BlueprintRowSelection {
  readonly include?: (entry: BlueprintSnapshotRow) => boolean;
  readonly ids?: ReadonlySet<string>;
  readonly anchors?: ReadonlySet<string>;
  readonly affected?: boolean;
}
function partialPredicate(
  table: {
    id: AnyPgColumn;
    organizationId: AnyPgColumn;
    blueprintStepId: AnyPgColumn;
    blueprintState: AnyPgColumn;
    blueprintDateBindings: AnyPgColumn;
  },
  selection: BlueprintRowSelection,
  full: boolean,
  kind: BlueprintWorkRef['kind'],
): SQL | undefined {
  if (!selection.affected || full) return undefined;
  return or(
    inArray(table.id, [...(selection.ids ?? [])]),
    isNotNull(table.blueprintStepId),
    isNotNull(table.blueprintState),
    sql`${table.blueprintDateBindings} <> '{}'::jsonb`,
    sql`exists(select 1 from work_template_retained_date_ownership d where d.organization_id=${table.organizationId} and d.work_kind=${kind} and d.work_id=${table.id})`,
  );
}
const tables = { initiative, program, project, task, milestone };
/** Read a same-tenant, active exact physical row, optionally under its update lock. */
export async function readBlueprintWork(
  tx: TemplateTransaction,
  orgId: string,
  ref: BlueprintWorkRef,
  lock = false,
): Promise<BlueprintStoredWork> {
  const table = tables[ref.kind];
  const query = tx
    .select()
    .from(table)
    .where(and(eq(table.organizationId, orgId), eq(table.id, ref.id), isNull(table.archivedAt)))
    .limit(1);
  const [row] = await (lock ? query.for('update') : query);
  if (!row) throw new NotFoundError('Work not found');
  // The chosen physical table and its discriminant are correlated by the closed table map.
  return { kind: ref.kind, id: row.id, row } as BlueprintStoredWork;
}
async function taskChildren(
  tx: TemplateTransaction,
  orgId: string,
  parent: BlueprintWorkRef,
  selection: BlueprintRowSelection,
  full: boolean,
): Promise<BlueprintStoredWork[]> {
  let placement: SQL | undefined;
  switch (parent.kind) {
    case 'task':
      placement = eq(task.parentTaskId, parent.id);
      break;
    case 'milestone':
      placement = and(eq(task.milestoneId, parent.id), isNull(task.parentTaskId));
      break;
    case 'project':
      placement = and(
        eq(task.projectId, parent.id),
        isNull(task.milestoneId),
        isNull(task.parentTaskId),
      );
      break;
    case 'program':
      placement = and(
        eq(task.programId, parent.id),
        isNull(task.projectId),
        isNull(task.milestoneId),
        isNull(task.parentTaskId),
      );
      break;
    default:
      return [];
  }
  const rows = await tx
    .select()
    .from(task)
    .where(
      and(
        eq(task.organizationId, orgId),
        isNull(task.archivedAt),
        placement,
        partialPredicate(task, selection, full, 'task'),
      ),
    )
    .limit(selection.affected ? 3002 : 501);
  return rows.map((row) => ({ kind: 'task', id: row.id, row }));
}
async function containerChildren(
  tx: TemplateTransaction,
  orgId: string,
  parent: BlueprintWorkRef,
  selection: BlueprintRowSelection,
  full: boolean,
): Promise<BlueprintStoredWork[]> {
  if (parent.kind === 'project') {
    const rows = await tx
      .select()
      .from(milestone)
      .where(
        and(
          eq(milestone.organizationId, orgId),
          eq(milestone.projectId, parent.id),
          isNull(milestone.archivedAt),
          partialPredicate(milestone, selection, full, 'milestone'),
        ),
      )
      .limit(selection.affected ? 3002 : 501);
    return rows.map((row) => ({ kind: 'milestone', id: row.id, row }));
  }
  if (parent.kind === 'program') {
    const rows = await tx
      .select()
      .from(project)
      .where(
        and(
          eq(project.organizationId, orgId),
          eq(project.programId, parent.id),
          isNull(project.archivedAt),
          partialPredicate(project, selection, full, 'project'),
        ),
      )
      .limit(selection.affected ? 3002 : 501);
    return rows.map((row) => ({ kind: 'project', id: row.id, row }));
  }
  if (parent.kind !== 'initiative') return [];
  const programs = await tx
    .select({ row: program })
    .from(initiativeProgram)
    .innerJoin(
      program,
      and(eq(program.id, initiativeProgram.programId), eq(program.organizationId, orgId)),
    )
    .where(
      and(
        eq(initiativeProgram.organizationId, orgId),
        eq(initiativeProgram.initiativeId, parent.id),
        isNull(program.archivedAt),
        partialPredicate(program, selection, full, 'program'),
      ),
    )
    .limit(selection.affected ? 3002 : 501);
  const projects = await tx
    .select({ row: project })
    .from(initiativeProject)
    .innerJoin(
      project,
      and(eq(project.id, initiativeProject.projectId), eq(project.organizationId, orgId)),
    )
    .where(
      and(
        eq(initiativeProject.organizationId, orgId),
        eq(initiativeProject.initiativeId, parent.id),
        isNull(project.archivedAt),
        partialPredicate(project, selection, full, 'project'),
      ),
    )
    .limit(selection.affected ? 3002 : 501);
  const programIds = new Set(programs.map(({ row }) => row.id));
  return [
    ...programs.map(({ row }): BlueprintStoredWork => ({ kind: 'program', id: row.id, row })),
    ...projects
      .filter(({ row }) => !row.programId || !programIds.has(row.programId))
      .map(({ row }): BlueprintStoredWork => ({ kind: 'project', id: row.id, row })),
  ];
}
interface DiscoveryState {
  readonly rows: BlueprintSnapshotRow[];
  readonly seen: Set<string>;
  readonly fullSubtrees: Set<string>;
  readonly selection: BlueprintRowSelection;
}
function appendDiscoveredWork(
  state: DiscoveryState,
  parent: BlueprintStoredWork,
  work: BlueprintStoredWork,
): void {
  const candidate = { work, parent: { kind: parent.kind, id: parent.id } };
  if (state.selection.include && !state.selection.include(candidate)) return;
  const key = `${work.kind}:${work.id}`;
  if (state.seen.has(key))
    throw new BlueprintError('blueprint_loop', 'Existing work containment is ambiguous.');
  state.seen.add(key);
  if (state.fullSubtrees.has(parent.id)) state.fullSubtrees.add(work.id);
  state.rows.push(candidate);
  if (state.rows.length > (state.selection.affected ? 3001 : 500))
    throw new BlueprintError('blueprint_limit', 'Existing work exceeds the bounded snapshot read.');
}
/** Discover actual containment without consulting immutable creation paths or copying hidden prose. */
export async function discoverBlueprintRows(
  tx: TemplateTransaction,
  orgId: string,
  root: BlueprintWorkRef,
  selection: BlueprintRowSelection = {},
): Promise<BlueprintSnapshotRow[]> {
  const first: BlueprintSnapshotRow = {
    work: await readBlueprintWork(tx, orgId, root),
    parent: null,
  };
  const rows: BlueprintSnapshotRow[] = [first];
  if (selection.include && !selection.include(first)) throw new NotFoundError('Work not found');
  const seen = new Set([`${root.kind}:${root.id}`]);
  const fullSubtrees = new Set(selection.anchors ?? []);
  const state = { rows, seen, fullSubtrees, selection };
  for (const entry of rows) {
    const parent = entry.work;
    const full = fullSubtrees.has(parent.id);
    const children = [
      ...(await containerChildren(tx, orgId, parent, selection, full)),
      ...(await taskChildren(tx, orgId, parent, selection, full)),
    ];
    for (const work of children) appendDiscoveredWork(state, parent, work);
  }
  return rows;
}
