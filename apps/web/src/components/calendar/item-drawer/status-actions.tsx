'use client';

import type { CalendarItemOut } from '@docket/types';
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
import { cn } from '@docket/ui/lib/utils';
import { type JSX, useState } from 'react';

import { READ_ONLY_REASON_LABEL, SYNC_STATE_META } from '../calendar-item-card';
import { useDeleteCalendarItem, useRetryCalendarItemWrite } from '../calendar-mutations';
import { CANCEL_CLASS, DESTRUCTIVE_CONFIRM_CLASS } from './presentation';

/** Props for {@link SyncStatusSection}. */
export interface SyncStatusSectionProps {
  /** Calendar item whose sync status is shown. */
  item: CalendarItemOut;
}

/** Compact sync state with safe retry actions and conflict guidance. */
export function SyncStatusSection({ item }: SyncStatusSectionProps): JSX.Element {
  const retry = useRetryCalendarItemWrite(item.id);
  const readOnlyLabel = item.permissions.readOnlyReason
    ? READ_ONLY_REASON_LABEL[item.permissions.readOnlyReason]
    : null;

  if (item.hasConflict) {
    return (
      <div
        role="alert"
        className="border-destructive/40 bg-destructive/10 flex flex-col gap-2 rounded-lg border p-3"
      >
        <p className="text-destructive text-sm font-medium">Sync conflict</p>
        <p className="text-on-surface-variant text-xs">
          Local changes and the provider diverged. Open the item in the provider to review, or retry
          pushing your local changes.
        </p>
        <div className="flex flex-wrap gap-2">
          {item.htmlLink ? (
            <Button asChild size="sm" variant="outline">
              <a href={item.htmlLink} target="_blank" rel="noreferrer">
                Open in provider
              </a>
            </Button>
          ) : null}
          <Button
            size="sm"
            onClick={() => {
              retry.mutate(undefined);
            }}
            disabled={retry.isPending}
          >
            {retry.isPending ? 'Retrying…' : 'Retry with local changes'}
          </Button>
        </div>
        {retry.isError ? (
          <p className="text-destructive text-xs">
            We couldn&apos;t retry this calendar update. Please try again.
          </p>
        ) : null}
      </div>
    );
  }

  const meta = SYNC_STATE_META[item.syncState];
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      {meta ? (
        <span
          className={cn(
            'flex items-center gap-1.5',
            item.syncState === 'provider_error' ? 'text-destructive' : 'text-on-surface-variant',
          )}
        >
          <meta.icon
            className={cn('size-3.5', item.syncState === 'push_pending' && 'animate-spin')}
          />
          {meta.label}
        </span>
      ) : (
        <span className="text-on-surface-variant">Synced</span>
      )}
      {readOnlyLabel ? <span className="text-on-surface-variant">· {readOnlyLabel}</span> : null}
      {item.syncState === 'provider_error' ? (
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            retry.mutate(undefined);
          }}
          disabled={retry.isPending}
        >
          Retry
        </Button>
      ) : null}
    </div>
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
        className="text-destructive hover:text-destructive"
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
