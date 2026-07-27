/**
 * `@docket/api` — the `organize` tool: a whole plan written in one call.
 *
 * @remarks
 * "Set up a Q3 platform initiative with three projects under it" was 44 calls on the old surface,
 * and it could not actually be done: a task had no way to reference a project created in the same
 * turn, so the agent had to create the parent, read back its id, and only then file children — a
 * round trip per node, with a half-built tree left behind whenever one of them failed.
 *
 * This takes the whole shape at once. Items reference each other by a local `ref` the caller
 * invents, which is resolved to real ids as the tree is walked parents-first, and the walk runs in
 * one serializable transaction so a failure anywhere leaves nothing behind.
 *
 * **It reconciles rather than duplicating.** Running the same plan twice is the normal case, not an
 * error — someone re-pastes an updated doc, or an agent retries after a timeout. So each item is
 * matched against what already exists in its parent's scope, and the result says per item whether
 * it was created or matched. Without that, the second run of a document import silently doubles a
 * workspace.
 */
import {
  initiative,
  initiativeProgram,
  initiativeProject,
  program,
  project,
  task,
} from '@docket/db';
import { Priority } from '@docket/types';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';

import { NotFoundError, ValidationError } from '../error';
import { resolveLandingTarget } from '../lib/task-landing';
import { serializableTx } from '../lib/serializable-tx';
import { enqueueSearchUpsert } from '../search/write-through';
import type { McpContext } from './auth';
import type { McpRegistrar } from './catalog';
import { recordChangeSet, trackedFields, type ChangeRecord } from './change-set';
import { DESCRIPTOR_HINT, resolveOptional } from './descriptors';
import { authorize, jsonResult, runTool, scopedActor } from './result';
import { orgIdParam, resolveStateTransition } from './tools-shared';

/** The kinds `organize` can place, outermost first — also the order they must be walked in. */
const KINDS = ['initiative', 'program', 'project', 'task'] as const;
/** One placeable kind. */
type Kind = (typeof KINDS)[number];

/**
 * The most nodes one plan may contain.
 *
 * @remarks
 * Generous enough for a real document — an initiative with a dozen projects and their tasks — and
 * small enough that the whole thing fits in one transaction without holding locks across a
 * meaningful span of time.
 */
const MAX_ITEMS = 200;

/** One node of the plan. */
const OrganizeItem = z.object({
  ref: z
    .string()
    .min(1)
    .describe(
      'A short handle you invent for this item, unique within the call, so other items can name it as their parent. Never stored.',
    ),
  kind: z.enum(KINDS).describe('What to place.'),
  title: z
    .string()
    .min(1)
    .describe('Its name or title. Also what an existing item is matched against.'),
  description: z.string().optional().describe('The full body, as markdown.'),
  parent: z
    .string()
    .optional()
    .describe(
      'The `ref` of another item in this call that this one sits under — a task under a project, a project under a program or initiative, a program under an initiative. To attach to something that already exists instead, use `project`/`program`/`initiative`.',
    ),
  project: z
    .string()
    .optional()
    .describe(`An existing project to file this task under. ${DESCRIPTOR_HINT}`),
  program: z
    .string()
    .optional()
    .describe(`An existing program this rolls up to. ${DESCRIPTOR_HINT}`),
  initiative: z
    .string()
    .optional()
    .describe(`An existing initiative this contributes to. ${DESCRIPTOR_HINT}`),
  assignee: z.string().optional().describe(`Who is accountable for the task. ${DESCRIPTOR_HINT}`),
  owner: z.string().optional().describe(`Who owns the program or initiative. ${DESCRIPTOR_HINT}`),
  lead: z.string().optional().describe(`Who leads the project. ${DESCRIPTOR_HINT}`),
  team: z
    .string()
    .optional()
    .describe(`The team that owns it. Defaults to the landing team. ${DESCRIPTOR_HINT}`),
  priority: z.string().optional().describe("A task's priority."),
  state: z.string().optional().describe("A task's workflow state, by key or display name."),
  dueDate: z.iso.date().optional().describe('When the task is due, as `YYYY-MM-DD`.'),
  targetDate: z.iso
    .date()
    .optional()
    .describe('The target finish for a project or initiative, as `YYYY-MM-DD`.'),
});
/** One node of the plan. */
type OrganizeItem = z.infer<typeof OrganizeItem>;

