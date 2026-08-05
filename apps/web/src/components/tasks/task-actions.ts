'use client';

/**
 * `components/tasks/task-actions` — the one module that declares what can be done to a task.
 *
 * @remarks
 * The action registry and the app-wide right-click menu were both built and then left with nothing
 * plugged into them: no domain had ever called `register`, and no surface had ever stamped
 * {@link objectTargetProps}, so right-clicking anything in Docket produced the browser's own menu.
 * This is the first registration, and it is deliberately the *whole* task domain rather than a
 * graph-specific menu — the point of the registry is that a surface contributes an object and a
 * domain contributes actions, so a task's menu is identical on the canvas, in a list, and anywhere
 * it appears later.
 *
 * ## Why the definitions are memoized rather than module-level
 *
 * {@link ActionRegistry.register} replaces a domain's bucket and throws in development if the same
 * domain arrives with a *different* array, which makes a stable identity part of the contract.
 * These definitions need the router and the query client, neither of which exists at module scope,
 * so they are built once in a memo over dependencies React itself keeps stable. The array is
 * therefore identical on every re-render, and the registration effect runs exactly once.
 */
import { ArrowRight, CheckCircle2, Link, Plus, Workflow } from '@docket/ui/icons';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useMemo } from 'react';

import { api } from '@/lib/api';
import {
  type ActionContext,
  type ActionDefinition,
  defineActionDomain,
  objectMetaString,
  useRegisterActionDomain,
} from '@/lib/actions';
import { queryKeys, unwrap } from '@/lib/query';
import { stateTypeOf } from '@/lib/work-state';

/** The workflow-state keys the quick toggle moves between. */
const DONE_STATE = 'done';
const REOPEN_STATE = 'todo';

/** Every task the context names, or an empty list when it names none. */
function taskIds(context: ActionContext): readonly string[] {
  return context.objects.filter((o) => o.kind === 'task').map((o) => o.id);
}

/** Whether every task in the context already sits in a completed state. */
function allComplete(context: ActionContext): boolean {
  const tasks = context.objects.filter((o) => o.kind === 'task');
  if (tasks.length === 0) return false;
  return tasks.every((o) => {
    const state = objectMetaString(o, 'state');
    return state !== null && stateTypeOf(state) === 'completed';
  });
}

/**
 * Register the task domain for as long as the caller is mounted.
 *
 * @remarks
 * A hook rather than a component: registration is an effect, not UI, and wrapping it in a
 * `null`-returning element would put a thing in the render tree that never renders. The app shell
 * calls this because it is the outermost piece of real UI living under the action registry.
 */
export function useRegisterTaskActions(): void {
  const router = useRouter();
  const queryClient = useQueryClient();

  const definitions = useMemo<readonly ActionDefinition[]>(() => {
    /** Invalidate everything that shows a task after a write. */
    const refresh = (orgId: string, id: string): void => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.task(orgId, id) });
      void queryClient.invalidateQueries({ queryKey: ['org', orgId, 'task-graph'] });
      void queryClient.invalidateQueries({ queryKey: ['org', orgId, 'tasks'] });
    };

    return defineActionDomain('task', [
      {
        id: 'task.open',
        label: 'Open task',
        icon: ArrowRight,
        objectKinds: ['task'],
        section: 'primary',
        keywords: ['view', 'detail', 'go to'],
        run: (context) => {
          const [id] = taskIds(context);
          if (id === undefined || context.organizationId === null) return;
          router.push(`/orgs/${context.organizationId}/tasks/${id}`);
        },
      },
      {
        id: 'task.toggleComplete',
        label: (context) => (allComplete(context) ? 'Reopen' : 'Mark done'),
        icon: CheckCircle2,
        objectKinds: ['task'],
        multi: true,
        section: 'primary',
        keywords: ['complete', 'finish', 'done', 'reopen'],
        run: async (context) => {
          const orgId = context.organizationId;
          if (orgId === null) return;
          const state = allComplete(context) ? REOPEN_STATE : DONE_STATE;
          for (const id of taskIds(context)) {
            await unwrap(
              () =>
                api.v1.orgs[':orgId'].tasks[':id'].state.$post({
                  param: { orgId, id },
                  json: { state },
                }),
              'Could not update the status.',
            );
            refresh(orgId, id);
          }
        },
      },
      {
        id: 'task.addSubtask',
        label: 'Add subtask',
        icon: Plus,
        objectKinds: ['task'],
        section: 'organize',
        keywords: ['child', 'break down', 'split'],
        run: async (context) => {
          const orgId = context.organizationId;
          const [id] = taskIds(context);
          if (orgId === null || id === undefined) return;
          await unwrap(
            () =>
              api.v1.orgs[':orgId'].tasks[':id'].subtasks.$post({
                param: { orgId, id },
                json: { title: 'New subtask' },
              }),
            'Could not create the subtask.',
          );
          refresh(orgId, id);
        },
      },
      {
        id: 'task.copyLink',
        label: 'Copy link',
        icon: Link,
        objectKinds: ['task'],
        section: 'share',
        keywords: ['url', 'share', 'permalink'],
        // Hidden rather than disabled where the clipboard is unavailable: an item that can never
        // work on this device is noise, and there is nothing useful to say about why.
        appliesTo: () => 'clipboard' in navigator,
        run: async (context) => {
          const [id] = taskIds(context);
          if (id === undefined || context.organizationId === null) return;
          const url = new URL(
            `/orgs/${context.organizationId}/tasks/${id}`,
            window.location.origin,
          );
          await navigator.clipboard.writeText(url.toString());
        },
      },
      {
        id: 'task.showInGraph',
        label: 'Show in dependency graph',
        icon: Workflow,
        objectKinds: ['task'],
        section: 'organize',
        keywords: ['dependencies', 'blockers', 'neighbourhood'],
        run: (context) => {
          const [id] = taskIds(context);
          if (id === undefined || context.organizationId === null) return;
          router.push(`/orgs/${context.organizationId}/graph?rootTaskId=${id}`);
        },
      },
    ]);
  }, [router, queryClient]);

  useRegisterActionDomain('task', definitions);
}
