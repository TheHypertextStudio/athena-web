/**
 * `@docket/api` — placing a plan's items into the workspace, one node at a time.
 *
 * @remarks
 * The reconciling create-or-match walk the `organize` tool runs, lifted out so the planning canvas
 * commit can create the same tree through the same rules: matching is scoped to where an item
 * would go, parents are placed before children, and a repeat run matches instead of duplicating.
 * Both callers open their own serializable transaction and hand it in; this module never opens
 * one itself.
 */
import {
  initiative,
  initiativeProgram,
  initiativeProject,
  program,
  project,
  task,
} from '@docket/db';
import { Priority } from '@docket/work/task-contract';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';

import { ValidationError } from '../../error';
import { trackedFields, type ChangeRecord } from '../../mcp/change-set';
import { DESCRIPTOR_HINT, resolveOptional } from '../../mcp/descriptors';
import { entityHref } from '../../mcp/entity-href';
import type { serializableTx } from '../serializable-tx';
import { attachToMilestone, placeMilestone, resolveItemMilestone } from './place-milestone';
import { resolveContainerStatus } from '../work-status';

/** The kinds `organize` can place, outermost first — also the order they must be walked in. */
export const KINDS = ['initiative', 'program', 'project', 'milestone', 'task'] as const;
/** One placeable kind. */
export type Kind = (typeof KINDS)[number];

/**
 * The most nodes one plan may contain.
 *
 * @remarks
 * Generous enough for a real document — an initiative with a dozen projects and their tasks — and
 * small enough that the whole thing fits in one transaction without holding locks across a
 * meaningful span of time.
 */
export const MAX_ITEMS = 200;

/** One node of the plan. */
export const OrganizeItem = z.object({
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
      'The `ref` of another item in this call that this one sits under — a task under a project or milestone, a milestone under a project, a project under a program or initiative, a program under an initiative. To attach to something that already exists instead, use `project`/`program`/`initiative`.',
    ),
  project: z
    .string()
    .optional()
    .describe(`An existing project to file this task or milestone under. ${DESCRIPTOR_HINT}`),
  milestone: z.string().optional().describe('An existing milestone for this task.'),
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
    .describe('The target finish for a project, milestone, or initiative, as `YYYY-MM-DD`.'),
});
/** One node of the plan. */
export type OrganizeItem = z.infer<typeof OrganizeItem>;

/** Which parent kinds each kind may sit under, in this call or already in the workspace. */
const ALLOWED_PARENTS: Record<Kind, readonly Kind[]> = {
  initiative: [],
  program: ['initiative'],
  project: ['program', 'initiative'],
  milestone: ['project'],
  task: ['project', 'milestone', 'program', 'task'],
};

/**
 * What every placement reports identically: the handle, the name, the parent, and the route.
 *
 * @param item - The item being placed.
 * @param href - Where it shows in the product app.
 */
function identityOf(
  item: OrganizeItem,
  href: string,
): Pick<Placed, 'ref' | 'title' | 'parent' | 'href'> {
  return { ref: item.ref, title: item.title, parent: item.parent, href };
}