/** Which parent kinds each kind may sit under, in this call or already in the workspace. */
const ALLOWED_PARENTS: Record<Kind, readonly Kind[]> = {
  initiative: [],
  program: ['initiative'],
  project: ['program', 'initiative'],
  task: ['project', 'program', 'task'],
};

/** What happened to one item. */
interface Placed {
  readonly ref: string;
  readonly kind: Kind;
  readonly id: string;
  /** False when an existing item of the same name in the same place was used instead. */
  readonly created: boolean;
}

/**
 * Raise a field error naming the offending item and the legal alternatives.
 *
 * @param field - The path that failed, including the item index.
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

/**
 * Order the plan so every parent is placed before its children, rejecting a cycle.
 *
 * @remarks
 * A caller writing a tree in prose order usually gets this right anyway; sorting rather than
 * requiring it means "the task, and by the way it goes under this project below" still works.
 *
 * @param items - The plan as supplied.
 * @returns the same items, parents first.
 * @throws {ValidationError} When a `parent` names nothing in the call, or the refs form a cycle.
 */
function inParentOrder(items: readonly OrganizeItem[]): OrganizeItem[] {
  const byRef = new Map<string, OrganizeItem>();
  for (const [index, item] of items.entries()) {
    if (byRef.has(item.ref)) {
      reject(`items.${index}.ref`, item.ref, 'Two items share this ref.', [...byRef.keys()]);
    }
    byRef.set(item.ref, item);
  }

  const ordered: OrganizeItem[] = [];
  const done = new Set<string>();
  const open = new Set<string>();

  const visit = (item: OrganizeItem, index: number): void => {
    if (done.has(item.ref)) return;
    if (open.has(item.ref)) {
      reject(`items.${index}.parent`, item.ref, 'These items are each other’s parent.', [...open]);
    }
    open.add(item.ref);
    if (item.parent !== undefined) {
      const parent = byRef.get(item.parent);
      if (!parent) {
        reject(`items.${index}.parent`, item.parent, 'No item in this call has that ref.', [
          ...byRef.keys(),
        ]);
      }
      const allowed = ALLOWED_PARENTS[item.kind];
      if (!allowed.includes(parent.kind)) {
        reject(
          `items.${index}.parent`,
          parent.kind,
          `A ${item.kind} cannot sit under a ${parent.kind}.`,
          allowed,
        );
      }
      visit(parent, items.indexOf(parent));
    }
    open.delete(item.ref);
    done.add(item.ref);
    ordered.push(item);
  };

  for (const [index, item] of items.entries()) visit(item, index);
  return ordered;
}

/**
 * Reject a priority the enum does not contain, before anything is written.
 *
 * @remarks
 * Checked here rather than on the item schema because the failure needs to name the item's index,
 * so a caller pasting a fifty-node plan is told which node to fix.
 */
function assertPriorities(items: readonly OrganizeItem[]): void {
  for (const [index, item] of items.entries()) {
    if (item.priority === undefined) continue;
    if (!Priority.safeParse(item.priority).success) {
      reject(`items.${index}.priority`, item.priority, 'Not a task priority.', Priority.options);
    }
  }
}

/** Where an item ended up, once its parent refs and descriptors are resolved to ids. */
interface Placement {
  projectId: string | null;
  programId: string | null;
  initiativeId: string | null;
  parentTaskId: string | null;
}

