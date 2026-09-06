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

/** Item kinds Docket owns outright, and so may remove on a person's behalf. */
const DELETABLE_KINDS: readonly CalendarItemOut['kind'][] = [
  'native_block',
  'native_event',
  'timebox',
];

/**
 * Whether this viewer may delete this item.
 *
 * @remarks
 * Exported because the peek popover offers deletion too, and a second copy of the rule is how the
 * two surfaces end up disagreeing about which events can be removed.
 *
 * @param item - The calendar item being considered.
 * @returns whether a delete affordance should render at all.
 */
export function canDeleteCalendarItem(item: CalendarItemOut): boolean {
  return DELETABLE_KINDS.includes(item.kind) && item.permissions.canDelete;
}

/** Props for {@link CalendarItemDeleteDialog}. */
export interface CalendarItemDeleteDialogProps {
  /** Calendar item to remove. */
  item: CalendarItemOut;
  /** Whether the confirmation is showing. */
  open: boolean;
  /** Report a dismissal or an outside close. */
  onOpenChange: (open: boolean) => void;
  /** Called after a successful delete request is started. */
  onDeleted: () => void;
}

/**
 * The delete confirmation, owned by its caller.
 *
 * @remarks
 * Controlled rather than self-triggering because the peek cannot nest it: a confirmation portals
 * outside the popover's subtree, so opening it from inside would fire the popover's outside-press
 * dismissal and unmount both. The peek closes itself first and renders this as a sibling.
 *
 * @param props - The {@link CalendarItemDeleteDialogProps}.
 * @returns the rendered confirmation dialog.
 */
export function CalendarItemDeleteDialog({
  item,
  open,
  onOpenChange,
  onDeleted,
}: CalendarItemDeleteDialogProps): JSX.Element {
  const remove = useDeleteCalendarItem(item.id);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
              onOpenChange(false);
            }}
          >
            Delete
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

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
  const [confirming, setConfirming] = useState(false);
  if (!canDeleteCalendarItem(item)) return null;

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
      <CalendarItemDeleteDialog
        item={item}
        open={confirming}
        onOpenChange={setConfirming}
        onDeleted={onDeleted}
      />
    </>
  );
}
