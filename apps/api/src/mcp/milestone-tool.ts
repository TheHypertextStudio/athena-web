/**
 * `@docket/api` — the `milestones` tool: a Project's checkpoints, read and edited in one place.
 *
 * @remarks
 * A milestone is addressed through its Project, the same as on REST (`routes/milestones.ts`), so
 * every action names the Project first and the milestone within it. "Add Beta and GA to the
 * migration project" is one `create` call, "push Beta a week" is one `update`, and `list` returns
 * the whole timeline with each checkpoint's progress so an agent can answer "how close is Beta?"
 * without a second read.
 *
 * Writes go through the same helpers as the REST routes and are recorded as change sets, so every
 * one of them is reversible with `undo` — a delete included, which re-creates the milestone under
 * its old id and puts its Tasks back on it.
 */
import { db, milestone, project } from '@docket/db';
import {
  type MilestoneCreate,
  MilestoneOut,
  type MilestoneProgress,
  type MilestoneUpdate,
} from '@docket/work/milestone-contract';
import { TASK_DATE_MAX, TASK_DATE_MIN } from '@docket/work/task-model';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';

import { PROJECT_CREATE_MILESTONE_LIMIT } from '../contracts/project';
import { originFor } from '../lib/provenance/context';
import { NotFoundError, ValidationError } from '../error';
import {
  appendMilestones,
  deleteMilestone,
  loadMilestone,
  toMilestoneOut,
  updateMilestone,
  type MilestoneRow,
} from '../lib/milestone-writes';
import { visibleMilestoneTaskCounts } from '../routes/task-helpers';
import { enqueueSearchDelete, enqueueSearchUpsert } from '../search/write-through';
import type { McpActor, McpContext } from './auth';
import type { McpRegistrar } from './catalog';
import { recordChangeSet, trackedFields, type RecordedChange } from './change-set';
import { resolveDescriptor, resolveMilestone } from './descriptors';
import { entityHref } from './entity-href';
import { authorize, jsonResult, runTool, scopedActor } from './result';
import { orgIdParam } from './tools-shared';

/** What the tool can do. */
export const MILESTONE_ACTIONS = ['list', 'create', 'update', 'delete'] as const;
/** One action. */
type MilestoneAction = (typeof MILESTONE_ACTIONS)[number];

/** Whether a `YYYY-MM-DD` day falls inside the range the milestone table accepts. */
function inDateRange(day: string): boolean {
  return day >= TASK_DATE_MIN && day <= TASK_DATE_MAX;
}

/**
 * A milestone to create, as the tool takes it.
 *
 * @remarks
 * The same fields as {@link MilestoneCreate} with short descriptions: every tool schema is sent to
 * a local model on every turn, so the REST contract's long field prose would cost each turn.
 */
const MilestoneCreateInput = z.object({
  name: z.string().regex(/\S/, 'A milestone needs a name.'),
  description: z.string().optional(),
  targetDate: z.iso
    .date()
    .refine(inDateRange, `Pick a date from ${TASK_DATE_MIN} to ${TASK_DATE_MAX}.`)
    .optional()
    .describe('YYYY-MM-DD.'),
  sort: z.number().int().nonnegative().optional().describe('Position; omit to append.'),
});

/** The fields `update` can change, as the tool takes them. See {@link MilestoneCreateInput}. */
const MilestoneUpdateInput = z.object({
  name: z.string().regex(/\S/, 'A milestone needs a name.').optional(),
  description: z.string().nullable().optional(),
  targetDate: z.iso
    .date()
    .refine(inDateRange, `Pick a date from ${TASK_DATE_MIN} to ${TASK_DATE_MAX}.`)
    .nullable()
    .optional()
    .describe('YYYY-MM-DD.'),
  sort: z.number().int().nonnegative().optional(),
});

/** One milestone as the tool reports it: the REST shape plus where it shows in the app. */
const MilestoneRowOut = MilestoneOut.extend({
  href: z.string().describe('Where it shows in the product app — its Project page.'),
});

/** The tool's arguments. */
interface MilestonesInput {
  readonly orgId: string;
  readonly project: string;
  readonly action: MilestoneAction;
  readonly milestone?: string | undefined;
  readonly milestones?: readonly MilestoneCreate[] | undefined;
  readonly set?: MilestoneUpdate | undefined;
}

