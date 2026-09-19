'use client';

/**
 * `calendar/item-drawer/sync-state-notice` — what happened to an edit on its way to the provider.
 *
 * @remarks
 * `docs/core/specs/layered-calendar.md` requires provider conflicts to be visible and to leave
 * remote changes intact. When a provider write conflicts, Docket keeps the local edit, so the
 * notice says that and offers to send it again against the provider's newer version
 * (`POST /v1/me/calendar/items/:id/retry-write`, through `useRetryCalendarItemWrite`). The state is
 * persisted on the item, so it stays in the page as an `InlineBanner` beside the fields a person
 * can still read; a retry that itself fails is presented by the retry mutation as a notice. Every
 * string is this application's own, and provider error text is never shown.
 */
import type { CalendarItemOut, CalendarLayerOut } from '@docket/planning/calendar-contract';
import { InlineBanner, type InlineBannerAction } from '@docket/ui/components';
import { CloudSync } from '@docket/ui/icons';
import { type JSX } from 'react';

import { useRetryCalendarItemWrite } from '../calendar-mutations';
import { providerLabel, syncNotice } from '../item-presentation/sync-presentation';

/** Props for {@link SyncStateNotice}. */
export interface SyncStateNoticeProps {
  /** The event whose write state is described. */
  item: CalendarItemOut;
  /** Its owning layer, used to name the provider. */
  layer: CalendarLayerOut | undefined;
}

/**
 * The heading over a sync state a person should act on.
 *
 * @param layer - The item's owning layer, used to name the provider.
 * @returns application-owned copy naming what has not happened.
 */
export function syncAttentionTitle(layer: CalendarLayerOut | undefined): string {
  return `Not sent to ${providerLabel(layer)}`;
}

/** The banner action that re-sends the local version, or nothing when the state has no recovery. */
function retryAction(
  label: string | null,
  retry: ReturnType<typeof useRetryCalendarItemWrite>,
): InlineBannerAction | undefined {
  if (!label) return undefined;
  return {
    label: retry.isPending ? 'Sending…' : label,
    onSelect: () => {
      if (retry.isPending) return;
      retry.mutate(undefined);
    },
  };
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
    <InlineBanner
      tone="critical"
      density="compact"
      title={syncAttentionTitle(layer)}
      action={retryAction(notice.actionLabel, retry)}
    >
      {notice.text}
    </InlineBanner>
  );
}
