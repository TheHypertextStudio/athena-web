/**
 * `@docket/api` — the `link` tool: every relation between two pieces of work, in one verb.
 *
 * @remarks
 * "What's blocking the launch?" and "put this project under the Q3 initiative" are the same kind of
 * statement — one thing stands in a named relation to another. The old surface split that across
 * four tools with four argument shapes (`add_task_dependency`, `remove_task_dependency`,
 * `link_initiative`, and reparenting, which had no tool at all), so an agent had to know which
 * table the relation lived in before it could express the sentence.
 *
 * One verb, a `relation` naming which, and a `remove` flag for the other direction. Removing is the
 * same call rather than a separate tool, because "no longer blocks" is not a different idea from
 * "blocks".
 */
import { db, initiativeProgram, initiativeProject, task, taskDependency } from '@docket/db';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';

import { CycleError, NotFoundError, ValidationError } from '../error';
import {
  applySubtaskCompletionPolicyForParents,
  finishTaskStateTransition,
} from '../lib/task-state';
import { serializableTx } from '../lib/serializable-tx';
import { enqueueSearchUpsert } from '../search/write-through';
import type { McpContext } from './auth';
import type { McpRegistrar } from './catalog';
import { recordChangeSet, trackedFields, type RecordedChange } from './change-set';
import { DESCRIPTOR_HINT, resolveAcross, resolveDescriptor } from './descriptors';
import { authorize, jsonResult, runTool, scopedActor } from './result';
import { wouldCreateSubtaskCycle } from '../routes/task-helpers';
import { loadTask, orgIdParam, wouldCreateCycle } from './tools-shared';

/** The relations `link` understands. */
const RELATIONS = ['blocks', 'contributes_to', 'subtask_of'] as const;
/** One relation. */
type Relation = (typeof RELATIONS)[number];