/** The Project an action runs against, resolved and authorized. */
interface Scope {
  readonly orgId: string;
  readonly actor: McpActor;
  readonly projectId: string;
  readonly projectName: string;
}

/** What one action produced. */
interface ActionResult {
  readonly rows: readonly MilestoneRow[];
  readonly summary: string | null;
  readonly changes: readonly RecordedChange[];
}

/** Raise a field error for an argument the action needs. */
function missing(field: string, message: string): never {
  throw new ValidationError([{ message, path: [field] }]);
}

/**
 * Resolve the Project and check the caller may read it, or write it for anything but `list`.
 *
 * @remarks
 * A milestone has no grants of its own; access follows its Project, which is the same rule the
 * REST routes apply through the `contribute` capability.
 */
async function resolveScope(ctx: McpContext, input: MilestonesInput): Promise<Scope> {
  const write = input.action !== 'list';
  const actor = await scopedActor(ctx, input.orgId, write ? 'work:write' : 'work:read');
  const projectId = await resolveDescriptor(input.orgId, 'project', input.project, 'project');
  await authorize(actor, write ? 'contribute' : 'view', {
    kind: 'project',
    id: projectId,
    orgId: input.orgId,
  });
  const [row] = await db
    .select({ name: project.name })
    .from(project)
    .where(and(eq(project.id, projectId), eq(project.organizationId, input.orgId)))
    .limit(1);
  /* v8 ignore next -- @preserve `resolveDescriptor` only returns an existing project */
  if (!row) throw new NotFoundError('Project not found');
  return { orgId: input.orgId, actor, projectId, projectName: row.name };
}

/** The one milestone an `update` or `delete` names, loaded as a member of the Project. */
async function targetMilestone(scope: Scope, value: string | undefined): Promise<MilestoneRow> {
  if (value === undefined) missing('milestone', 'Name the milestone to change, by name or id.');
  const { id } = await resolveMilestone(scope.orgId, scope.projectId, value, 'milestone');
  return loadMilestone(scope.orgId, scope.projectId, id);
}

/** `list`: the Project's milestones in timeline order, or the one named. */
async function listAction(scope: Scope, input: MilestonesInput): Promise<ActionResult> {
  if (input.milestone !== undefined) {
    return { rows: [await targetMilestone(scope, input.milestone)], summary: null, changes: [] };
  }
  const rows = await db
    .select()
    .from(milestone)
    .where(and(eq(milestone.organizationId, scope.orgId), eq(milestone.projectId, scope.projectId)))
    .orderBy(asc(milestone.sort), asc(milestone.id));
  return { rows, summary: null, changes: [] };
}

/** `create`: append every given milestone to the Project, all or none. */
async function createAction(scope: Scope, input: MilestonesInput): Promise<ActionResult> {
  const entries = input.milestones;
  if (!entries || entries.length === 0) {
    missing('milestones', 'List the milestones to create.');
  }
  const rows = await appendMilestones(
    { orgId: scope.orgId, projectId: scope.projectId, actorId: scope.actor.actorId },
    entries,
  );
  const [first] = rows;
  return {
    rows,
    summary:
      rows.length === 1 && first
        ? `Created milestone "${first.name}" in "${scope.projectName}"`
        : `Created ${String(rows.length)} milestones in "${scope.projectName}"`,
    changes: rows.map((row) => ({
      kind: 'milestone',
      id: row.id,
      op: 'create',
      after: trackedFields('milestone', row),
    })),
  };
}

/** `update`: change one milestone's name, note, date, or position. */
async function updateAction(scope: Scope, input: MilestonesInput): Promise<ActionResult> {
  const patch = input.set;
  if (!patch || Object.keys(patch).length === 0) {
    missing('set', 'Say what to change: name, description, targetDate, or sort.');
  }
  const before = await targetMilestone(scope, input.milestone);
  const after = await updateMilestone(scope.orgId, before.id, patch);
  return {
    rows: [after],
    summary: `Updated milestone "${after.name}" in "${scope.projectName}"`,
    changes: [
      {
        kind: 'milestone',
        id: after.id,
        op: 'update',
        before: trackedFields('milestone', before),
        after: trackedFields('milestone', after),
      },
    ],
  };
}

