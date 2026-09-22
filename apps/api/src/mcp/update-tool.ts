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
import { clearableTextPatch } from '../lib/clearable-text';
import { originFor } from '../lib/provenance/context';
import { assertPlanningDateRange, planningDatePatch } from '../lib/planning-timeframe';
import {
  applySubtaskCompletionPolicy,
  closeCompletingUserTaskTimers,
  emitCompletedTaskTimerStops,
  finishTaskStateTransition,
  writeTaskStateTransition,
} from '../lib/task-state';
import { resolveContainerStatus } from '../lib/work-status';
import { buildTaskViewFilter } from '../routes/task-helpers';
import { enqueueSearchUpsert } from '../search/write-through';
import type { McpContext } from './auth';
import type { McpRegistrar } from './catalog';
import { recordChangeSet, trackedFields, type RecordedChange } from './change-set';
import { resolveOptional } from './descriptors';
import { applyLabelEdit, labelsFitRow, resolveLabelEdit, type LabelEdit } from './update-labels';
import { isTaskRowVisible, listWork, listWorkFilters, type WorkEntity } from './list-work';
import { authorize, jsonResult, runTool, scopedActor } from './result';
import { resolveStateTransition } from './tools-shared';
import { entityHref, entityListHref } from './entity-href';
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
  ],
  program: ['title', 'description', 'status', 'health', 'owner', 'labels'],
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

/**
 * The descriptor-valued fields of a patch, resolved to ids.
 *
 * @remarks
 * Each is `undefined` when the caller did not mention the field, and `null` when they asked to
 * clear it — the same three-state distinction the wire schema makes.
 */
interface ResolvedRefs {
  readonly assignee: string | null | undefined;
  readonly delegate: string | null | undefined;
  readonly lead: string | null | undefined;
  readonly owner: string | null | undefined;
  readonly projectId: string | null | undefined;
  readonly programId: string | null | undefined;
  readonly teamId: string | null | undefined;
}

/**
 * Resolve the descriptor-valued fields of a patch once, for every row.
 *
 * @remarks
 * These are the same for every target, so they resolve before the loop rather than per row —
 * a 100-row reassignment would otherwise pay 100 identical lookups for one name.
 *
 * @param orgId - The organization being updated within.
 * @param set - The caller's patch.
 * @returns the resolved ids.
 */
async function resolveReferences(orgId: string, set: UpdateSet): Promise<ResolvedRefs> {
  const [assignee, delegate, lead, owner, projectId, programId, teamId] = await Promise.all([
    resolveOptional(orgId, 'actor', set.assignee, 'set.assignee'),
    resolveOptional(orgId, 'actor', set.delegate, 'set.delegate'),
    resolveOptional(orgId, 'actor', set.lead, 'set.lead'),
    resolveOptional(orgId, 'actor', set.owner, 'set.owner'),
    resolveOptional(orgId, 'project', set.project, 'set.project'),
    resolveOptional(orgId, 'program', set.program, 'set.program'),
    resolveOptional(orgId, 'team', set.team, 'set.team'),
  ]);
  return { assignee, delegate, lead, owner, projectId, programId, teamId };
}

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
 * @param entity - What is being updated.
 * @param orgId - The organization.
 * @param row - The row as it stands.
 * @param set - The caller's patch.
 * @param refs - The already-resolved descriptor ids.
 * @returns the Drizzle `.set()` object.
 */
