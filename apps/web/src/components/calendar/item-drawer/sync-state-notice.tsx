'use client';

/**
 * `calendar/item-drawer/sync-state-notice` — what happened to an edit on its way to the provider.
 *
 * @remarks
 * `docs/core/specs/layered-calendar.md` makes "provider conflicts are visible and do not silently
 * overwrite remote changes" an acceptance criterion, and until now nothing met it: a conflicted
 * event was force-downgraded to read-only and said only "Read-only", while the one recovery the
 * API offers — `POST /v1/me/calendar/items/:id/retry-write` — had a client hook with no call site
 * anywhere in the app.
 *
 * A conflict here is not a failure to report and move past. Docket kept the local edit rather than
 * discarding it, so the notice says so and offers to send it again against the provider's newer
 * version. Every string is this application's own; provider error text never reaches a person.
 */
import type { CalendarItemOut, CalendarLayerOut } from '@docket/planning/calendar-contract';
import { CloudSync, RefreshCw } from '@docket/ui/icons';
import { Button, Surface } from '@docket/ui/primitives';
import { type JSX } from 'react';

import { userErrorMessage } from '@/lib/problem';

import { useRetryCalendarItemWrite } from '../calendar-mutations';
import { syncNotice } from '../item-presentation/sync-presentation';

/** Props for {@link SyncStateNotice}. */
export interface SyncStateNoticeProps {
  /** The event whose write state is described. */
  item: CalendarItemOut;
  /** Its owning layer, used to name the provider. */
  layer: CalendarLayerOut | undefined;
}

/** The provider write state, when there is something worth saying about it. */
export function SyncStateNotice({ item, layer }: SyncStateNoticeProps): JSX.Element | null {
  const retry = useRetryCalendarItemWrite(item.id);
  const notice = syncNotice(item, layer);
  if (!notice) return null;

  if (notice.tone === 'progress') {
    return (
      <p className="text-on-surface-variant text-body-small flex items-center gap-1.5">
        <span aria-hidden="true" className="[&_svg]:size-4">
          <CloudSync />
        </span>
        {notice.text}
      </p>
    );
  }

  return (
    <Surface
      tone="well"
      shape="medium"
      pad="comfortable"
      role="status"
      className="flex flex-col gap-2"
    >
      <p className="text-on-surface text-body-medium">{notice.text}</p>
      <div className="flex flex-wrap items-center gap-2">
        {notice.actionLabel ? (
          <Button
            type="button"
            controlSize="sm"
            disabled={retry.isPending}
            onClick={() => {
              retry.mutate(undefined);
            }}
          >
            <RefreshCw aria-hidden="true" />
            {retry.isPending ? 'Sending…' : notice.actionLabel}
          </Button>
        ) : null}
      </div>
      {retry.isError ? (
        <p role="alert" className="text-error text-body-small">
          {userErrorMessage(retry.error, "We couldn't send that change. Please try again.")}
        </p>
      ) : null}
    </Surface>
  );
}
