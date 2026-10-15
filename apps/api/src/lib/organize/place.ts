import type { RecordedOrigin } from '@docket/work/provenance-contract';
import type { OrdinaryWorkMutation } from '../work-creation/types';
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
import { initiativeProgram, initiativeProject } from '@docket/db';
import { Priority } from '@docket/work/task-contract';
import { InitiativePriority } from '@docket/work/initiative-contract';
import { z } from 'zod';

import { ValidationError } from '../../error';
import { type ChangeRecord, type LinkRecord } from '../../mcp/change-set';
import { resolveOptional } from '../../mcp/descriptors';
import type { serializableTx } from '../serializable-tx';
import { resolveItemMilestone } from './place-milestone';
import { type OrganizeItem, type Kind } from './item';
export { KINDS, OrganizeItem, MAX_ITEMS, type Kind } from './item';

/** Which parent kinds each kind may sit under, in this call or already in the workspace. */
const ALLOWED_PARENTS: Record<Kind, readonly Kind[]> = {
  initiative: [],
  program: ['initiative'],
  project: ['program', 'initiative'],
  milestone: ['project'],
  task: ['project', 'milestone', 'program', 'task'],
};

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
  /** The saved Markdown for newly created work; matched rows are never overwritten. */
  readonly description?: string | null | undefined;
  /** The template selected for this creation, when any. */
  readonly templateId?: string | undefined;
  readonly workTypeId?: string | undefined;
  readonly workTypeVersionId?: string | undefined;
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
    const schema = item.kind === 'initiative' ? InitiativePriority : Priority;
    if (!schema.safeParse(item.priority).success) {
      reject(`items.${index}.priority`, item.priority, 'Not a valid priority.', schema.options);
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
  readonly origin?: RecordedOrigin;
  readonly orgId: string;
  readonly actorId: string;
  readonly item: OrganizeItem;
  /** Resolved template attribution for new tasks. */
  readonly templateId?: string | undefined;
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
  /** Complete unrecorded creation for the enclosing single receipt and post-commit drain. */
  readonly creation?: OrdinaryWorkMutation;
  readonly placed: Placed;
  readonly change?: ChangeRecord;
  /** The initiative link the placement added, so undo can take it back. */
  readonly link?: LinkRecord;
}

/**
 * Link a placed project or program to its initiative, and say whether the link is new.
 *
 * @remarks
 * Written whether or not the item itself was new, so re-running a plan that adds an initiative over
 * existing work attaches it rather than doing nothing. Only a link this call added is recorded: one
 * that already stood is not this call's to take back.
 */
export async function linkToInitiative(
  tx: Tx,
  kind: 'project' | 'program',
  orgId: string,
  initiativeId: string | null,
  id: string,
): Promise<{ link?: LinkRecord }> {
  if (initiativeId === null) return {};
  const inserted =
    kind === 'project'
      ? await tx
          .insert(initiativeProject)
          .values({ organizationId: orgId, initiativeId, projectId: id })
          .onConflictDoNothing()
          .returning({ id: initiativeProject.projectId })
      : await tx
          .insert(initiativeProgram)
          .values({ organizationId: orgId, initiativeId, programId: id })
          .onConflictDoNothing()
          .returning({ id: initiativeProgram.programId });
  if (inserted.length === 0) return {};
  return { link: { kind: `${kind}_contributes_to`, from: id, to: initiativeId, linked: true } };
}