async function buildPatch(
  entity: WorkEntity,
  orgId: string,
  row: Record<string, unknown>,
  set: UpdateSet,
  refs: ResolvedRefs,
  fiscalYearStartMonth: number,
  containerStatus?: { statusId: string; status: string },
): Promise<Record<string, unknown>> {
  const patch: Record<string, unknown> = {
    // `title` is the caller's word for it; the column is `name` on everything but a task.
    ...(set.title !== undefined ? { [entity === 'task' ? 'title' : 'name']: set.title } : {}),
    ...clearableTextPatch('description', set.description),
    // Resolved once by the caller, before the scope query, so a status this workspace does not
    // have is refused even when the scope matches nothing.
    ...(containerStatus === undefined
      ? {}
      : { status: containerStatus.status, statusId: containerStatus.statusId }),
    ...(set.priority !== undefined ? { priority: set.priority } : {}),
    ...(set.health !== undefined ? { health: set.health } : {}),
    ...(refs.assignee !== undefined ? { assigneeId: refs.assignee } : {}),
    ...(refs.delegate !== undefined ? { delegateId: refs.delegate } : {}),
    ...(refs.lead !== undefined ? { leadId: refs.lead } : {}),
    ...(refs.owner !== undefined ? { ownerId: refs.owner } : {}),
    ...(refs.projectId !== undefined ? { projectId: refs.projectId } : {}),
    ...(refs.programId !== undefined ? { programId: refs.programId } : {}),
    ...(refs.teamId !== undefined ? { teamId: refs.teamId } : {}),
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
    const transition = await resolveStateTransition(orgId, String(row['teamId']), set.state);
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
 * The longest a single side of a diff line may be.
 *
 * @remarks
 * A diff line says what moved; it is not the payload that moved. Editing a description used to put
 * the entire old text and the entire new text into one row — which broke the report card's layout,
 * and cost the model as much context as re-reading the entity would have. Anything that needs the
 * full value can read the entity, where it is authoritative rather than a snapshot.
 */
const DISPLAY_LIMIT = 200;

/**
 * Shorten one rendered value, marking the cut so nobody reads a truncation as the whole value.
 *
 * @remarks
 * Applied when a diff line is *built*, never when two values are compared. Clamping before the
 * comparison made any edit past this limit invisible: two 900-character descriptions sharing their
 * first 199 characters compared equal, so the field dropped out of the diff, the row never reached
 * `changes`, and the write landed with `changed: 0`, an empty change set (nothing for `undo` to
 * reverse) and no search reindex.
 */
function clamp(text: string): string {
  return text.length > DISPLAY_LIMIT ? text.slice(0, DISPLAY_LIMIT - 1).trimEnd() + '…' : text;
}

/**
 * Render one value for comparison, so a report card reads without a type switch.
 *
 * @remarks
 * Lossless on purpose — this is what decides whether a field moved. {@link displayLine} is the
 * presentation form.
 */
function display(value: unknown): string {
  if (value === null || value === undefined) {
    return 'none';
  }
  if (typeof value === 'string') {
    return value;
  }
  // Dates are the only tracked non-primitive, and only their day matters in a diff line.
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value);
}

/** The same value, shortened for the one place it is shown rather than compared. */
function displayLine(value: unknown): string {
  return clamp(display(value));
}

/**
 * What to call a row in a report line.
 *
 * @remarks
 * Tasks carry `title` and containers carry `name`; the report speaks one word for both, the same
 * way {@link updateSetFields} accepts one word for both.
 *
 * @param row - The row.
 * @param fallback - Used when neither column holds text, so a line never renders blank.
 * @returns the display name.
 */
function titleOf(row: Record<string, unknown>, fallback: string): string {
  const named = row['title'] ?? row['name'];
  return typeof named === 'string' && named.length > 0 ? named : fallback;
}

/** The fields that actually moved, as `from → to` pairs a person can check. */
function diff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): { field: string; from: string; to: string }[] {
  return Object.keys(after)
    .filter((key) => display(before[key]) !== display(after[key]))
    .map((key) => ({ field: key, from: displayLine(before[key]), to: displayLine(after[key]) }));
}

/** Everything a row write needs that is the same for every row in the call. */
interface RowContext {
  readonly actorCtx: Awaited<ReturnType<typeof scopedActor>>;
  readonly entity: WorkEntity;
  readonly orgId: string;
  readonly set: UpdateSet;
  readonly refs: ResolvedRefs;
  readonly fiscalYearStartMonth: number;
  readonly containerStatus: { statusId: string; status: string } | undefined;
  readonly labelEdit: LabelEdit | undefined;
}

/** One written row as the report card shows it. */
interface RowReport {
  readonly id: string;
  readonly title: string;
  readonly href: string;
  readonly fields: ReturnType<typeof diff>;
}

/** One row left alone, and why. */
interface RowSkip {
  readonly id: string;
  readonly title: string;
  readonly reason: string;
}

/** What happened to one row: skipped, written, or null when it vanished mid-call. */
type RowOutcome =
  | { readonly skipped: RowSkip }
  | { readonly report: RowReport; readonly changes: RecordedChange[] }
  | null;

/**
 * Whether the caller may write this row.
 *
 * @remarks
 * Changing who is accountable is an `assign`-level act, exactly as the tasks router gates it;
 * everything else on this tool is `contribute`. A denial is data, not a failure: the caller asked
 * about a set, and the answer is that part of it was theirs to change and part was not.
 */
async function permitted(rc: RowContext, id: string): Promise<boolean> {
  const target = { kind: rc.entity, id, orgId: rc.orgId };
  const needsAssign =
    rc.entity === 'task' && (rc.set.assignee !== undefined || rc.set.delegate !== undefined);
  try {
    await authorize(rc.actorCtx, 'contribute', target);
    if (needsAssign) await authorize(rc.actorCtx, 'assign', target);
    return true;
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    return false;
  }
}

