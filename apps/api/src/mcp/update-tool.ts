/**
 * `@docket/api` — the scope-shaped `update` tool.
 *
 * @remarks
 * "Reassign Sarah's open work to me" and "everything in the migration project is low priority" are
 * one sentence each, and neither names an id. The old surface answered them with seven per-field
 * tools that each took a single ULID, so the agent had to search, page, and then issue one call per
 * row — which is why it never got them right.
 *
 * So this tool takes a **scope** and a **patch**, not an id and a value. The scope is the exact
 * filter set {@link listWork} already understands, which is what lets selection and reading stay in
 * one vocabulary: whatever `list_work` showed you, `update` can act on by pasting the same filters.
 *
 * Two properties matter more than breadth here:
 *
 * - **Nothing is silently skipped.** A row the caller cannot write is reported with a reason, not
 *   dropped. Bulk writes routinely half-succeed, and the half that did not is the part prose
 *   buries.
 * - **Nothing is unbounded.** A scope that matches more than {@link MAX_TARGETS} refuses and says
 *   how many it found, and a scope with no narrowing filter at all refuses outright — a patch that
 *   quietly rewrote every task in an organization is not a recoverable mistake, even with undo.
 */
import { db, initiative, organization, program, project, task } from '@docket/db';
import { InitiativePriority } from '@docket/work/initiative-contract';
import { Priority } from '@docket/work/task-contract';
import { and, eq, inArray } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { z } from 'zod';

import { ApiError, ValidationError } from '../error';
import { preserveTaskTerminalInstants } from '../lib/task-terminal-instants';
import { clearableMarkdownPatch } from '../lib/clearable-text';
import { assertPlanningDateRange, planningDatePatch } from '../lib/planning-timeframe';
import { resolveContainerStatus, resolveTaskStatus } from '../lib/work-status';
import { buildTaskViewFilter } from '../routes/task-helpers';
import type { McpContext } from './auth';
import type { McpRegistrar } from './catalog';
import { titleOf } from './update-display';
import { executeUpdateBatch, type UpdateRowPatch } from './update-batch';
import type { RowContext } from './update-row-contract';
import type { ChangeRecord, Tx } from './change-set';
import { labelsFitRow, resolveLabelEdit } from './update-labels';
import { cycleFitsRow } from './update-relations';
import { referencePatch, resolveReferences, resolveRelations } from './update-refs';
import { isTaskRowVisible, listWork, listWorkFilters, type WorkEntity } from './list-work';
import { updateReportResult } from './apps/change-render';
import { authorize, runTool, scopedActor } from './result';
import { entityListHref } from './entity-href';
import { taskMilestoneDecisions } from './task-milestone';
import { updateSetFields, updateToolDefinition } from './update-tool-contract';

export { updateSetFields } from './update-tool-contract';

/**
 * The most rows one call will touch.
 *
 * @remarks
 * Chosen as a bulk-edit ceiling a person would recognize, not a paging limit: past roughly this
 * many, "update everything matching X" stops being a request someone can verify from a report card
 * and becomes a migration, which belongs in the app with a preview in front of it.
 */
const MAX_TARGETS = 100;

/** The table each updatable entity lives in. */
const TABLES = { task, project, program, initiative } as const;

/** One settable field's name. */
type SetName = keyof typeof updateSetFields;

/** The patch a caller supplied, before resolution. */
type UpdateSet = z.infer<z.ZodObject<typeof updateSetFields>>;

/**
 * Which fields each entity actually has.
 *
 * @remarks
 * Keyed by {@link SetName} so a field added to {@link updateSetFields} without deciding which
 * entities honor it is a compile error rather than an argument that quietly does nothing.
 */
const SETTABLE: Record<WorkEntity, readonly SetName[]> = {
  task: [
    'title',
    'description',
    'state',
    'priority',
    'assignee',
    'delegate',
    'project',
    'milestone',
    'cycle',
    'program',
    'team',
    'dueDate',
    'labels',
  ],
  project: [
    'title',
    'description',
    'status',
    'health',
    'lead',
    'program',
    'team',
    'startDate',
    'startDateResolution',
    'targetDate',
    'targetDateResolution',
    'labels',
    'initiatives',
  ],
  program: ['title', 'description', 'status', 'health', 'owner', 'labels', 'initiatives'],
  initiative: [
    'title',
    'description',
    'status',
    'health',
    'priority',
    'owner',
    'targetDate',
    'targetDateResolution',
    'labels',
  ],
};

