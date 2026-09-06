'use client';

/**
 * `calendar/item-drawer/linked-task-row` — one piece of work attached to an event.
 *
 * @remarks
 * Rows sit on a tonal step rather than inside a drawn box. A border that only groups is the wrong
 * separator (`docs/design/design-system.md` §8), and a stack of outlined rows read as a stack of
 * cards competing with the event they belong to.
 */
import type { CalendarItemLinkedTaskOut } from '@docket/planning/calendar-contract';
import { cn } from '@docket/ui/lib/utils';
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@docket/ui/primitives';
import { type JSX, useState } from 'react';

import { EditableTitle } from '@/components/editor/editable-title';
import { api } from '@/lib/api';
import { apiQueryOptions, queryKeys, STALE, useApiListQuery } from '@/lib/query';
import { useOrgCapability } from '@/lib/use-org-capability';
import { useRenameTask } from '@/lib/use-rename-task';

import { useDetachTaskFromItem } from '../calendar-mutations';
import { CANCEL_CLASS, DESTRUCTIVE_CONFIRM_CLASS } from './presentation';

/** Props for {@link LinkedTaskRow}. */
export interface LinkedTaskRowProps {
  /** The calendar item the task is attached to. */
  itemId: string;
  /** The link being rendered. */
  link: CalendarItemLinkedTaskOut;
  /** Navigate to the task's own page. */
  onOpenTask: (orgId: string, taskId: string) => void;
}

/** One linked task: rename in place, open, or detach. */
export function LinkedTaskRow({ itemId, link, onOpenTask }: LinkedTaskRowProps): JSX.Element {
  const detach = useDetachTaskFromItem(itemId, link.taskId);
  const [confirming, setConfirming] = useState(false);

  // Linked tasks can belong to any workspace, so the viewer's edit capability is resolved per row's
  // org; React Query dedupes these fetches by key. A rename refreshes the calendar item's cache so
  // its linked-task titles re-render.
  const membersQ = useApiListQuery(
    apiQueryOptions(
      queryKeys.members(link.organizationId),
      () => api.v1.orgs[':orgId'].members.$get({ param: { orgId: link.organizationId } }),
      'Could not load members.',
      { staleTime: STALE.static },
    ),
  );
  const rolesQ = useApiListQuery(
    apiQueryOptions(
      queryKeys.roles(link.organizationId),
      () => api.v1.orgs[':orgId'].roles.$get({ param: { orgId: link.organizationId } }),
      'Could not load roles.',
      { staleTime: STALE.static },
    ),
  );
  const canEdit = useOrgCapability(
    membersQ.data?.items ?? [],
    rolesQ.data?.items ?? [],
    'contribute',
  );
  const rename = useRenameTask(link.organizationId, [queryKeys.calendarItem(itemId)]);

  const titleClass = cn(
    'text-body-medium min-w-0 flex-1 truncate text-left',
    link.done ? 'text-on-surface-variant line-through' : 'text-on-surface',
  );

  return (
    <div className="hover:bg-surface-container-high group flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors">
      {canEdit ? (
        <EditableTitle
          value={link.title}
          onSave={(title) => {
            rename(link.taskId, title);
          }}
          canEdit
          activate="doubleClick"
          onActivate={() => {
            onOpenTask(link.organizationId, link.taskId);
          }}
          ariaLabel="Task title"
          className={titleClass}
        />
      ) : (
        <button
          type="button"
          onClick={() => {
            onOpenTask(link.organizationId, link.taskId);
          }}
          className={cn(
            'focus-visible:ring-ring rounded-sm focus-visible:ring-2 focus-visible:outline-none',
            titleClass,
          )}
        >
          {link.title}
        </button>
      )}
      <Button
        controlSize="xs"
        variant="ghost"
        aria-label={`Detach ${link.title}`}
        className="opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
        onClick={() => {
          setConfirming(true);
        }}
        disabled={detach.isPending}
      >
        Detach
      </Button>
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent showClose={false}>
          <DialogHeader>
            <DialogTitle>Detach &ldquo;{link.title}&rdquo;?</DialogTitle>
            <DialogDescription>
              The task stays as-is; only its link to this calendar item is removed.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose className={CANCEL_CLASS}>Cancel</DialogClose>
            <button
              type="button"
              className={DESTRUCTIVE_CONFIRM_CLASS}
              onClick={() => {
                detach.mutate(undefined);
                setConfirming(false);
              }}
            >
              Detach
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
