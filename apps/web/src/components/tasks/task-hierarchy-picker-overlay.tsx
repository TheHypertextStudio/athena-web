'use client';

/** Searchable parent-task picker shared by task menus, bulk actions, and touch interaction. */
import { PickerList, type PickerOption } from '@docket/ui/components';
import { ListChecks } from '@docket/ui/icons';
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  type PopoverVirtualAnchor,
  Skeleton,
} from '@docket/ui/primitives';
import { type JSX, useCallback, useMemo, useRef } from 'react';

import {
  capturePickerAnchor,
  type TaskHierarchyPickerRequest,
} from '@/components/pickers/picker-overlay';
import { createTaskHierarchy } from '@/components/tasks/task-hierarchy-model';
import { useTaskHierarchyMutation } from '@/components/tasks/use-task-hierarchy-mutation';
import { api } from '@/lib/api';
import { userErrorMessage } from '@/lib/problem';
import { apiQueryOptions, queryKeys, STALE, useApiListQuery } from '@/lib/query';

/** Props for {@link TaskHierarchyPickerOverlay}. */
export interface TaskHierarchyPickerOverlayProps {
  readonly request: TaskHierarchyPickerRequest;
  readonly onClose: () => void;
}

/** Choose an active same-workspace task to become the selected task roots' parent. */
export function TaskHierarchyPickerOverlay({
  request,
  onClose,
}: TaskHierarchyPickerOverlayProps): JSX.Element {
  const organizationId = request.organizationId;
  const tasksQ = useApiListQuery(
    apiQueryOptions(
      queryKeys.tasks(organizationId),
      () => api.v1.orgs[':orgId'].tasks.$get({ param: { orgId: organizationId }, query: {} }),
      'Could not load tasks.',
      { staleTime: STALE.volatile },
    ),
  );
  const projectsQ = useApiListQuery(
    apiQueryOptions(
      queryKeys.projects(organizationId),
      () => api.v1.orgs[':orgId'].projects.$get({ param: { orgId: organizationId }, query: {} }),
      'Could not load projects.',
      { staleTime: STALE.static },
    ),
  );
  const teamsQ = useApiListQuery(
    apiQueryOptions(
      queryKeys.teams(organizationId),
      () => api.v1.orgs[':orgId'].teams.$get({ param: { orgId: organizationId } }),
      'Could not load teams.',
      { staleTime: STALE.static },
    ),
  );
  const hierarchyMutation = useTaskHierarchyMutation();
  const tasks = useMemo(() => tasksQ.data?.items ?? [], [tasksQ.data]);
  const selectedIds = useMemo(() => request.subjects.map(({ id }) => id), [request.subjects]);
  const options = useMemo<readonly PickerOption[]>(() => {
    const hierarchy = createTaskHierarchy(tasks);
    const projectNames = new Map(
      (projectsQ.data?.items ?? []).map((project) => [project.id, project.name]),
    );
    const teamNames = new Map((teamsQ.data?.items ?? []).map((team) => [team.id, team.name]));
    return hierarchy.validParentCandidates(selectedIds).map((task) => {
      const context = [
        task.projectId ? projectNames.get(task.projectId) : null,
        teamNames.get(task.teamId),
      ].filter((value): value is string => Boolean(value));
      return {
        value: task.id,
        label: task.title,
        icon: <ListChecks aria-hidden className="size-5" />,
        supporting: context.length > 0 ? context.join(' · ') : undefined,
      };
    });
  }, [projectsQ.data, selectedIds, tasks, teamsQ.data]);

  const capturedAnchor = useRef(
    capturePickerAnchor(
      request.anchor ??
        (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null),
    ),
  ).current;
  const anchorRef = useRef<PopoverVirtualAnchor | null>(capturedAnchor.virtual);
  const closedRef = useRef(false);
  const close = useCallback(() => {
    if (closedRef.current) return;
    closedRef.current = true;
    if (capturedAnchor.focusTarget?.isConnected) capturedAnchor.focusTarget.focus();
    onClose();
  }, [capturedAnchor, onClose]);
  const readError = tasksQ.error ?? projectsQ.error ?? teamsQ.error;
  const isPending = tasksQ.isPending || projectsQ.isPending || teamsQ.isPending;
  const count = request.subjects.length;

  return (
    <Popover
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <PopoverAnchor virtualRef={anchorRef} />
      <PopoverContent
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (capturedAnchor.focusTarget?.isConnected) capturedAnchor.focusTarget.focus();
        }}
      >
        {readError ? (
          <div
            role="alert"
            className="text-error bg-error/5 border-error/30 text-body-medium m-1 rounded-md border px-3 py-2"
          >
            {userErrorMessage(readError, 'Could not load tasks.')}
          </div>
        ) : isPending ? (
          <div className="flex flex-col gap-1.5 p-1.5" aria-hidden="true">
            <Skeleton className="h-10 w-full rounded-md" />
            <Skeleton className="h-10 w-full rounded-md" />
            <Skeleton className="h-10 w-full rounded-md" />
          </div>
        ) : (
          <PickerList
            options={options}
            selected={null}
            onSelect={(parentTaskId) => {
              hierarchyMutation.reparent({
                organizationId,
                moves: selectedIds.map((taskId) => ({ taskId, parentTaskId })),
                preserveSelectedSubtrees: true,
              });
              close();
            }}
            searchPlaceholder={count === 1 ? 'Choose a parent task…' : `Move ${count} tasks under…`}
            emptyText="No valid parent tasks"
            ariaLabel={count === 1 ? 'Parent task' : `Parent for ${count} tasks`}
            clear={null}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}