/**
 * Raise a field error carrying the legal alternatives.
 *
 * @param field - The offending parameter.
 * @param value - What the caller supplied.
 * @param message - What went wrong.
 * @param options - What they could have said instead.
 * @returns never; always throws.
 */
function reject(field: string, value: string, message: string, options: readonly string[]): never {
  throw new ValidationError(
    new z.ZodError([
      { code: 'invalid_value', path: [field], message, values: [...options], input: value },
    ]),
  );
}

/** Reject every supplied field the entity has no column for, so nothing is silently dropped. */
function assertSettable(entity: WorkEntity, set: UpdateSet): void {
  const allowed = new Set<SetName>(SETTABLE[entity]);
  for (const field of Object.keys(updateSetFields) as SetName[]) {
    if (set[field] === undefined) continue;
    if (!allowed.has(field)) {
      reject(`set.${field}`, field, `${entity} has no "${field}" field.`, SETTABLE[entity]);
    }
  }
}

/**
 * Validate `priority` against the enum that belongs to this entity.
 *
 * @remarks
 * Statuses are workspace-defined and are resolved through {@link resolveContainerStatus} instead
 * of a fixed enum. Priority remains fixed by entity and can be validated synchronously here.
 */
function assertEnums(entity: WorkEntity, set: UpdateSet): void {
  if (set.priority !== undefined) {
    const schema = entity === 'initiative' ? InitiativePriority : Priority;
    if (!schema.safeParse(set.priority).success) {
      reject('set.priority', set.priority, `Not a ${entity} priority.`, schema.options);
    }
  }
}

/** The filters that actually narrow a scope — `archived` only switches which pool is read. */
const NARROWING = (Object.keys(listWorkFilters) as (keyof typeof listWorkFilters)[]).filter(
  (name) => name !== 'archived',
);

/** Turn a `YYYY-MM-DD` (or an explicit null) into what Drizzle wants. */
function datePatch(key: string, value: string | null | undefined): Record<string, Date | null> {
  if (value === undefined) return {};
  return { [key]: value === null ? null : new Date(value) };
}

/**
 * Build the column patch for one row.
 *
 * @remarks
 * Per-row rather than once, because `state` resolves against the row's own team: a scope spanning
 * two teams that both call something "In Review" must write each team's own key.
 *
 * @param rc - The resolved caller, scope and ordinary patch.
 * @param row - The row as it stands.
 * @param database - The transaction that owns these edits.
 * @returns the Drizzle `.set()` object.
 */
