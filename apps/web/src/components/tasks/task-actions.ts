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
import {
  ArrowRight,
  ArrowUp,
  CalendarToday,
  CheckCircle2,
  CornerDownLeft,
  Flag,
  FolderKanban,
  GanttChart,
  Layers,
  Link,
  Plus,
  Tag,
  User,
  Users,
  Workflow,
} from '@docket/ui/icons';
import {
  CalendarItemId,
  LabelId,
  OrganizationId,
  TaskId,
  TaskUpdate,
  WorkViewOrderRequest,
} from '@docket/types';
import { useQueryClient } from '@tanstack/react-query';
import { useAppRouter as useRouter } from '@/lib/interactions/navigation';
import { useCallback, useMemo } from 'react';

import { copyObjectAction } from '@/components/actions/copy-object-action';
import { useCopyOutcome } from '@/components/clipboard';
import { usePickerOverlay } from '@/components/pickers/picker-overlay';
import { useTaskHierarchyMutation } from '@/components/tasks/use-task-hierarchy-mutation';
import {
  createTaskAssociationCommandPort,
  createTaskRelationCommandPort,
  createTaskTeamRelationCommandPort,
  type PatchableTaskRelationId,
} from '@/components/tasks/task-relation-port';
import { api } from '@/lib/api';
import {
  type ActionContext,
  type ActionDefinition,
  defineActionDomain,
  objectHref,
  objectMetaString,
  type ObjectRef,
  useRegisterActionDomain,
} from '@/lib/actions';
import { useStatusRegistry } from '@/components/statuses/status-registry';
import { queryKeys, unwrap } from '@/lib/query';
import type { CategoryOfState } from '@/lib/work-category';

const RELATION_RESPONSIVENESS = {
  // The drag adapter paints and announces the accepted destination, then announces settlement.
  // No separate mutation receipt surface exists for these relation commands.
  ownership: 'autonomous',
} as const;