/** Register `link` on `server`. */
export function registerLinkTool(
  server: McpRegistrar,
  ctx: McpContext,
  sessionId: string | null,
): void {
  server.registerTool(
    'link',
    {
      title: 'Link work',
      description:
        'State that one piece of work stands in a relation to another: `blocks` (the first must finish before the second), `contributes_to` (a project or program rolls up to an initiative), or `subtask_of` (a task sits under a parent task). Pass `remove: true` to take the relation back. Reversible with `undo`.',
      inputSchema: {
        orgId: orgIdParam,
        relation: z.enum(RELATIONS).describe('Which relation holds between `from` and `to`.'),
        from: z
          .string()
          .describe(
            `The subject: the blocking task, the contributing project or program, or the child task. ${DESCRIPTOR_HINT} Tasks must be given by id.`,
          ),
        to: z
          .string()
          .describe(
            `The object: the blocked task, the initiative, or the parent task. ${DESCRIPTOR_HINT} Tasks must be given by id.`,
          ),
        remove: z
          .boolean()
          .optional()
          .describe('Take the relation back instead of asserting it. Defaults to false.'),
      },
      outputSchema: {
        relation: z.enum(RELATIONS),
        from: z.string().describe('The resolved subject id.'),
        to: z.string().describe('The resolved object id.'),
        linked: z
          .boolean()
          .describe('True when the relation now holds, false when it no longer does.'),
        changed: z
          .boolean()
          .describe('False when it already stood that way and nothing was written.'),
        changeSetId: z.string().nullable().describe('Pass to `undo`. Null when nothing changed.'),
      },
      annotations: {
        readOnlyHint: false,
        // With `remove: true` it takes a relation away, which the caller should see before approving.
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (input) =>
      runTool(async () => {
        const actorCtx = await scopedActor(ctx, input.orgId, 'work:write');
        const remove = input.remove === true;
        const result = await applyRelation(
          input.relation,
          input.orgId,
          input.from,
          input.to,
          remove,
          async (kind, id) => {
            await authorize(actorCtx, 'contribute', { kind, id, orgId: input.orgId });
          },
        );

        const changeSetId = result.changed
          ? await recordChangeSet({
              orgId: input.orgId,
              actorId: actorCtx.actorId,
              origin: {
                tool: 'link',
                ...(sessionId ? { sessionId } : {}),
                ...(ctx.principal.kind === 'agent' ? { client: ctx.principal.displayName } : {}),
              },
              summary: remove
                ? `Unlinked ${input.relation.replace(/_/g, ' ')}`
                : `Linked ${input.relation.replace(/_/g, ' ')}`,
              changes: result.changes,
            })
          : null;

        for (const id of result.reindex) await enqueueSearchUpsert(input.orgId, 'task', id);

        return jsonResult({
          relation: input.relation,
          from: result.from,
          to: result.to,
          linked: !remove,
          changed: result.changed,
          changeSetId,
        });
      }),
  );
}

/** What applying one relation did. */
interface RelationResult {
  readonly from: string;
  readonly to: string;
  readonly changed: boolean;
  readonly changes: RecordedChange[];
  /** Task ids whose search document moved as a result. */
  readonly reindex: readonly string[];
}

/** Authorize the caller on one endpoint before it is touched. */
type Guard = (kind: 'task' | 'project' | 'program' | 'initiative', id: string) => Promise<void>;

/**
 * Resolve both endpoints, authorize them, and write the relation.
 *
 * @param relation - Which relation.
 * @param orgId - The organization both endpoints belong to.
 * @param from - The subject descriptor or id.
 * @param to - The object descriptor or id.
 * @param remove - Whether to take the relation back rather than assert it.
 * @param guard - Runs before each endpoint is written.
 * @returns what was written.
 */
async function applyRelation(
  relation: Relation,
  orgId: string,
  from: string,
  to: string,
  remove: boolean,
  guard: Guard,
): Promise<RelationResult> {
  if (relation === 'blocks') return applyBlocks(orgId, from, to, remove, guard);
  if (relation === 'subtask_of') return applySubtaskOf(orgId, from, to, remove, guard);
  return applyContributesTo(orgId, from, to, remove, guard);
}

/** Raise a field error on one endpoint. */
function rejectEndpoint(field: string, value: string, message: string): never {
  throw new ValidationError(
    new z.ZodError([{ code: 'custom', path: [field], message, input: value }]),
  );
}

/** `blocks`: an edge in `task_dependency`, refused when it would close a cycle. */
async function applyBlocks(
  orgId: string,
  from: string,
  to: string,
  remove: boolean,
  guard: Guard,
): Promise<RelationResult> {
  if (from === to) rejectEndpoint('to', to, 'A task cannot block itself.');
  await guard('task', from);
  await loadTask(orgId, from);
  await loadTask(orgId, to);

  const where = and(
    eq(taskDependency.organizationId, orgId),
    eq(taskDependency.blockingTaskId, from),
    eq(taskDependency.blockedTaskId, to),
  );
  const existing = await db
    .select({ blockingTaskId: taskDependency.blockingTaskId })
    .from(taskDependency)
    .where(where)
    .limit(1);

  if (remove) {
    if (!existing[0]) return { from, to, changed: false, changes: [], reindex: [] };
    await db.delete(taskDependency).where(where);
    return {
      from,
      to,
      changed: true,
      changes: [{ kind: 'blocks', from, to, linked: false }],
      reindex: [],
    };
  }

  if (existing[0]) return { from, to, changed: false, changes: [], reindex: [] };
  if (await wouldCreateCycle(orgId, from, to)) throw new CycleError();
  await db
    .insert(taskDependency)
    .values({ organizationId: orgId, blockingTaskId: from, blockedTaskId: to });
  return {
    from,
    to,
    changed: true,
    changes: [{ kind: 'blocks', from, to, linked: true }],
    reindex: [],
  };
}

/**
 * `subtask_of`: a column on the child, not a join.
 *
 * @remarks
 * Recorded as an ordinary update rather than a link, so undo restores the previous parent instead
 * of merely detaching — a task moved from one parent to another must go back where it came from.
 */
async function applySubtaskOf(
  orgId: string,
  from: string,
  to: string,
  remove: boolean,
  guard: Guard,
): Promise<RelationResult> {
  if (from === to) rejectEndpoint('to', to, 'A task cannot be its own parent.');
  await guard('task', from);
  const result = await serializableTx(async (tx) => {
    // Lock both endpoints in stable id order. Reciprocal links otherwise lock A then B and B
    // then A, which turns the cycle race into a database deadlock before SERIALIZABLE can retry.
    const endpoints = await tx
      .select()
      .from(task)
      .where(
        and(
          inArray(task.id, remove ? [from] : [from, to]),
          eq(task.organizationId, orgId),
          isNull(task.archivedAt),
        ),
      )
      .orderBy(asc(task.id))
      .for('update');
    const child = endpoints.find((row) => row.id === from);
    if (!child) throw new NotFoundError('Task not found');
    if (!remove && !endpoints.some((row) => row.id === to))
      throw new NotFoundError('Task not found');

    const next = remove ? null : to;
    if (child.parentTaskId === next) return { child, row: child, cascades: [], changed: false };
    if (!remove && (await wouldCreateSubtaskCycle(tx, orgId, from, to))) throw new CycleError();

    const updated = await tx
      .update(task)
      .set({ parentTaskId: next })
      .where(and(eq(task.id, from), eq(task.organizationId, orgId), isNull(task.archivedAt)))
      .returning();
    const row = updated[0];
    /* v8 ignore next -- @preserve the locked active row above cannot disappear */
    if (!row) throw new NotFoundError('Task not found');
    return {
      child,
      row,
      cascades: await applySubtaskCompletionPolicyForParents(tx, orgId, [
        child.parentTaskId,
        row.parentTaskId,
      ]),
      changed: true,
    };
  });
  const { child, row, cascades } = result;
  if (!result.changed) return { from, to, changed: false, changes: [], reindex: [] };
  for (const cascade of cascades) {
    await finishTaskStateTransition({ actorId: null }, cascade);
  }

  return {
    from,
    to,
    changed: true,
    changes: [
      {
        kind: 'task',
        id: from,
        op: 'update',
        before: trackedFields('task', child),
        after: trackedFields('task', row),
      },
    ],
    reindex: [from],
  };
}

/** `contributes_to`: a project or program rolls up to an initiative. */
async function applyContributesTo(
  orgId: string,
  from: string,
  to: string,
  remove: boolean,
  guard: Guard,
): Promise<RelationResult> {
  const initiativeId = await resolveDescriptor(orgId, 'initiative', to, 'to');
  // The subject may be either kind, and the sentence "the migration project contributes to Q3"
  // never mentions a table — so both pools are searched at once, which also means a name that
  // matches a project AND a program is reported as ambiguous rather than silently taking one.
  const { id: subjectId, kind: subjectKind } = await resolveAcross(
    orgId,
    ['project', 'program'] as const,
    from,
    'from',
  );
  await guard(subjectKind, subjectId);
  await guard('initiative', initiativeId);

  const link =
    subjectKind === 'project'
      ? {
          table: initiativeProject,
          where: and(
            eq(initiativeProject.organizationId, orgId),
            eq(initiativeProject.projectId, subjectId),
            eq(initiativeProject.initiativeId, initiativeId),
          ),
          values: { organizationId: orgId, projectId: subjectId, initiativeId },
          kind: 'project_contributes_to' as const,
        }
      : {
          table: initiativeProgram,
          where: and(
            eq(initiativeProgram.organizationId, orgId),
            eq(initiativeProgram.programId, subjectId),
            eq(initiativeProgram.initiativeId, initiativeId),
          ),
          values: { organizationId: orgId, programId: subjectId, initiativeId },
          kind: 'program_contributes_to' as const,
        };

  const existing = await db.select().from(link.table).where(link.where).limit(1);
  const result = { from: subjectId, to: initiativeId };
  if (remove) {
    if (!existing[0]) return { ...result, changed: false, changes: [], reindex: [] };
    await db.delete(link.table).where(link.where);
  } else {
    if (existing[0]) return { ...result, changed: false, changes: [], reindex: [] };
    await db.insert(link.table).values(link.values);
  }
  return {
    ...result,
    changed: true,
    changes: [{ kind: link.kind, from: subjectId, to: initiativeId, linked: !remove }],
    reindex: [],
  };
}