async function buildPatch(
  rc: RowContext,
  row: Record<string, unknown>,
  database: Tx,
): Promise<Record<string, unknown>> {
  const { entity, orgId, set, refs, fiscalYearStartMonth, containerStatus } = rc;
  const patch: Record<string, unknown> = {
    // `title` is the caller's word for it; the column is `name` on everything but a task.
    ...(set.title !== undefined ? { [entity === 'task' ? 'title' : 'name']: set.title } : {}),
    ...clearableMarkdownPatch('description', set.description),
    // Resolved once by the caller, before the scope query, so a status this workspace does not
    // have is refused even when the scope matches nothing.
    ...(containerStatus === undefined
      ? {}
      : { status: containerStatus.status, statusId: containerStatus.statusId }),
    ...(set.priority !== undefined ? { priority: set.priority } : {}),
    ...(set.health !== undefined ? { health: set.health } : {}),
    ...referencePatch(refs),
    ...datePatch('dueDate', set.dueDate),
  };
  if (entity === 'project') {
    const start = planningDatePatch(
      { date: set.startDate, resolution: set.startDateResolution },
      fiscalYearStartMonth,
      'start',
      'set.startDate',
      'set.startDateResolution',
    );
    const target = planningDatePatch(
      { date: set.targetDate, resolution: set.targetDateResolution },
      fiscalYearStartMonth,
      'target',
      'set.targetDate',
      'set.targetDateResolution',
    );
    assertPlanningDateRange(
      start === undefined ? (row['startDate'] as Date | null) : start.date,
      target === undefined ? (row['targetDate'] as Date | null) : target.date,
    );
    if (start !== undefined) {
      patch['startDate'] = start.date;
      patch['startDateResolution'] = start.resolution;
      patch['startDateFiscalYearStartMonth'] = start.fiscalYearStartMonth;
    }
    if (target !== undefined) {
      patch['targetDate'] = target.date;
      patch['targetDateResolution'] = target.resolution;
      patch['targetDateFiscalYearStartMonth'] = target.fiscalYearStartMonth;
    }
  } else if (entity === 'initiative') {
    const target = planningDatePatch(
      { date: set.targetDate, resolution: set.targetDateResolution },
      fiscalYearStartMonth,
      'target',
      'set.targetDate',
      'set.targetDateResolution',
    );
    if (target !== undefined) {
      patch['targetDate'] = target.date;
      patch['targetDateResolution'] = target.resolution;
      patch['targetDateFiscalYearStartMonth'] = target.fiscalYearStartMonth;
    }
  }
  if (set.state !== undefined) {
    const transition = preserveTaskTerminalInstants(
      row,
      await resolveTaskStatus(orgId, String(row['teamId']), set.state, 'state', database),
    );
    // The key and the status it names move together; the composite foreign key refuses a row
    // where they disagree.
    patch['statusId'] = transition.statusId;
    patch['state'] = transition.state;
    patch['completedAt'] = transition.completedAt;
    patch['canceledAt'] = transition.canceledAt;
  }
  return patch;
}

/**
 * Whether the caller may write this row.
 *
 * @remarks
 * Changing who is accountable is an `assign`-level act, exactly as the tasks router gates it;
 * everything else on this tool is `contribute`. A denial is data, not a failure: the caller asked
 * about a set, and the answer is that part of it was theirs to change and part was not.
 */
async function permitted(rc: RowContext, id: string, database: Tx): Promise<boolean> {
  const target = { kind: rc.entity, id, orgId: rc.orgId };
  const needsAssign =
    rc.entity === 'task' && (rc.set.assignee !== undefined || rc.set.delegate !== undefined);
  try {
    await authorize(rc.actorCtx, 'contribute', target, database);
    if (needsAssign) await authorize(rc.actorCtx, 'assign', target, database);
    return true;
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    return false;
  }
}

/** The team a row belongs to once this call's `team` change, if any, has landed. */
function teamAfter(rc: RowContext, row: Record<string, unknown>): string | null {
  const team = rc.refs.teamId ?? row['teamId'];
  return typeof team === 'string' ? team : null;
}

/**
 * Why a row must be left alone before anything is written, or null when it may be written.
 *
 * @remarks
 * Every check runs before any write, so a row that cannot take part of the patch is skipped whole
 * rather than half-updated.
 */
async function skipReason(
  rc: RowContext,
  row: Record<string, unknown>,
  database: Tx,
): Promise<string | null> {
  if (!(await permitted(rc, String(row['id']), database))) return 'not_permitted';
  const team = teamAfter(rc, row);
  if (rc.labelEdit && !labelsFitRow(rc.labelEdit, team)) return 'label_out_of_scope';
  if (!cycleFitsRow(rc.cycle, team)) return 'cycle_out_of_team';
  return null;
}

/** Prepare one permitted ordinary patch before any bulk write. */
async function prepareUpdateRow(
  rc: RowContext,
  row: Record<string, unknown>,
  database: Tx,
): Promise<UpdateRowPatch> {
  const id = String(row['id']);
  const title = titleOf(row, id);
  const reason = await skipReason(rc, row, database);
  if (reason !== null) return { skipped: { id, title, reason } };
  const milestonePatch = rc.milestoneFor(id);
  if (typeof milestonePatch === 'string') return { skipped: { id, title, reason: milestonePatch } };
  return {
    patch: {
      ...(await buildPatch(rc, row, database)),
      ...milestonePatch,
    },
  };
}