/** Register `organize` on `server`. */
export function registerOrganizeTool(
  server: McpRegistrar,
  ctx: McpContext,
  sessionId: string | null,
): void {
  server.registerTool(
    'organize',
    {
      title: 'Organize work',
      description:
        'Create a whole plan — initiatives, programs, projects, and tasks — in one call, with children naming their parent by a local `ref` you invent. Running the same plan twice does not duplicate it: anything already there by that name in that place is matched and reused, and the result says which was which. Use this for turning a document or a conversation into structure; use capture for a single task.',
      inputSchema: {
        orgId: orgIdParam,
        items: z
          .array(OrganizeItem)
          .min(1)
          .max(MAX_ITEMS)
          .describe('The plan. Order does not matter — parents are placed first either way.'),
      },
      outputSchema: {
        placed: z
          .array(
            z.object({
              ref: z.string().describe('The handle you gave it.'),
              kind: z.enum(KINDS),
              id: z.string().describe('Its real id.'),
              created: z
                .boolean()
                .describe('False when an existing item of that name was matched instead.'),
            }),
          )
          .describe('Every item, in the order it was placed.'),
        created: z.number().int().describe('How many were new.'),
        matched: z.number().int().describe('How many already existed.'),
        changeSetId: z
          .string()
          .nullable()
          .describe('Pass to `undo` to take the whole plan back. Null when nothing was created.'),
      },
      annotations: {
        readOnlyHint: false,
        // It only creates and links; nothing existing is overwritten.
        destructiveHint: false,
        // Reconciliation is what makes this true: a repeat run matches instead of duplicating.
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (input) =>
      runTool(async () => {
        const actorCtx = await scopedActor(ctx, input.orgId, 'work:write');
        await authorize(actorCtx, 'contribute', {
          kind: 'organization',
          id: input.orgId,
          orgId: input.orgId,
        });

        const ordered = inParentOrder(input.items);
        assertPriorities(ordered);
        const landing = await resolveLandingTarget(input.orgId, actorCtx.actorId);
        if (!landing) throw new NotFoundError('No team to organize into');

        // Every descriptor and workflow state is resolved BEFORE the transaction opens. None of
        // them depend on anything the plan writes, and resolving them inside would mean issuing
        // reads on a connection the transaction already holds — which does not merely read stale
        // data, it stalls. A bad name therefore fails before a single row is written.
        const prepared = await Promise.all(
          ordered.map(async (item, index) => {
            const refs = await resolveItem(input.orgId, item);
            const state =
              item.state === undefined
                ? { state: landing.state, completedAt: null, canceledAt: null }
                : await resolveStateTransition(
                    input.orgId,
                    refs.teamId ?? landing.teamId,
                    item.state,
                    `items.${index}.state`,
                  );
            return { item, refs, state };
          }),
        );

        const placed: Placed[] = [];
        const byRef = new Map<string, Placed>();
        const changes: ChangeRecord[] = [];

        await serializableTx(async (tx) => {
          for (const { item, refs, state } of prepared) {
            /** The already-placed parent from this call, if the item named one. */
            const local = item.parent === undefined ? undefined : byRef.get(item.parent);

            const at: Placement = {
              projectId: (local?.kind === 'project' ? local.id : undefined) ?? refs.projectId,
              programId: (local?.kind === 'program' ? local.id : undefined) ?? refs.programId,
              initiativeId:
                (local?.kind === 'initiative' ? local.id : undefined) ?? refs.initiativeId,
              parentTaskId: local?.kind === 'task' ? local.id : null,
            };

            const result = await placeItem(tx, {
              orgId: input.orgId,
              actorId: actorCtx.actorId,
              item,
              at,
              teamId: refs.teamId ?? landing.teamId,
              state,
              assigneeId: refs.assigneeId,
              ownerId: refs.ownerId,
              leadId: refs.leadId,
            });

            placed.push(result.placed);
            byRef.set(item.ref, result.placed);
            if (result.change) changes.push(result.change);
          }
        });

        // Search indexing and change recording both happen after commit: a rolled-back plan must
        // not leave an index entry pointing at a row that never existed, or an undo for it.
        for (const row of placed) {
          if (row.created) await enqueueSearchUpsert(input.orgId, row.kind, row.id);
        }
        const created = placed.filter((row) => row.created).length;
        const changeSetId = await recordChangeSet({
          orgId: input.orgId,
          actorId: actorCtx.actorId,
          origin: {
            tool: 'organize',
            ...(sessionId ? { sessionId } : {}),
            ...(ctx.principal.kind === 'agent' ? { client: ctx.principal.displayName } : {}),
          },
          summary:
            created === 1 && placed[0]
              ? `Created "${ordered[0]?.title}"`
              : `Created ${created} items`,
          changes,
        });

        return jsonResult({
          placed,
          created,
          matched: placed.length - created,
          changeSetId,
        });
      }),
  );
}

/** One item's descriptor fields, resolved to ids. */
interface ItemRefs {
  readonly projectId: string | null;
  readonly programId: string | null;
  readonly initiativeId: string | null;
  readonly teamId: string | null;
  readonly assigneeId: string | null;
  readonly ownerId: string | null;
  readonly leadId: string | null;
}

/**
 * Resolve every name one item mentions.
 *
 * @param orgId - The organization the names belong to.
 * @param item - The item as supplied.
 * @returns the resolved ids, null where the item said nothing.
 */
async function resolveItem(orgId: string, item: OrganizeItem): Promise<ItemRefs> {
  const [projectId, programId, initiativeId, teamId, assigneeId, ownerId, leadId] =
    await Promise.all([
      resolveOptional(orgId, 'project', item.project, 'project'),
      resolveOptional(orgId, 'program', item.program, 'program'),
      resolveOptional(orgId, 'initiative', item.initiative, 'initiative'),
      resolveOptional(orgId, 'team', item.team, 'team'),
      resolveOptional(orgId, 'actor', item.assignee, 'assignee'),
      resolveOptional(orgId, 'actor', item.owner, 'owner'),
      resolveOptional(orgId, 'actor', item.lead, 'lead'),
    ]);
  return {
    projectId: projectId ?? null,
    programId: programId ?? null,
    initiativeId: initiativeId ?? null,
    teamId: teamId ?? null,
    assigneeId: assigneeId ?? null,
    ownerId: ownerId ?? null,
    leadId: leadId ?? null,
  };
}

/** Everything one item needs to be placed, with parents and descriptors already resolved. */
interface PlaceInput {
  readonly orgId: string;
  readonly actorId: string;
  readonly item: OrganizeItem;
  readonly at: Placement;
  readonly teamId: string;
  /** The workflow state a new task lands in, already resolved against its team. */
  readonly state: { state: string; completedAt: Date | null; canceledAt: Date | null };
  readonly assigneeId: string | null;
  readonly ownerId: string | null;
  readonly leadId: string | null;
}

/** A transaction handle from {@link serializableTx}. */
type Tx = Parameters<Parameters<typeof serializableTx>[0]>[0];

/**
 * Place one item: match what is already there, or create it.
 *
 * @remarks
 * Matching is scoped to where the item would go, not to the whole organization — two projects
 * called "Rollout" under different programs are two projects, and treating them as one would
 * quietly merge unrelated work. Only a task with no parent at all falls back to an org-wide
 * title match, because there is nowhere narrower to look.
 *
 * @param tx - The open transaction.
 * @param input - The resolved item.
 * @returns what it became, and the change to record when it was created.
 */
async function placeItem(
  tx: Tx,
  input: PlaceInput,
): Promise<{ placed: Placed; change?: ChangeRecord }> {
  const { item, at, orgId } = input;

  if (item.kind === 'initiative') {
    const existing = await tx
      .select()
      .from(initiative)
      .where(
        and(
          eq(initiative.organizationId, orgId),
          isNull(initiative.archivedAt),
          sql`lower(${initiative.name}) = lower(${item.title})`,
        ),
      )
      .limit(1);
    if (existing[0]) {
      return { placed: { ref: item.ref, kind: 'initiative', id: existing[0].id, created: false } };
    }
    const inserted = await tx
      .insert(initiative)
      .values({
        organizationId: orgId,
        name: item.title,
        description: item.description,
        ownerId: input.ownerId,
        targetDate: item.targetDate ? new Date(item.targetDate) : undefined,
        createdBy: input.actorId,
      })
      .returning();
    const row = inserted[0];
    /* v8 ignore next -- @preserve defensive: insert always returns a row */
    if (!row) throw new Error('initiative insert returned no row');
    return {
      placed: { ref: item.ref, kind: 'initiative', id: row.id, created: true },
      change: {
        kind: 'initiative',
        id: row.id,
        op: 'create',
        after: trackedFields('initiative', row),
      },
    };
  }

  if (item.kind === 'program') {
    const existing = await tx
      .select()
      .from(program)
      .where(
        and(
          eq(program.organizationId, orgId),
          isNull(program.archivedAt),
          sql`lower(${program.name}) = lower(${item.title})`,
        ),
      )
      .limit(1);
    const id =
      existing[0]?.id ??
      (
        await tx
          .insert(program)
          .values({
            organizationId: orgId,
            name: item.title,
            description: item.description,
            ownerId: input.ownerId,
            createdBy: input.actorId,
          })
          .returning()
      )[0]?.id;
    /* v8 ignore next -- @preserve defensive: insert always returns a row */
    if (!id) throw new Error('program insert returned no row');
    const created = !existing[0];
    // The link is written whether or not the program was new, so re-running a plan that adds an
    // initiative over existing programs attaches them rather than doing nothing.
    if (at.initiativeId) {
      await tx
        .insert(initiativeProgram)
        .values({ organizationId: orgId, initiativeId: at.initiativeId, programId: id })
        .onConflictDoNothing();
    }
    const row = created
      ? (await tx.select().from(program).where(eq(program.id, id)).limit(1))[0]
      : undefined;
    return {
      placed: { ref: item.ref, kind: 'program', id, created },
      ...(row
        ? {
            change: {
              kind: 'program' as const,
              id,
              op: 'create' as const,
              after: trackedFields('program', row),
            },
          }
        : {}),
    };
  }

  if (item.kind === 'project') {
    const existing = await tx
      .select()
      .from(project)
      .where(
        and(
          eq(project.organizationId, orgId),
          isNull(project.archivedAt),
          sql`lower(${project.name}) = lower(${item.title})`,
          at.programId ? eq(project.programId, at.programId) : isNull(project.programId),
        ),
      )
      .limit(1);
    const id =
      existing[0]?.id ??
      (
        await tx
          .insert(project)
          .values({
            organizationId: orgId,
            name: item.title,
            description: item.description,
            leadId: input.leadId,
            teamId: input.teamId,
            programId: at.programId,
            targetDate: item.targetDate ? new Date(item.targetDate) : undefined,
            createdBy: input.actorId,
          })
          .returning()
      )[0]?.id;
    /* v8 ignore next -- @preserve defensive: insert always returns a row */
    if (!id) throw new Error('project insert returned no row');
    const created = !existing[0];
    if (at.initiativeId) {
      await tx
        .insert(initiativeProject)
        .values({ organizationId: orgId, initiativeId: at.initiativeId, projectId: id })
        .onConflictDoNothing();
    }
    const row = created
      ? (await tx.select().from(project).where(eq(project.id, id)).limit(1))[0]
      : undefined;
    return {
      placed: { ref: item.ref, kind: 'project', id, created },
      ...(row
        ? {
            change: {
              kind: 'project' as const,
              id,
              op: 'create' as const,
              after: trackedFields('project', row),
            },
          }
        : {}),
    };
  }

  // A task's scope is its parent task, then its project, then its program; an orphan matches
  // org-wide because there is nowhere narrower to look.
  const scope = at.parentTaskId
    ? eq(task.parentTaskId, at.parentTaskId)
    : at.projectId
      ? eq(task.projectId, at.projectId)
      : at.programId
        ? eq(task.programId, at.programId)
        : and(isNull(task.projectId), isNull(task.programId), isNull(task.parentTaskId));
  const existing = await tx
    .select({ id: task.id })
    .from(task)
    .where(
      and(
        eq(task.organizationId, orgId),
        isNull(task.archivedAt),
        sql`lower(${task.title}) = lower(${item.title})`,
        scope,
      ),
    )
    .limit(1);
  if (existing[0]) {
    return { placed: { ref: item.ref, kind: 'task', id: existing[0].id, created: false } };
  }

  const inserted = await tx
    .insert(task)
    .values({
      organizationId: orgId,
      title: item.title,
      description: item.description,
      teamId: input.teamId,
      state: input.state.state,
      completedAt: input.state.completedAt,
      canceledAt: input.state.canceledAt,
      assigneeId: input.assigneeId,
      projectId: at.projectId,
      programId: at.programId,
      parentTaskId: at.parentTaskId,
      priority: Priority.parse(item.priority ?? 'none'),
      dueDate: item.dueDate ? new Date(item.dueDate) : undefined,
      source: 'native',
      createdBy: input.actorId,
    })
    .returning();
  const row = inserted[0];
  /* v8 ignore next -- @preserve defensive: insert always returns a row */
  if (!row) throw new Error('task insert returned no row');
  return {
    placed: { ref: item.ref, kind: 'task', id: row.id, created: true },
    change: { kind: 'task', id: row.id, op: 'create', after: trackedFields('task', row) },
  };
}
