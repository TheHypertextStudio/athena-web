/**
 * `tasks/task-action-context` — what a task action reads from its {@link ActionContext}.
 *
 * @remarks
 * Pure helpers shared by the task domain's actions (`task-actions.ts` and the actions it spreads
 * in from sibling modules): which tasks the invocation names, where the first one lives, whether
 * they are all complete, and the relation subjects a command port takes.
 */
import type { RelationEndpoint } from '@docket/work/relation-contract';

import { type ActionContext, objectHref, objectMetaString } from '@/lib/actions';
import type { CategoryOfState } from '@/lib/work-category';

/** A task as a relation command's subject. */
export interface TaskRelationSubject extends RelationEndpoint {
  readonly kind: 'task';
}

/** Every task the context names, or an empty list when it names none. */
export function taskIds(context: ActionContext): readonly string[] {
  return context.objects.filter((o) => o.kind === 'task').map((o) => o.id);
}

/**
 * The first task's detail path, or `null` when the context names none.
 *
 * @remarks
 * Through {@link objectHref} so Open, Copy link, and a copied row can never disagree about where a
 * task lives. The workspace falls back to the context's, because a row may carry the object without
 * an org while the invocation always knows one.
 */
export function taskHref(context: ActionContext): string | null {
  const object = context.objects.find((o) => o.kind === 'task');
  if (object === undefined) return null;
  return objectHref(
    object.organizationId === null && context.organizationId !== null
      ? { ...object, organizationId: context.organizationId }
      : object,
  );
}

/**
 * Whether every task in the context already sits in a completed status.
 *
 * @remarks
 * The right-click menu carries a task's status *key* on its object payload, and a key means
 * something only against the workspace's set — so the category comes from the registry rather than
 * from a switch over five literal keys, which answered "backlog" for every renamed stage and left
 * "Mark done" offering to complete work that was already complete.
 */
export function allComplete(context: ActionContext, categoryOf: CategoryOfState): boolean {
  const tasks = context.objects.filter((o) => o.kind === 'task');
  if (tasks.length === 0) return false;
  return tasks.every((o) => {
    const state = objectMetaString(o, 'state');
    return state !== null && categoryOf(state) === 'completed';
  });
}

/** The context's tasks as relation subjects in one workspace, each carrying its title. */
export function taskSubjects(
  context: ActionContext,
  organizationId: string,
): readonly TaskRelationSubject[] {
  return context.objects.flatMap((object) =>
    object.kind === 'task'
      ? [
          {
            kind: 'task' as const,
            id: object.id,
            organizationId,
            meta: { ...object.meta, title: object.title },
          },
        ]
      : [],
  );
}
