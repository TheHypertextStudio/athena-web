'use client';

import type { ProgramViewRow } from '@docket/types';
import { cn, relativeTime } from '@docket/ui';
import { IdentityGlyph } from '@docket/ui/components';
import { Layers } from '@docket/ui/icons';
import { Text } from '@docket/ui/primitives';
import type { JSX } from 'react';

import { HEALTH_DOT_CLASS, HEALTH_LABEL } from '@/components/programs/health';

/** Props for {@link ProgramWorkCard}. */
export interface ProgramWorkCardProps {
  /** The Program row with its visible, eight-week activity summary. */
  readonly row: ProgramViewRow;
}

/** Render the recent visible activity label without turning an old record update into a signal. */
function activityRecency(latestOccurredAt: string | null): string {
  return latestOccurredAt ? `Active ${relativeTime(latestOccurredAt)}` : 'No recent activity';
}

/** Render a restrained eight-week activity histogram with a label for every visible bucket. */
function ActivityPulse({ activity }: Pick<ProgramViewRow, 'activity'>): JSX.Element {
  const maximum = Math.max(...activity.weeks);
  const label = `Activity over the last 8 weeks: ${activity.weeks.join(', ')}`;

  return (
    <div role="list" aria-label={label} className="flex h-8 items-end gap-1">
      {activity.weeks.map((count, index) => {
        const height = maximum === 0 ? 4 : Math.max(4, Math.round((count / maximum) * 28));
        const eventNoun = count === 1 ? 'event' : 'events';
        return (
          <span
            key={index}
            role="listitem"
            aria-label={`Week ${index + 1}: ${count} ${eventNoun}`}
            className={cn(
              'bg-on-surface-variant/22 w-2 rounded-sm transition-[height]',
              count > 0 && 'bg-primary/45',
            )}
            style={{ height }}
          />
        );
      })}
    </div>
  );
}

/**
 * Render the Programs card lens as a calm portfolio summary.
 *
 * The view answers whether a Program needs attention and whether work is moving. Its title stays
 * primary, while the compact health verdict and bounded activity pulse avoid repeating the detail
 * view's lifecycle, ownership, and relationship properties.
 */
export function ProgramWorkCard({ row }: ProgramWorkCardProps): JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex min-w-0 items-start gap-3">
        <IdentityGlyph size={36}>
          <Layers className="size-4" />
        </IdentityGlyph>
        <div className="min-w-0 flex-1">
          <h2 className="text-title-medium truncate">{row.name}</h2>
          {row.summary ? (
            <Text as="p" token="body-small" tone="muted" className="mt-1 line-clamp-2">
              {row.summary}
            </Text>
          ) : null}
        </div>
      </div>

      <div className="mt-auto flex items-end justify-between gap-4">
        <div className="min-w-0">
          {row.health ? (
            <Text as="span" token="label-small" tone="muted" className="inline-flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className={cn('size-1.5 shrink-0 rounded-full', HEALTH_DOT_CLASS[row.health])}
              />
              {HEALTH_LABEL[row.health]}
            </Text>
          ) : null}
          <Text
            as="time"
            token="label-small"
            tone="muted"
            dateTime={row.activity.latestOccurredAt ?? undefined}
            className="mt-1 block"
          >
            {activityRecency(row.activity.latestOccurredAt)}
          </Text>
        </div>
        <ActivityPulse activity={row.activity} />
      </div>
    </div>
  );
}
