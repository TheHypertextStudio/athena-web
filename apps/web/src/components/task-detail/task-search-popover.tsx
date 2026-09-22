'use client';

/**
 * A searchable list of the workspace's tasks, opened from a task page control: add a blocker, a
 * blocked task, a related task, an existing subtask, or choose the task's parent.
 *
 * @remarks
 * The popover is controlled, so a menu item can open it against a button it does not own. `anchor`
 * says how the child element relates to it: `trigger` makes the child open and close it, and
 * `anchor` only positions it (the Relations menu opens it after a choice). Tasks named in
 * `exclude` are never offered.
 */
import { PickerList, StatusIcon } from '@docket/ui/components';
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@docket/ui/primitives';
import type { TaskRef } from '@docket/work/task-model';
import { type JSX, type ReactElement, useCallback } from 'react';

import { useCategoryOf } from '@/components/entity-display/use-work-status';
import { OverlayErrorBanner } from '@/components/pickers/overlay-error-banner';
import { useTaskSearchOptions } from '@/lib/use-task-search-options';

/** Props for {@link TaskSearchPopover}. */
export interface TaskSearchPopoverProps {
  readonly orgId: string;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** The element the popover opens from. */
  readonly children: ReactElement;
  /** `trigger`: the child toggles the popover. `anchor`: the child only positions it. */
  readonly anchor: 'trigger' | 'anchor';
  /** Task ids never offered. */
  readonly exclude: ReadonlySet<string>;
  /** Receive the chosen task. */
  readonly onPick: (task: TaskRef) => void;
  /** Name the project a row's task belongs to, or `null` for no hint. */
  readonly projectName?: ((projectId: string) => string | null) | undefined;
  readonly searchPlaceholder: string;
  readonly ariaLabel: string;
  /** A "clear" row (e.g. "No parent"). Omit to offer none. */
  readonly clear?: { readonly label: string; readonly onClear: () => void } | undefined;
}

/**
 * Render the task search popover around its opener.
 *
 * @param props - See {@link TaskSearchPopoverProps}.
 * @returns the popover.
 */
export function TaskSearchPopover({
  orgId,
  open,
  onOpenChange,
  children,
  anchor,
  exclude,
  onPick,
  projectName,
  searchPlaceholder,
  ariaLabel,
  clear,
}: TaskSearchPopoverProps): JSX.Element {
  const categoryOf = useCategoryOf('task');
  const iconFor = useCallback(
    (state: string | null) => <StatusIcon type={categoryOf(state ?? '')} />,
    [categoryOf],
  );
  const search = useTaskSearchOptions({ orgId, enabled: open, exclude, iconFor, projectName });
  const close = (): void => {
    onOpenChange(false);
    search.setQuery('');
  };
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) onOpenChange(true);
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
            const task = search.refFor(taskId);
            if (task) onPick(task);
            close();
          }}
          query={search.query}
          onQueryChange={search.setQuery}
          filter="none"
          loading={search.loading}
          searchPlaceholder={searchPlaceholder}
          emptyText="No matching tasks"
          ariaLabel={ariaLabel}
          clear={
            clear
              ? {
                  label: clear.label,
                  onClear: () => {
                    clear.onClear();
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