/** Register `update` on `server`. */
export function registerUpdateTool(server: McpRegistrar, ctx: McpContext): void {
  server.registerTool('update', updateToolDefinition, (input) =>
    runTool(async () => {
      const actorCtx = await scopedActor(ctx, input.orgId, 'work:write');
      await authorize(actorCtx, 'view', {
        kind: 'organization',
        id: input.orgId,
        orgId: input.orgId,
      });

      const entity = input.entity;
      const set = input.set;
      assertSettable(entity, set);
      assertEnums(entity, set);
      // Resolve this before selecting rows so an unknown workspace status is invalid even when
      // the requested scope happens to match nothing.
      const containerStatus =
        set.status !== undefined && entity !== 'task'
          ? await resolveContainerStatus(input.orgId, entity, set.status, 'set.status')
          : undefined;
      if (Object.keys(set).length === 0) {
        reject('set', '', 'Nothing to change — name at least one field.', SETTABLE[entity]);
      }

      const { ids, ...filters } = input.scope;
      const hasNarrowing = NARROWING.some((name) => filters[name] !== undefined);
      if ((ids === undefined || ids.length === 0) && !hasNarrowing) {
        // Undo makes a mistake recoverable, not free: an unbounded patch would still notify
        // every watcher and stamp every row's `updatedAt` before anyone noticed.
        reject(
          'scope',
          '',
          `An unscoped update would match every ${entity} in the workspace. Name at least one filter, or pass scope.ids.`,
          NARROWING,
        );
      }

      // Selection reuses list_work verbatim, so "what update touches" and "what list_work
      // showed" can never drift apart. One over the ceiling is enough to know it was exceeded.
      const selected =
        ids !== undefined && ids.length > 0
          ? ids
          : (
              await listWork(input.orgId, actorCtx.actorId, entity, filters, MAX_TARGETS, undefined)
            ).map((row) => row.id);
      if (selected.length > MAX_TARGETS) {
        reject(
          'scope',
          '',
          `That scope matches more than ${MAX_TARGETS} ${entity}s. Narrow it — a change this size belongs in the app, where it can be previewed.`,
          NARROWING,
        );
      }

      const table = TABLES[entity] as PgTable & {
        id: typeof task.id;
        organizationId: typeof task.organizationId;
      };
      const rows: Record<string, unknown>[] =
        selected.length === 0
          ? []
          : await db
              .select()
              .from(table)
              .where(and(inArray(table.id, selected), eq(table.organizationId, input.orgId)));
      const canViewTask =
        entity === 'task' ? await buildTaskViewFilter(input.orgId, actorCtx.actorId) : undefined;
      const visibleRows = canViewTask
        ? rows.filter((row) => isTaskRowVisible(row, canViewTask))
        : rows;

      const relations = await resolveRelations(actorCtx, input.orgId, set);
      const [refs, [workspaceSettings], labelEdit] = await Promise.all([
        resolveReferences(input.orgId, set, relations.cycle),
        db
          .select({ fiscalYearStartMonth: organization.fiscalYearStartMonth })
          .from(organization)
          .where(eq(organization.id, input.orgId))
          .limit(1),
        resolveLabelEdit(input.orgId, set.labels),
      ]);
      /* v8 ignore next -- @preserve scopedActor proved the workspace exists */
      if (!workspaceSettings) throw new Error('workspace settings missing');
      const rowContext: RowContext = {
        actorCtx,
        entity,
        orgId: input.orgId,
        set,
        refs,
        fiscalYearStartMonth: workspaceSettings.fiscalYearStartMonth,
        containerStatus,
        labelEdit,
        cycle: relations.cycle,
        initiativeEdit: relations.initiatives,
        milestoneFor: await taskMilestoneDecisions(input.orgId, set, refs, visibleRows),
      };
      const { changes, report, skipped, changeSetId } = await executeUpdateBatch(
        rowContext,
        visibleRows,
        prepareUpdateRow,
      );
      const changedRows = report.filter((row) => row.fields.length > 0);

      return updateReportResult(
        input.orgId,
        {
          matched: visibleRows.length,
          listHref: entityListHref(input.orgId, entity),
          changed: changedRows.length,
          entity,
          changes: report,
          skipped,
          changeSetId,
        },
        // The rows' own before and after; label sets are recorded separately and read from the report.
        changes.filter((change): change is ChangeRecord => change.kind === entity),
      );
    }),
  );
}
