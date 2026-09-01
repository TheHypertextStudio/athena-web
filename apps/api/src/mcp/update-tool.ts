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
import { Health } from '@docket/work/capability-contract';
import { InitiativePriority } from '@docket/work/initiative-contract';
import { DateResolution } from '@docket/work/planning-timeframe';
import { Priority } from '@docket/work/task-contract';
import { and, eq, inArray } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { z } from 'zod';

import { ApiError, ValidationError } from '../error';
import { clearableTextPatch } from '../lib/clearable-text';
import { assertPlanningDateRange, planningDatePatch } from '../lib/planning-timeframe';
import {
  applySubtaskCompletionPolicy,
  finishTaskStateTransition,
  writeTaskStateTransition,
} from '../lib/task-state';
import { resolveContainerStatus } from '../lib/work-status';
import { buildTaskViewFilter } from '../routes/task-helpers';
import { enqueueSearchUpsert } from '../search/write-through';
import type { McpContext } from './auth';
import type { McpRegistrar } from './catalog';
import { recordChangeSet, trackedFields, type ChangeRecord } from './change-set';
import { DESCRIPTOR_HINT, resolveOptional } from './descriptors';
import {
  isTaskRowVisible,
  listWork,
  listWorkFilters,
  WORK_ENTITIES,
  type WorkEntity,
} from './list-work';
import { WIDGET, widgetMeta } from './apps';
import { authorize, jsonResult, runTool, scopedActor } from './result';
import { orgIdParam, resolveStateTransition } from './tools-shared';

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

/**
 * Every field `update` can set, uniform across entities; applicability is checked per call.
 *
 * @remarks
 * Deliberately spoken in the vocabulary a person uses rather than the column names — `title` sets a
 * task's title and a project's `name`, because "rename it" is one idea and an agent should not have
 * to know which table it landed in to express it.
 *
 * A nullable field distinguishes three states a patch genuinely needs: omitted leaves the column
 * alone, `null` clears it, and a value sets it.
 */
