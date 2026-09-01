'use client';

import type { CalendarItemOut } from '@docket/planning/calendar-contract';
import { Trash2 } from '@docket/ui/icons';
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

import { useDeleteCalendarItem } from '../calendar-mutations';
import { CANCEL_CLASS, DESTRUCTIVE_CONFIRM_CLASS } from './presentation';

/** Props for {@link DeleteCalendarItemAction}. */
export interface DeleteCalendarItemActionProps {
  /** Calendar item to conditionally offer for deletion. */
  item: CalendarItemOut;
  /** Called after a successful delete request is started. */
  onDeleted: () => void;
}

/** Delete action for Docket-owned calendar items; hidden for provider and derived items. */
export function DeleteCalendarItemAction({
  item,
  onDeleted,
}: DeleteCalendarItemActionProps): JSX.Element | null {
  const remove = useDeleteCalendarItem(item.id);
  const [confirming, setConfirming] = useState(false);
  if (
    !['native_block', 'native_event', 'timebox'].includes(item.kind) ||
    !item.permissions.canDelete
  ) {
    return null;
  }

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        className="text-error hover:text-error"
        onClick={() => {
          setConfirming(true);
        }}
      >
        <Trash2 /> Delete
      </Button>
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent showClose={false}>
          <DialogHeader>
            <DialogTitle>Delete &ldquo;{item.title}&rdquo;?</DialogTitle>
            <DialogDescription>
              This removes the item from your calendar. This can&apos;t be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose className={CANCEL_CLASS}>Cancel</DialogClose>
            <button
              type="button"
              className={DESTRUCTIVE_CONFIRM_CLASS}
              onClick={() => {
                remove.mutate(undefined, { onSuccess: onDeleted });
                setConfirming(false);
              }}
            >
              Delete
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