/** What happened to one item. */
export interface Placed {
  readonly ref: string;
  readonly kind: Kind;
  readonly id: string;
  /** What it is called. The widget renders this; `ref` is a handle, not a name. */
  readonly title: string;
  /** Where it lives in the product app, built server-side so no widget assembles a route. */
  readonly href: string;
  /**
   * The `ref` this was placed under, echoed back, so a change report can draw the tree the
   * caller described. Explicitly `| undefined` so it assigns straight through; `JSON.stringify`
   * drops the key.
   */
  readonly parent?: string | undefined;
  /** False when an existing item of the same name in the same place was used instead. */
  readonly created: boolean;
  /** The project a milestone belongs to, so a task placed under it lands in the same project. */
  readonly projectId?: string | undefined;
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
export function inParentOrder(items: readonly OrganizeItem[]): OrganizeItem[] {
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
export function assertPriorities(items: readonly OrganizeItem[]): void {
  for (const [index, item] of items.entries()) {
    if (item.priority === undefined) continue;
    if (!Priority.safeParse(item.priority).success) {
      reject(`items.${index}.priority`, item.priority, 'Not a task priority.', Priority.options);
    }
  }
}

/** Where an item ended up, once its parent refs and descriptors are resolved to ids. */
export interface Placement {
  projectId: string | null;
  programId: string | null;
  initiativeId: string | null;
  milestoneId: string | null;
  parentTaskId: string | null;
}

/** One item's descriptor fields, resolved to ids. */
export interface ItemRefs {
  readonly projectId: string | null;
  readonly milestoneId: string | null;
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
export async function resolveItem(orgId: string, item: OrganizeItem): Promise<ItemRefs> {
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
    ...(await resolveItemMilestone(orgId, item, projectId)),
    programId: programId ?? null,
    initiativeId: initiativeId ?? null,
    teamId: teamId ?? null,
    assigneeId: assigneeId ?? null,
    ownerId: ownerId ?? null,
    leadId: leadId ?? null,
  };
}

/**
 * Where an `organize` item lands: a parent placed in this call wins over a resolved descriptor.
 *
 * @remarks
 * A task under a milestone placed in this call lands in that milestone's project as well as on it.
 *
 * @param local - The parent placed earlier in this call, if the item named one.
 * @param refs - The item's descriptors, resolved.
 * @returns the placement.
 */
export function placementUnder(local: Placed | undefined, refs: ItemRefs): Placement {
  const localId = (kind: Kind): string | undefined => (local?.kind === kind ? local.id : undefined);
  const projectId = localId('project') ?? local?.projectId ?? refs.projectId;
  // A named milestone resolves with its own project in `refs.projectId`; a parent that puts the
  // task in any other project would file it on a milestone of a different project.
  if (refs.milestoneId !== null && localId('milestone') === undefined) {
    if (projectId !== refs.projectId) {
      reject('milestone', refs.milestoneId, "The milestone is not in this task's project.", []);
    }
  }
  return {
    projectId,
    programId: localId('program') ?? refs.programId,
    initiativeId: localId('initiative') ?? refs.initiativeId,
    milestoneId: localId('milestone') ?? refs.milestoneId,
    parentTaskId: localId('task') ?? null,
  };
}

/** Everything one item needs to be placed, with parents and descriptors already resolved. */
export interface PlaceInput {
  readonly orgId: string;
  readonly actorId: string;
  readonly item: OrganizeItem;
  readonly at: Placement;
  readonly teamId: string;
  /** The workflow state a new task lands in, already resolved against its team. */
  readonly state: {
    statusId: string;
    state: string;
    completedAt: Date | null;
    canceledAt: Date | null;
  };
  readonly assigneeId: string | null;
  readonly ownerId: string | null;
  readonly leadId: string | null;
}

/** A transaction handle from {@link serializableTx}. */
export type Tx = Parameters<Parameters<typeof serializableTx>[0]>[0];

/** What one placement produced: the item's identity and, for a new row, the change to record. */
export interface PlaceResult {
  readonly placed: Placed;
  readonly change?: ChangeRecord;
}

/** The status columns a new container row starts with. */
async function containerStatus(
  tx: Tx,
  orgId: string,
  kind: 'initiative' | 'program' | 'project',
  fallback: string,
): Promise<{ statusId: string; status: string }> {
  const resolved = await resolveContainerStatus(orgId, kind, fallback, 'status', tx);
  return { statusId: resolved.statusId, status: resolved.status };
}

/** An initiative is matched org-wide by name; there is no narrower scope for one. */
async function placeInitiative(tx: Tx, input: PlaceInput): Promise<PlaceResult> {
  const { item, orgId } = input;
  const existing = await tx
    .select({ id: initiative.id })
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
    return {
      placed: {
        ...identityOf(item, entityHref(orgId, 'initiative', existing[0].id)),
        kind: 'initiative',
        id: existing[0].id,
        created: false,
      },
    };
  }
  const inserted = await tx
    .insert(initiative)
    .values({
      organizationId: orgId,
      ...(await containerStatus(tx, orgId, 'initiative', 'active')),
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
    placed: {
      ...identityOf(item, entityHref(orgId, 'initiative', row.id)),
      kind: 'initiative',
      id: row.id,
      created: true,
    },
    change: {
      kind: 'initiative',
      id: row.id,
      op: 'create',
      after: trackedFields('initiative', row),
    },
  };
}

/** A program is matched org-wide by name and linked to its initiative either way. */
async function placeProgram(tx: Tx, input: PlaceInput): Promise<PlaceResult> {
  const { item, at, orgId } = input;
  const existing = await tx
    .select({ id: program.id })
    .from(program)
    .where(
      and(
        eq(program.organizationId, orgId),
        isNull(program.archivedAt),
        sql`lower(${program.name}) = lower(${item.title})`,
      ),
    )
    .limit(1);
  const inserted = existing[0]
    ? []
    : await tx
        .insert(program)
        .values({
          organizationId: orgId,
          ...(await containerStatus(tx, orgId, 'program', 'active')),
          name: item.title,
          description: item.description,
          ownerId: input.ownerId,
          createdBy: input.actorId,
        })
        .returning();
  const id = existing[0]?.id ?? inserted[0]?.id;
  /* v8 ignore next -- @preserve defensive: insert always returns a row */
  if (!id) throw new Error('program insert returned no row');
  // The link is written whether or not the program was new, so re-running a plan that adds an
  // initiative over existing programs attaches them rather than doing nothing.
  if (at.initiativeId) {
    await tx
      .insert(initiativeProgram)
      .values({ organizationId: orgId, initiativeId: at.initiativeId, programId: id })
      .onConflictDoNothing();
  }
  const row = inserted[0];
  return {
    placed: {
      ...identityOf(item, entityHref(orgId, 'program', id)),
      kind: 'program',
      id,
      created: row !== undefined,
    },
    ...(row
      ? { change: { kind: 'program', id, op: 'create', after: trackedFields('program', row) } }
      : {}),
  };
}

/** A project is matched by name within its program, and linked to its initiative either way. */
async function placeProject(tx: Tx, input: PlaceInput): Promise<PlaceResult> {
  const { item, at, orgId } = input;
  const existing = await tx
    .select({ id: project.id })
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
  const inserted = existing[0]
    ? []
    : await tx
        .insert(project)
        .values({
          organizationId: orgId,
          ...(await containerStatus(tx, orgId, 'project', 'planned')),
          name: item.title,
          description: item.description,
          leadId: input.leadId,
          teamId: input.teamId,
          programId: at.programId,
          targetDate: item.targetDate ? new Date(item.targetDate) : undefined,
          createdBy: input.actorId,
        })
        .returning();
  const id = existing[0]?.id ?? inserted[0]?.id;
  /* v8 ignore next -- @preserve defensive: insert always returns a row */
  if (!id) throw new Error('project insert returned no row');
  if (at.initiativeId) {
    await tx
      .insert(initiativeProject)
      .values({ organizationId: orgId, initiativeId: at.initiativeId, projectId: id })
      .onConflictDoNothing();
  }
  const row = inserted[0];
  return {
    placed: {
      ...identityOf(item, entityHref(orgId, 'project', id)),
      kind: 'project',
      id,
      created: row !== undefined,
    },
    ...(row
      ? { change: { kind: 'project', id, op: 'create', after: trackedFields('project', row) } }
      : {}),
  };
}

/**
 * Where a task is matched: its parent task, then its project, then its program; an orphan matches
 * org-wide because there is nowhere narrower to look.
 */
function taskScope(at: Placement) {
  if (at.parentTaskId) return eq(task.parentTaskId, at.parentTaskId);
  if (at.projectId) return eq(task.projectId, at.projectId);
  if (at.programId) return eq(task.programId, at.programId);
  return and(isNull(task.projectId), isNull(task.programId), isNull(task.parentTaskId));
}

/** A task is matched by title within its scope. */
async function placeTask(tx: Tx, input: PlaceInput): Promise<PlaceResult> {
  const { item, at, orgId } = input;
  const existing = await tx
    .select()
    .from(task)
    .where(
      and(
        eq(task.organizationId, orgId),
        isNull(task.archivedAt),
        sql`lower(${task.title}) = lower(${item.title})`,
        taskScope(at),
      ),
    )
    .limit(1);
  if (existing[0]) {
    const change = await attachToMilestone(tx, existing[0], at.milestoneId);
    return {
      placed: {
        ...identityOf(item, entityHref(orgId, 'task', existing[0].id)),
        kind: 'task',
        id: existing[0].id,
        created: false,
      },
      ...(change ? { change } : {}),
    };
  }
  const inserted = await tx
    .insert(task)
    .values({
      organizationId: orgId,
      title: item.title,
      description: item.description,
      teamId: input.teamId,
      statusId: input.state.statusId,
      state: input.state.state,
      completedAt: input.state.completedAt,
      canceledAt: input.state.canceledAt,
      assigneeId: input.assigneeId,
      projectId: at.projectId,
      programId: at.programId,
      milestoneId: at.milestoneId,
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
    placed: {
      ...identityOf(item, entityHref(orgId, 'task', row.id)),
      kind: 'task',
      id: row.id,
      created: true,
    },
    change: { kind: 'task', id: row.id, op: 'create', after: trackedFields('task', row) },
  };
}

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
export async function placeItem(tx: Tx, input: PlaceInput): Promise<PlaceResult> {
  switch (input.item.kind) {
    case 'initiative':
      return placeInitiative(tx, input);
    case 'program':
      return placeProgram(tx, input);
    case 'project':
      return placeProject(tx, input);
    case 'milestone':
      return placeMilestone(tx, input);
    case 'task':
      return placeTask(tx, input);
  }
}
