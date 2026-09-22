'use client';

/**
 * A searchable list of the workspace's tasks that links the chosen one to this task.
 *
 * @remarks
 * Bound to one or more kinds of link. It opens while the page's open relationship control is one
 * of them (so the section's button and the command palette open the same search), never offers a
 * task that cannot take that link, and writes the link through the page's relationship writes.
 * `anchor` says how the child element relates to it: `trigger` makes the child open it, and
 * `anchor` only positions it, for a search opened from a menu.
 */
import { PickerList, StatusIcon } from '@docket/ui/components';
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@docket/ui/primitives';
import type { TaskDetail } from '@docket/work/task-model';
import { type JSX, type ReactElement, useCallback, useId, useMemo } from 'react';

import { useCategoryOf } from '@/components/entity-display/use-work-status';
import { OverlayErrorBanner } from '@/components/pickers/overlay-error-banner';
import type { TaskLink } from '@/lib/use-task-relations';
import { useTaskSearchOptions } from '@/lib/use-task-search-options';

import { LINK_COPY, useTaskRelationControls } from './task-relation-commands';

/**
 * The tasks a search for `link` never offers.
 *
 * @remarks
 * The task itself, anything it is already linked to by a dependency or a relation (one link per
 * pair, and never a loop), and, for the hierarchy, the tasks already above or below it.
 *
 * @param task - This task.
 * @param link - The kind of link being added.
 * @returns the ids to leave out.
 */
export function excludedFor(task: TaskDetail, link: TaskLink): ReadonlySet<string> {
  const ids = (refs: readonly { id: string }[]): string[] => refs.map((ref) => ref.id);
  if (link === 'subtask' || link === 'parent') {
    const parent = task.parentTaskId ? [task.parentTaskId] : [];
    return new Set([task.id, ...parent, ...ids(task.subtasks)]);
  }
  return new Set([
    task.id,
    ...ids(task.blockedBy),
    ...ids(task.blocking),
    ...ids(task.relatedTasks),
  ]);
}

/** Props for {@link TaskSearchPopover}. */
export interface TaskSearchPopoverProps {
  readonly task: TaskDetail;
  /** The kinds of link this search adds; it is open while the page's control is one of them. */
  readonly links: readonly [TaskLink, ...TaskLink[]];
  /** `trigger`: the child toggles the search. `anchor`: the child only positions it. */
  readonly anchor: 'trigger' | 'anchor';
  /** The element the search opens from. */
  readonly children: ReactElement;
  /** Name a project for a row's hint, or `null` for none. */
  readonly projectName?: ((projectId: string) => string | null) | undefined;
}

/**
 * Render the task search around its opener.
 *
 * @param props - See {@link TaskSearchPopoverProps}.
 * @returns the popover.
 */
export function TaskSearchPopover({
  task,
  links,
  anchor,
  children,
  projectName,
}: TaskSearchPopoverProps): JSX.Element {
  const id = useId();
  const { writes, active, owner, setActive } = useTaskRelationControls();
  const link = links.find((kind) => kind === active) ?? null;
  const open = link !== null && (owner === null || owner === id);
  // The kind the search reads as: the open one, or the first it serves while closed.
  const shown = link ?? links[0];
  const categoryOf = useCategoryOf('task');
  const iconFor = useCallback(
    (state: string | null) => <StatusIcon type={categoryOf(state ?? '')} />,
    [categoryOf],
  );
  const exclude = useMemo(() => excludedFor(task, shown), [shown, task]);
  const search = useTaskSearchOptions({
    orgId: task.organizationId,
    enabled: open,
    exclude,
    iconFor,
    projectName,
  });
  const close = (): void => {
    if (open) setActive(null);
    search.setQuery('');
  };
  const clearsParent = open && link === 'parent' ? task.parentTaskId : null;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) setActive(shown, id);
        else close();
      }}
    >
      {anchor === 'trigger' ? (
        <PopoverTrigger asChild>{children}</PopoverTrigger>
      ) : (
        <PopoverAnchor asChild>{children}</PopoverAnchor>
      )}
      <PopoverContent width="lg" align="end">
        {search.error ? <OverlayErrorBanner title={search.error} /> : null}
        <PickerList
          options={search.options}
          selected={null}
          onSelect={(taskId) => {
            const picked = search.refFor(taskId);
            if (picked) writes.link(shown, picked);
            close();
          }}
          query={search.query}
          onQueryChange={search.setQuery}
          filter="none"
          loading={search.loading}
          searchPlaceholder={LINK_COPY[shown].placeholder}
          emptyText="No matching tasks"
          ariaLabel={LINK_COPY[shown].searchLabel}
          clear={
            clearsParent
              ? {
                  label: 'No parent',
                  onClear: () => {
                    writes.unlink('parent', clearsParent);
                    close();
                  },
                }
              : null
          }
        />
      </PopoverContent>
    </Popover>
  );
}
