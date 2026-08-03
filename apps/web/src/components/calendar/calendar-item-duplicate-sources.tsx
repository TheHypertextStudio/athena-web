'use client';

/**
 * `calendar/calendar-item-duplicate-sources` — name every calendar an event arrived on.
 *
 * @remarks
 * The grid renders one block per event even when the same event syncs from two linked accounts
 * (see {@link file://./calendar-event-dedup.ts}). Collapsing is only honest if the copies remain
 * discoverable: a block that quietly stands for three synced items, with no way to find that out,
 * is the same failure as a connector reporting success when nothing happened.
 *
 * So this is not decoration — it is the other half of the dedup. It renders nothing at all for the
 * overwhelmingly common case of an event that arrived once.
 */
import type { CalendarItemOut, CalendarLayerOut } from '@docket/types';
import { Layers } from '@docket/ui/icons';
import { type JSX, useMemo } from 'react';

import { useApiQuery } from '@/lib/query';

import { calendarSettingsDef } from './calendar-data';

/** Props for {@link CalendarItemDuplicateSources}. */
export interface CalendarItemDuplicateSourcesProps {
  /** The copies of this event folded into the block on the grid. Empty renders nothing. */
  readonly duplicates: readonly CalendarItemOut[];
  /** Every layer for the signed-in user, used to name the calendar each copy came from. */
  readonly layers: readonly CalendarLayerOut[];
}

/**
 * List the other calendars this event also arrived on.
 *
 * @param props - The {@link CalendarItemDuplicateSourcesProps}.
 * @returns The section, or nothing when the event arrived exactly once.
 *
 * @example
 * ```tsx
 * <CalendarItemDuplicateSources duplicates={duplicatesByItemId.get(item.id) ?? []} layers={layers} />
 * ```
 */
export function CalendarItemDuplicateSources({
  duplicates,
  layers,
}: CalendarItemDuplicateSourcesProps): JSX.Element | null {
  const settings = useApiQuery(calendarSettingsDef());
  const connections = settings.data?.connections;
  const sources = useMemo(() => {
    const layerById = new Map(layers.map((layer) => [layer.id, layer]));
    return duplicates.map((copy) => {
      const layer = layerById.get(copy.layerId);
      const connection = connections?.find((candidate) => candidate.id === layer?.connectionId);
      const account = connection?.accountEmail ?? connection?.accountName ?? null;
      return {
        id: copy.id,
        calendar: layer?.title ?? 'Another calendar',
        account,
        color: layer?.color ?? null,
      };
    });
  }, [connections, duplicates, layers]);

  if (sources.length === 0) return null;

  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="text-on-surface text-title-small flex items-center gap-1.5">
        <Layers aria-hidden="true" className="text-on-surface-variant size-4 shrink-0" />
        Also on
      </h3>
      {/*
        Application-owned copy, and deliberately specific: "this event is on these other calendars
        too and we are drawing it once" is a different statement from "we hid something".
      */}
      <p className="text-on-surface-variant text-body-medium">
        {sources.length === 1
          ? 'This event also synced from one other calendar. It is drawn once here.'
          : `This event also synced from ${String(sources.length)} other calendars. It is drawn once here.`}
      </p>
      <ul className="flex flex-col gap-1" aria-label="Other calendars this event is on">
        {sources.map((source) => (
          <li key={source.id} className="flex min-w-0 items-center gap-2">
            <span
              aria-hidden="true"
              className="size-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: source.color ?? 'var(--color-outline-variant)' }}
            />
            <span className="text-on-surface text-body-medium truncate">{source.calendar}</span>
            {source.account ? (
              <span className="text-on-surface-variant text-body-medium truncate">
                · {source.account}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