/** Move a task to a new workflow state, with its timers and parent completion, then its fields. */
async function writeTaskState(
  rc: RowContext,
  id: string,
  patch: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const { statusId, state, completedAt, canceledAt, ...remainingPatch } = patch;
  const where = and(eq(task.id, id), eq(task.organizationId, rc.orgId));
  const result = await db.transaction(async (tx) => {
    const [current] = await tx.select().from(task).where(where).for('update').limit(1);
    if (!current) return null;
    const mutation = await writeTaskStateTransition(tx, {
      before: current,
      statusId: String(statusId),
      state: String(state),
      completedAt: completedAt as Date | null,
      canceledAt: canceledAt as Date | null,
    });
    if (!mutation) return null;
    const timerStops = await closeCompletingUserTaskTimers(tx, rc.actorCtx.actorId, mutation);
    const [after] =
      Object.keys(remainingPatch).length === 0
        ? [mutation.after]
        : await tx.update(task).set(remainingPatch).where(where).returning();
    if (!after) return null;
    const finalMutation = { before: current, after };
    const cascades = await applySubtaskCompletionPolicy(tx, finalMutation);
    return { after, mutation: finalMutation, timerStops, cascades };
  });
  if (!result) return null;
  await finishTaskStateTransition({ actorId: rc.actorCtx.actorId }, result.mutation);
  await emitCompletedTaskTimerStops(result.timerStops);
  for (const cascade of result.cascades)
    await finishTaskStateTransition({ actorId: null }, cascade);
  return result.after;
}

/** Write a row's column patch and return the row as it now is. */
async function writeColumns(
  rc: RowContext,
  row: Record<string, unknown>,
  patch: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const id = String(row['id']);
  if (rc.entity === 'task' && rc.set.state !== undefined) return writeTaskState(rc, id, patch);
  // A labels-only call has no columns to write, and Drizzle refuses an empty `set`.
  if (Object.keys(patch).length === 0) return row;
  const table = TABLES[rc.entity] as PgTable & {
    id: typeof task.id;
    organizationId: typeof task.organizationId;
  };
  const [updated] = await db
    .update(table)
    .set(patch)
    .where(and(eq(table.id, id), eq(table.organizationId, rc.orgId)))
    .returning();
  return updated ?? null;
}

/** The team a row belongs to once this call's `team` change, if any, has landed. */
function teamAfter(rc: RowContext, row: Record<string, unknown>): string | null {
  const team = rc.refs.teamId ?? row['teamId'];
  return typeof team === 'string' ? team : null;
}

/**
 * Apply the whole patch to one row: its columns, then its labels.
 *
 * @remarks
 * The label scope check runs before anything is written, so a row whose team cannot take a label
 * is skipped whole rather than half-updated.
 */
async function updateRow(rc: RowContext, row: Record<string, unknown>): Promise<RowOutcome> {
  const id = String(row['id']);
  const title = titleOf(row, id);
  if (!(await permitted(rc, id))) return { skipped: { id, title, reason: 'not_permitted' } };
  if (rc.labelEdit && !labelsFitRow(rc.labelEdit, teamAfter(rc, row))) {
    return { skipped: { id, title, reason: 'label_out_of_scope' } };
  }
  const { entity, orgId } = rc;
  const patch = await buildPatch(
    entity,
    orgId,
    row,
    rc.set,
    rc.refs,
    rc.fiscalYearStartMonth,
    rc.containerStatus,
  );
  const before = trackedFields(entity, row);
  const next = await writeColumns(rc, row, patch);
  /* v8 ignore next -- @preserve defensive: the row was just read in this call */
  if (!next) return null;
  const after = trackedFields(entity, next);
  const fields = diff(before, after);
  const changes: RecordedChange[] =
    fields.length > 0 ? [{ kind: entity, id, op: 'update', before, after }] : [];
  const labels = rc.labelEdit ? await applyLabelEdit(entity, orgId, id, rc.labelEdit) : null;
  if (labels?.field && labels.change) {
    fields.push(labels.field);
    changes.push(labels.change);
  }
  if (changes.length > 0) await enqueueSearchUpsert(orgId, entity, id);
  const href = entityHref(orgId, entity, id);
  return { report: { id, title: titleOf(next, id), href, fields }, changes };
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

      const refs = await resolveReferences(input.orgId, set);
      const [workspaceSettings] = await db
        .select({ fiscalYearStartMonth: organization.fiscalYearStartMonth })
        .from(organization)
        .where(eq(organization.id, input.orgId))
        .limit(1);
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
        labelEdit: await resolveLabelEdit(input.orgId, set.labels),
      };
      const changes: RecordedChange[] = [];
      const report: RowReport[] = [];
      const skipped: RowSkip[] = [];
      for (const row of visibleRows) {
        const outcome = await updateRow(rowContext, row);
        if (outcome === null) continue;
        if ('skipped' in outcome) skipped.push(outcome.skipped);
        else {
          report.push(outcome.report);
          changes.push(...outcome.changes);
        }
      }
      const changedRows = report.filter((row) => row.fields.length > 0);

      const changeSetId = await recordChangeSet({
        orgId: input.orgId,
        actorId: actorCtx.actorId,
        origin: originFor('update'),
        summary:
          changedRows.length === 1 && changedRows[0]
            ? `Updated "${changedRows[0].title}"`
            : `Updated ${changedRows.length} ${entity}s`,
        changes,
      });

      return jsonResult({
        matched: visibleRows.length,
        listHref: entityListHref(input.orgId, entity),
        changed: changedRows.length,
        entity,
        changes: report,
        skipped,
        changeSetId,
      });
    }),
  );
}