/** Every task the context names, or an empty list when it names none. */
function taskIds(context: ActionContext): readonly string[] {
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
function taskHref(context: ActionContext): string | null {
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
function allComplete(context: ActionContext, categoryOf: CategoryOfState): boolean {
  const tasks = context.objects.filter((o) => o.kind === 'task');
  if (tasks.length === 0) return false;
  return tasks.every((o) => {
    const state = objectMetaString(o, 'state');
    return state !== null && categoryOf(state) === 'completed';
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
  const pickerOverlay = usePickerOverlay();
  const reportOutcome = useCopyOutcome();
  const statuses = useStatusRegistry();
  const { reparent: reparentHierarchy } = useTaskHierarchyMutation();

  const categoryOf = useCallback<CategoryOfState>(
    (state) => statuses.categoryOf('task', state),
    [statuses],
  );

  const definitions = useMemo<readonly ActionDefinition[]>(() => {
    /** Invalidate everything that shows a task after a write. */
    const refresh = (orgId: string, id: string): void => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.task(orgId, id) });
      void queryClient.invalidateQueries({ queryKey: ['org', orgId, 'task-graph'] });
      void queryClient.invalidateQueries({ queryKey: ['org', orgId, 'tasks'] });
    };
    const relationPort = createTaskRelationCommandPort({
      patchTask: async (organizationId, taskId, patch) => {
        await unwrap(
          () =>
            api.v1.orgs[':orgId'].tasks[':id'].$patch({
              param: { orgId: organizationId, id: taskId },
              json: TaskUpdate.parse(patch),
            }),
          'Could not change where this task belongs.',
        );
        refresh(organizationId, taskId);
      },
    });
    const teamPort = createTaskTeamRelationCommandPort({
      moveTaskToTeam: async (organizationId, taskId, teamId) => {
        await unwrap(
          () =>
            api.v1.orgs[':orgId']['work-views'].order.$patch({
              param: { orgId: organizationId },
              json: WorkViewOrderRequest.parse({
                target: 'task',
                itemId: taskId,
                context: { kind: 'organization' },
                groupField: 'team',
                groupValue: teamId,
                beforeId: null,
                afterId: null,
              }),
            }),
          'Could not move this task to the team.',
        );
        refresh(organizationId, taskId);
      },
    });
    const associationPort = createTaskAssociationCommandPort({
      reparent: (organizationId, moves) => {
        reparentHierarchy({ organizationId, moves, preserveSelectedSubtrees: true });
      },
      addDependency: async (organizationId, blockingTaskId, blockedTaskId) => {
        await unwrap(
          () =>
            api.v1.orgs[':orgId'].tasks[':id'].dependencies.$post({
              param: { orgId: organizationId, id: blockingTaskId },
              json: { blockedTaskId },
            }),
          'Could not create the task dependency.',
        );
        refresh(organizationId, blockingTaskId);
        refresh(organizationId, blockedTaskId);
        return 'applied';
      },
      addLabel: async (organizationId, taskId, labelId) => {
        const detail = await unwrap(
          () =>
            api.v1.orgs[':orgId'].tasks[':id'].$get({
              param: { orgId: organizationId, id: taskId },
            }),
          'Could not load the task labels.',
        );
        const labels = detail.labels.map((label) => label.id);
        const parsedLabelId = LabelId.parse(labelId);
        if (labels.includes(parsedLabelId)) return 'unchanged';
        await unwrap(
          () =>
            api.v1.orgs[':orgId'].tasks[':id'].$patch({
              param: { orgId: organizationId, id: taskId },
              json: TaskUpdate.parse({ labels: [...labels, parsedLabelId] }),
            }),
          'Could not add the label.',
        );
        refresh(organizationId, taskId);
        return 'applied';
      },
      linkCalendarItem: async (organizationId, taskId, calendarItemId) => {
        await unwrap(
          () =>
            api.v1.me.calendar.items[':id'].tasks.$post({
              param: { id: CalendarItemId.parse(calendarItemId) },
              json: {
                mode: 'link',
                taskId: TaskId.parse(taskId),
                organizationId: OrganizationId.parse(organizationId),
                role: 'related',
              },
            }),
          'Could not link the task to the calendar item.',
        );
        void queryClient.invalidateQueries({ queryKey: queryKeys.calendarItem(calendarItemId) });
        return 'applied';
      },
      scheduleCalendarSlot: async (organizationId, taskId, title, startsAt, endsAt) => {
        const created = await unwrap(
          () =>
            api.v1.me.calendar.items.$post({
              json: { intent: 'timebox', title, startsAt, endsAt },
            }),
          'Could not schedule the task.',
        );
        await unwrap(
          () =>
            api.v1.me.calendar.items[':id'].tasks.$post({
              param: { id: created.id },
              json: {
                mode: 'link',
                taskId: TaskId.parse(taskId),
                organizationId: OrganizationId.parse(organizationId),
                role: 'contained',
              },
            }),
          'The time block was created, but the task could not be linked.',
        );
        void queryClient.invalidateQueries({ queryKey: queryKeys.calendarLayers() });
        return 'applied';
      },
    });
    const taskSubjects = (context: ActionContext, organizationId: string) =>
      context.objects.flatMap((object) =>
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
    const executeRelation = async (
      context: ActionContext,
      relationId: PatchableTaskRelationId,
      targetKind: 'project' | 'program' | 'cycle' | 'milestone' | 'actor',
    ): Promise<void> => {
      const target = context.target;
      const organizationId = context.organizationId;
      if (target?.kind !== targetKind || organizationId === null) return;
      const subjects = taskSubjects(context, organizationId);
      if (subjects.length === 0) return;
      await relationPort.execute({
        relationId,
        effect: 'move',
        subjects,
        target: {
          kind: targetKind,
          id: target.id,
          organizationId,
          ...(target.meta === undefined ? {} : { meta: target.meta }),
        },
      });
    };
    const executeTeamRelation = async (context: ActionContext): Promise<void> => {
      const target = context.target;
      const organizationId = context.organizationId;
      if (organizationId === null) return;
      if (target === undefined) {
        pickerOverlay.open({
          kind: 'relation-target',
          relationId: 'task.team',
          organizationId,
          subjects: context.objects,
        });
        return;
      }
      if (target.kind !== 'team') return;
      const subjects = taskSubjects(context, organizationId);
      if (subjects.length === 0) return;
      await teamPort.execute({
        relationId: 'task.team',
        effect: 'move',
        subjects,
        target: { kind: 'team', id: target.id, organizationId },
      });
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
          const href = taskHref(context);
          if (href !== null) router.push(href);
        },
      },
      {
        id: 'task.toggleComplete',
        responsiveness: {
          ownership: 'root',
          interactionId: 'app.mutation',
          category: 'mutation',
          routeTemplateId: '/tasks/[taskId]',
        } as const,
        label: (context) => (allComplete(context, categoryOf) ? 'Reopen' : 'Mark done'),
        icon: CheckCircle2,
        objectKinds: ['task'],
        multi: true,
        section: 'primary',
        keywords: ['complete', 'finish', 'done', 'reopen'],
        run: async (context) => {
          const orgId = context.organizationId;
          if (orgId === null) return;
          // "Mark done" and "Reopen" name outcomes; the workspace's set decides which status each
          // outcome lands on, so a workspace that ships under `Shipped` gets `Shipped`.
          const target = allComplete(context, categoryOf)
            ? statuses.defaultOf('task')
            : statuses.firstOfCategory('task', 'completed');
          if (target === undefined) return;
          const state = target.key;
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
        responsiveness: {
          ownership: 'root',
          interactionId: 'app.mutation',
          category: 'mutation',
          routeTemplateId: '/tasks/[taskId]',
        } as const,
        label: 'Create subtask',
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
        id: 'task.makeSubtaskOf',
        relationId: 'task.parent',
        responsiveness: RELATION_RESPONSIVENESS,
        label: 'Make subtask of…',
        icon: CornerDownLeft,
        objectKinds: ['task'],
        multi: true,
        section: 'organize',
        keywords: ['parent', 'nest', 'move under'],
        run: async (context) => {
          if (context.organizationId === null) return;
          const subjects = context.objects.filter(
            (object): object is ObjectRef & { readonly kind: 'task' } => object.kind === 'task',
          );
          if (subjects.length === 0) return;
          if (context.target?.kind === 'task') {
            await associationPort.execute({
              relationId: 'task.parent',
              effect: 'move',
              subjects: taskSubjects(context, context.organizationId),
              target: {
                kind: 'task',
                id: context.target.id,
                organizationId: context.organizationId,
                ...(context.target.meta === undefined ? {} : { meta: context.target.meta }),
              },
            });
            return;
          }
          pickerOverlay.open({
            kind: 'task-hierarchy',
            organizationId: context.organizationId,
            subjects,
          });
        },
      },
      {
        id: 'task.moveToTopLevel',
        label: 'Move to top level',
        icon: ArrowUp,
        objectKinds: ['task'],
        multi: true,
        section: 'organize',
        keywords: ['detach', 'remove parent', 'unnest'],
        appliesTo: (context) =>
          context.objects.some(
            (object) => object.kind === 'task' && objectMetaString(object, 'parentTaskId') !== null,
          ),
        run: (context) => {
          const organizationId = context.organizationId;
          if (organizationId === null) return;
          const moves = context.objects
            .filter(
              (object) =>
                object.kind === 'task' && objectMetaString(object, 'parentTaskId') !== null,
            )
            .map(({ id }) => ({ taskId: id, parentTaskId: null }));
          if (moves.length === 0) return;
          reparentHierarchy({
            organizationId,
            moves,
            preserveSelectedSubtrees: true,
          });
        },
      },
      {
        id: 'task.moveToProject',
        relationId: 'task.project',
        responsiveness: RELATION_RESPONSIVENESS,
        label: 'Move to project…',
        icon: FolderKanban,
        objectKinds: ['task'],
        multi: true,
        section: 'organize',
        keywords: ['file', 'project'],
        run: async (context) => {
          if (context.target?.kind === 'project') {
            await executeRelation(context, 'task.project', 'project');
            return;
          }
          if (context.organizationId === null) return;
          pickerOverlay.open({
            kind: 'relation-target',
            relationId: 'task.project',
            organizationId: context.organizationId,
            subjects: context.objects,
          });
        },
      },
      {
        id: 'task.moveToProgram',
        relationId: 'task.program',
        responsiveness: RELATION_RESPONSIVENESS,
        label: 'Move to program…',
        icon: Layers,
        objectKinds: ['task'],
        multi: true,
        section: 'organize',
        keywords: ['file', 'program'],
        run: async (context) => {
          if (context.target?.kind === 'program') {
            await executeRelation(context, 'task.program', 'program');
            return;
          }
          if (context.organizationId === null) return;
          pickerOverlay.open({
            kind: 'relation-target',
            relationId: 'task.program',
            organizationId: context.organizationId,
            subjects: context.objects,
          });
        },
      },
      {
        id: 'task.moveToTeam',
        relationId: 'task.team',
        responsiveness: RELATION_RESPONSIVENESS,
        label: 'Move to team',
        icon: Users,
        objectKinds: ['task'],
        multi: true,
        section: 'organize',
        run: executeTeamRelation,
      },
      {
        id: 'task.commitToCycle',
        relationId: 'task.cycle',
        responsiveness: RELATION_RESPONSIVENESS,
        label: 'Commit to cycle',
        icon: GanttChart,
        objectKinds: ['task'],
        multi: true,
        section: 'organize',
        run: async (context) => {
          if (context.target === undefined && context.organizationId !== null) {
            pickerOverlay.open({
              kind: 'relation-target',
              relationId: 'task.cycle',
              organizationId: context.organizationId,
              subjects: context.objects,
            });
            return;
          }
          if (context.target?.kind === 'cycle') {
            await executeRelation(context, 'task.cycle', 'cycle');
          }
        },
      },
      {
        id: 'task.setMilestone',
        relationId: 'task.milestone',
        responsiveness: RELATION_RESPONSIVENESS,
        label: 'Set milestone',
        icon: Flag,
        objectKinds: ['task'],
        multi: true,
        section: 'organize',
        run: async (context) => {
          if (context.target === undefined && context.organizationId !== null) {
            pickerOverlay.open({
              kind: 'relation-target',
              relationId: 'task.milestone',
              organizationId: context.organizationId,
              subjects: context.objects,
            });
            return;
          }
          if (context.target?.kind === 'milestone') {
            await executeRelation(context, 'task.milestone', 'milestone');
          }
        },
      },
      {
        id: 'task.assign',
        relationId: 'task.assignee',
        responsiveness: RELATION_RESPONSIVENESS,
        label: 'Assign',
        icon: User,
        objectKinds: ['task'],
        multi: true,
        section: 'organize',
        run: async (context) => {
          if (context.target === undefined && context.organizationId !== null) {
            pickerOverlay.open({
              kind: 'relation-target',
              relationId: 'task.assignee',
              organizationId: context.organizationId,
              subjects: context.objects,
            });
            return;
          }
          if (context.target?.kind === 'actor') {
            await executeRelation(context, 'task.assignee', 'actor');
          }
        },
      },
      {
        id: 'task.blocks',
        relationId: 'task.blocks',
        responsiveness: RELATION_RESPONSIVENESS,
        label: 'Create dependency',
        icon: Workflow,
        objectKinds: ['task'],
        multi: false,
        section: 'organize',
        run: async (context) => {
          const relationTarget = context.target;
          if (relationTarget === undefined && context.organizationId !== null) {
            pickerOverlay.open({
              kind: 'relation-target',
              relationId: 'task.blocks',
              organizationId: context.organizationId,
              subjects: context.objects,
            });
            return;
          }
          if (relationTarget?.kind !== 'task' || context.organizationId === null) return;
          await associationPort.execute({
            relationId: 'task.blocks',
            effect: 'link',
            subjects: taskSubjects(context, context.organizationId),
            target: {
              kind: 'task',
              id: relationTarget.id,
              organizationId: context.organizationId,
            },
          });
        },
      },
      {
        id: 'task.label',
        relationId: 'task.label',
        responsiveness: RELATION_RESPONSIVENESS,
        label: 'Labels…',
        icon: Tag,
        objectKinds: ['task'],
        multi: true,
        section: 'organize',
        shortcutHint: 'L',
        keywords: ['tag', 'tags'],
        run: async (context) => {
          if (context.organizationId === null) return;
          const relationTarget = context.target;
          if (relationTarget?.kind === 'label') {
            await associationPort.execute({
              relationId: 'task.label',
              effect: 'link',
              subjects: taskSubjects(context, context.organizationId),
              target: {
                kind: 'label',
                id: relationTarget.id,
                organizationId: context.organizationId,
              },
            });
            return;
          }
          pickerOverlay.open({
            kind: 'labels',
            organizationId: context.organizationId,
            objects: context.objects,
          });
        },
      },
      {
        id: 'task.linkCalendarItem',
        relationId: 'task.calendar-item',
        responsiveness: RELATION_RESPONSIVENESS,
        label: 'Link to calendar item',
        icon: CalendarToday,
        objectKinds: ['task'],
        multi: false,
        section: 'organize',
        run: async (context) => {
          if (context.target === undefined) {
            pickerOverlay.open({
              kind: 'relation-target',
              relationId: 'task.calendar-item',
              organizationId: context.organizationId,
              subjects: context.objects,
            });
            return;
          }
          if (
            (context.target.kind !== 'calendar_event' && context.target.kind !== 'time_block') ||
            context.organizationId === null
          )
            return;
          await associationPort.execute({
            relationId: 'task.calendar-item',
            effect: 'link',
            subjects: taskSubjects(context, context.organizationId),
            target: {
              kind: 'calendar_item',
              id: context.target.id,
              organizationId: null,
            },
          });
        },
      },
      {
        id: 'task.scheduleCalendarSlot',
        relationId: 'task.calendar-slot',
        responsiveness: RELATION_RESPONSIVENESS,
        label: 'Schedule on calendar',
        icon: CalendarToday,
        objectKinds: ['task'],
        multi: false,
        section: 'organize',
        run: async (context) => {
          const target = context.target;
          if (target === undefined) {
            pickerOverlay.open({
              kind: 'relation-target',
              relationId: 'task.calendar-slot',
              organizationId: context.organizationId,
              subjects: context.objects,
            });
            return;
          }
          const startsAt = target.meta?.['startsAt'];
          const endsAt = target.meta?.['endsAt'];
          if (
            target.kind !== 'calendar_slot' ||
            context.organizationId === null ||
            typeof startsAt !== 'string' ||
            typeof endsAt !== 'string'
          )
            return;
          await associationPort.execute({
            relationId: 'task.calendar-slot',
            effect: 'copy',
            subjects: taskSubjects(context, context.organizationId),
            target: {
              kind: 'calendar_slot',
              id: target.id,
              organizationId: null,
              meta: { startsAt, endsAt },
            },
          });
        },
      },
      {
        id: 'task.copyLink',
        responsiveness: {
          ownership: 'root',
          interactionId: 'app.mutation',
          category: 'mutation',
          routeTemplateId: '/tasks/[taskId]',
        } as const,
        label: 'Copy link',
        icon: Link,
        objectKinds: ['task'],
        section: 'share',
        keywords: ['url', 'share', 'permalink'],
        // Hidden rather than disabled where the clipboard is unavailable: an item that can never
        // work on this device is noise, and there is nothing useful to say about why.
        appliesTo: () => 'clipboard' in navigator,
        run: async (context) => {
          const href = taskHref(context);
          if (href === null) return;
          await navigator.clipboard.writeText(new URL(href, window.location.origin).toString());
        },
      },
      copyObjectAction('task', reportOutcome),
      {
        id: 'task.showInGraph',
        label: 'Show in Task graph',
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
  }, [router, queryClient, pickerOverlay, reportOutcome, statuses, categoryOf, reparentHierarchy]);

  useRegisterActionDomain('task', definitions);
}