export const updateSetFields = {
  title: z.string().min(1).optional().describe('Rename it. Sets a task title or a container name.'),
  description: z
    .string()
    .optional()
    .describe('The full body, as markdown. Pass an empty string to clear it.'),
  state: z
    .string()
    .optional()
    .describe(
      "A task's workflow state, by key or display name — \"in review\" resolves against each task's own team. An unknown value comes back with that team's legal states.",
    ),
  status: z.string().optional().describe('The status of a project, program, or initiative.'),
  priority: z.string().optional().describe('The priority of a task or an initiative.'),
  health: Health.optional().describe(
    'How a project, program, or initiative is tracking. To say why as well, use report_status.',
  ),
  assignee: z
    .string()
    .nullable()
    .optional()
    .describe(`Who becomes accountable for the task, or null to unassign. ${DESCRIPTOR_HINT}`),
  delegate: z
    .string()
    .nullable()
    .optional()
    .describe(`The agent the doing is handed to, or null to take it back. ${DESCRIPTOR_HINT}`),
  lead: z
    .string()
    .nullable()
    .optional()
    .describe(`Who leads the project, or null to clear. ${DESCRIPTOR_HINT}`),
  owner: z
    .string()
    .nullable()
    .optional()
    .describe(`Who owns the program or initiative, or null to clear. ${DESCRIPTOR_HINT}`),
  project: z
    .string()
    .nullable()
    .optional()
    .describe(`The project to file the task under, or null to unfile it. ${DESCRIPTOR_HINT}`),
  program: z
    .string()
    .nullable()
    .optional()
    .describe(`The program it rolls up to, or null to detach. ${DESCRIPTOR_HINT}`),
  team: z.string().optional().describe(`The team that owns it. ${DESCRIPTOR_HINT}`),
  dueDate: z.iso
    .date()
    .nullable()
    .optional()
    .describe('When the task is due, as `YYYY-MM-DD`, or null to clear.'),
  startDate: z.iso
    .date()
    .nullable()
    .optional()
    .describe('The planned start for a project, or null to clear.'),
  startDateResolution: DateResolution.nullable()
    .optional()
    .describe('The broad Project start resolution; send it with startDate.'),
  targetDate: z.iso
    .date()
    .nullable()
    .optional()
    .describe('The target finish for a project or initiative, or null to clear.'),
  targetDateResolution: DateResolution.nullable()
    .optional()
    .describe('The broad target resolution; send it with targetDate.'),
};

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
  ],
  program: ['title', 'description', 'status', 'health', 'owner'],
  initiative: [
    'title',
    'description',
    'status',
    'health',
    'priority',
    'owner',
    'targetDate',
    'targetDateResolution',
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

/** Register `update` on `server`. */
export function registerUpdateTool(
  server: McpRegistrar,
  ctx: McpContext,
  sessionId: string | null,
): void {
  server.registerTool(
    'update',
    {
      title: 'Update work',
      description:
        'Change work by describing which work, not by listing ids. The scope takes the same filters as list_work, so "everything Sarah has open in the migration project" is one call — and so is a single item, via `scope.ids`. Every row you may not write is reported back with a reason rather than skipped quietly, and the whole call is reversible with `undo`.',
      inputSchema: {
        orgId: orgIdParam,
        entity: z.enum(WORK_ENTITIES).describe('What kind of work to update.'),
        scope: z
          .object({
            ids: z
              .array(z.string())
              .optional()
              .describe(
                'Specific items by id, when you already have them — from list_work or find. Names are not accepted here, because a task title is not unique; use the filters to select by name.',
              ),
            ...listWorkFilters,
          })
          .describe(
            'Which work to change. Same filters as list_work, so a query you just listed can be acted on verbatim. At least one narrowing filter (or `ids`) is required.',
          ),
        set: z
          .object(updateSetFields)
          .describe('The fields to change. Anything omitted is left alone.'),
      },
      outputSchema: {
        matched: z.number().int().describe('How many items the scope selected.'),
        changed: z.number().int().describe('How many were actually written.'),
        entity: z
          .enum(WORK_ENTITIES)
          .describe('The kind every row in `changes`/`skipped` is — the call scope, echoed back.'),
        changes: z
          .array(
            z.object({
              id: z.string(),
              title: z.string(),
              fields: z.array(z.object({ field: z.string(), from: z.string(), to: z.string() })),
            }),
          )
          .describe(
            'What moved, per item, as before → after. Empty `fields` means it already matched.',
          ),
        skipped: z
          .array(z.object({ id: z.string(), title: z.string(), reason: z.string() }))
          .describe(
            'Items left alone, and why — `not_permitted` means the caller cannot write that one.',
          ),
        changeSetId: z
          .string()
          .nullable()
          .describe('Pass to `undo` to take the whole call back. Null when nothing changed.'),
      },
      _meta: widgetMeta(WIDGET.changeReport),
      annotations: {
        readOnlyHint: false,
        // It rewrites existing fields in bulk; the caller should see that before approving.
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (input) =>
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
                await listWork(
                  input.orgId,
                  actorCtx.actorId,
                  entity,
                  filters,
                  MAX_TARGETS,
                  undefined,
                )
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
        // Changing who is accountable is an `assign`-level act, exactly as the tasks router
        // gates it; everything else on this tool is `contribute`.
        const needsAssign =
          entity === 'task' && (set.assignee !== undefined || set.delegate !== undefined);

        const changes: ChangeRecord[] = [];
        const report: { id: string; title: string; fields: ReturnType<typeof diff> }[] = [];
        const skipped: { id: string; title: string; reason: string }[] = [];

        for (const row of visibleRows) {
          const id = String(row['id']);
          const title = titleOf(row, id);
          try {
            await authorize(actorCtx, 'contribute', { kind: entity, id, orgId: input.orgId });
            if (needsAssign) {
              await authorize(actorCtx, 'assign', { kind: entity, id, orgId: input.orgId });
            }
          } catch (err) {
            // A per-row denial is data, not a failure: the caller asked about a set, and the
            // answer is that part of it was theirs to change and part was not.
            if (!(err instanceof ApiError)) throw err;
            skipped.push({ id, title, reason: 'not_permitted' });
            continue;
          }

          const patch = await buildPatch(
            entity,
            input.orgId,
            row,
            set,
            refs,
            workspaceSettings.fiscalYearStartMonth,
            containerStatus,
          );
          const before = trackedFields(entity, row);
          let next: Record<string, unknown> | undefined;
          if (entity === 'task' && set.state !== undefined) {
            const { statusId, state, completedAt, canceledAt, ...remainingPatch } = patch;
            const result = await db.transaction(async (tx) => {
              const locked = await tx
                .select()
                .from(task)
                .where(and(eq(task.id, id), eq(task.organizationId, input.orgId)))
                .for('update')
                .limit(1);
              const current = locked[0];
              if (!current) return null;
              const mutation = await writeTaskStateTransition(tx, {
                before: current,
                statusId: String(statusId),
                state: String(state),
                completedAt: completedAt as Date | null,
                canceledAt: canceledAt as Date | null,
              });
              if (!mutation) return null;
              const [after] =
                Object.keys(remainingPatch).length === 0
                  ? [mutation.after]
                  : await tx
                      .update(task)
                      .set(remainingPatch)
                      .where(and(eq(task.id, id), eq(task.organizationId, input.orgId)))
                      .returning();
              if (!after) return null;
              const finalMutation = { before: current, after };
              return {
                after,
                mutation: finalMutation,
                cascades: await applySubtaskCompletionPolicy(tx, finalMutation),
              };
            });
            if (!result) continue;
            await finishTaskStateTransition({ actorId: actorCtx.actorId }, result.mutation);
            for (const cascade of result.cascades) {
              await finishTaskStateTransition({ actorId: null }, cascade);
            }
            next = result.after;
          } else {
            const updated = await db
              .update(table)
              .set(patch)
              .where(and(eq(table.id, id), eq(table.organizationId, input.orgId)))
              .returning();
            next = updated[0];
          }
          /* v8 ignore next -- @preserve defensive: the row was just read in this call */
          if (!next) continue;
          const after = trackedFields(entity, next);

          const fields = diff(before, after);
          report.push({ id, title: titleOf(next, id), fields });
          if (fields.length > 0) {
            changes.push({ kind: entity, id, op: 'update', before, after });
            await enqueueSearchUpsert(input.orgId, entity, id);
          }
        }

        const changeSetId = await recordChangeSet({
          orgId: input.orgId,
          actorId: actorCtx.actorId,
          origin: {
            tool: 'update',
            ...(sessionId ? { sessionId } : {}),
            ...(ctx.principal.kind === 'agent' ? { client: ctx.principal.displayName } : {}),
          },
          summary:
            changes.length === 1 && report[0]
              ? `Updated "${report[0].title}"`
              : `Updated ${changes.length} ${entity}s`,
          changes,
        });

        return jsonResult({
          matched: visibleRows.length,
          changed: changes.length,
          entity,
          changes: report,
          skipped,
          changeSetId,
        });
      }),
  );
}