/**
 * `delete`: remove one milestone; its Tasks stay in the Project, on no milestone.
 *
 * @remarks
 * The Tasks it released are recorded on the milestone's own entry rather than as entries of their
 * own, so `undo` re-inserts the milestone and relinks them in one step, whatever order it reads a
 * change set's entries in.
 */
async function deleteAction(scope: Scope, input: MilestonesInput): Promise<ActionResult> {
  const target = await targetMilestone(scope, input.milestone);
  const { row, detachedTaskIds } = await deleteMilestone(scope.orgId, target.id, true);
  const before = {
    ...trackedFields('milestone', row),
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    detachedTaskIds,
  };
  return {
    rows: [row],
    summary: `Deleted milestone "${row.name}" from "${scope.projectName}"`,
    changes: [{ kind: 'milestone', id: row.id, op: 'delete', before }],
  };
}

/** Each action's implementation. */
const ACTIONS: Record<
  MilestoneAction,
  (scope: Scope, input: MilestonesInput) => Promise<ActionResult>
> = {
  list: listAction,
  create: createAction,
  update: updateAction,
  delete: deleteAction,
};

/** Keep the search index in step with a write, after it has committed. */
async function syncSearch(orgId: string, action: MilestoneAction, rows: readonly MilestoneRow[]) {
  for (const row of rows) {
    if (action === 'delete') await enqueueSearchDelete(orgId, 'milestone', row.id);
    else await enqueueSearchUpsert(orgId, 'milestone', row.id);
  }
}

/** The MCP declaration for the `milestones` tool. */
export const milestonesToolDefinition = {
  title: 'Manage milestones',
  description:
    "List, create, update, or delete a project's milestones. Reversible with `undo`. Assign tasks with `update` `set.milestone`.",
  inputSchema: {
    orgId: orgIdParam,
    project: z.string().min(1).describe('Project name or id.'),
    action: z.enum(MILESTONE_ACTIONS),
    milestone: z
      .string()
      .optional()
      .describe('Milestone name or id. Required for update and delete.'),
    milestones: z
      .array(MilestoneCreateInput)
      .max(PROJECT_CREATE_MILESTONE_LIMIT)
      .optional()
      .describe('For create, in timeline order.'),
    set: MilestoneUpdateInput.optional().describe('For update. null clears a field.'),
  },
  outputSchema: {
    project: z
      .object({
        id: z.string(),
        name: z.string(),
        href: z.string().describe('Where the project lives in the product app.'),
      })
      .describe('The project the action ran against.'),
    milestones: z
      .array(MilestoneRowOut)
      .describe(
        'For list, the milestones; for create and update, the milestones as they are now; for delete, the one removed.',
      ),
    changeSetId: z
      .string()
      .nullable()
      .describe('Pass to `undo` to take the change back. Null for list.'),
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false,
  },
};

/** Run one `milestones` call: authorize, act, index, record, and report. */
async function runMilestones(ctx: McpContext, input: MilestonesInput): Promise<CallToolResult> {
  const scope = await resolveScope(ctx, input);
  const result = await ACTIONS[input.action](scope, input);
  await syncSearch(scope.orgId, input.action, result.changes.length > 0 ? result.rows : []);

  const changeSetId =
    result.summary === null
      ? null
      : await recordChangeSet({
          orgId: scope.orgId,
          actorId: scope.actor.actorId,
          origin: originFor('milestones'),
          summary: result.summary,
          changes: result.changes,
        });

  // A deleted milestone has no Tasks left to count.
  const progress: ReadonlyMap<string, MilestoneProgress> =
    input.action === 'delete'
      ? new Map()
      : await visibleMilestoneTaskCounts(scope.orgId, scope.actor.actorId, scope.projectId);
  const href = entityHref(scope.orgId, 'project', scope.projectId);
  return jsonResult({
    project: { id: scope.projectId, name: scope.projectName, href },
    milestones: result.rows.map((row) => ({ ...toMilestoneOut(row, progress.get(row.id)), href })),
    changeSetId,
  });
}

/** Register `milestones` on `server`. */
export function registerMilestoneTool(server: McpRegistrar, ctx: McpContext): void {
  server.registerTool('milestones', milestonesToolDefinition, (input: MilestonesInput) =>
    runTool(() => runMilestones(ctx, input)),
  );
}
