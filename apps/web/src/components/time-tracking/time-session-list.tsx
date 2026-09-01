'use client';

/** The chronological, filter-aware source of truth behind Time review totals and breakdowns. */
import { Temporal } from '@js-temporal/polyfill';
import type { TimeRecordOut } from '../../lib/contracts/time';
import { Skeleton, Surface, Text } from '@docket/ui/primitives';
import { Computer, Edit } from '@docket/ui/icons';
import type { JSX } from 'react';

import { formatDuration, spokenDuration } from './format-duration';
import type { TimeReviewMeasure } from './time-review-state';

/** Props for {@link TimeSessionList}. */
export interface TimeSessionListProps {
  readonly records: readonly TimeRecordOut[];
  readonly measure: TimeReviewMeasure;
  readonly timezone: string;
  readonly loading: boolean;
  readonly onOpen: (record: TimeRecordOut) => void;
}

/** The measure used by a visible session row. */
function measureOf(record: TimeRecordOut, measure: TimeReviewMeasure): number {
  if (measure === 'human') return record.measures.humanEffortMs;
  if (measure === 'agent') return record.measures.agentEffortMs;
  return record.measures.combinedEffortMs;
}

function dateKey(record: TimeRecordOut, timezone: string): string {
  const instant = record.startedAt ?? record.createdAt;
  return Temporal.Instant.from(instant).toZonedDateTimeISO(timezone).toPlainDate().toString();
}

function dateLabel(key: string, timezone: string): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: timezone,
  }).format(new Date(`${key}T12:00:00Z`));
}

function sourceLabel(record: TimeRecordOut): { label: string; icon: JSX.Element } | null {
  if (record.captureSource === 'manual')
    return { label: 'Manual', icon: <Edit aria-hidden="true" /> };
  if (record.captureSource === 'reconstructed')
    return { label: 'Reconstructed', icon: <Edit aria-hidden="true" /> };
  if (record.captureSource === 'agent')
    return { label: 'Agent', icon: <Computer aria-hidden="true" /> };
  return null;
}

/** Show actual records in local-day groups while preserving a fixed duration column. */
export function TimeSessionList({
  records,
  measure,
  timezone,
  loading,
  onOpen,
}: TimeSessionListProps): JSX.Element {
  if (loading) return <SessionSkeleton />;
  const groups = new Map<string, TimeRecordOut[]>();
  for (const record of records) {
    const key = dateKey(record, timezone);
    const group = groups.get(key) ?? [];
    group.push(record);
    groups.set(key, group);
  }
  const sortedGroups = [...groups.entries()].sort(([left], [right]) => right.localeCompare(left));
  return (
    <div className="flex min-w-0 flex-col gap-6" aria-label="Tracked sessions">
      {sortedGroups.map(([key, group]) => {
        const total = group.reduce((sum, record) => sum + measureOf(record, measure), 0);
        return (
          <section
            key={key}
            aria-labelledby={`time-day-${key}`}
            className="flex min-w-0 flex-col gap-2"
          >
            <div className="flex min-w-0 items-baseline justify-between gap-3 px-1">
              <Text id={`time-day-${key}`} as="h2" token="title-small" truncate>
                {dateLabel(key, timezone)}
              </Text>
              <Text token="body-small" tone="muted" numeric className="shrink-0">
                {formatDuration(total)}
              </Text>
            </div>
            <Surface
              as="ul"
              tone="card"
              shape="medium"
              className="divide-outline-variant/30 divide-y overflow-hidden"
            >
              {group.map((record) => {
                const source = sourceLabel(record);
                const duration = measureOf(record, measure);
                const title = record.title.trim() || 'Unnamed session';
                const context =
                  record.contexts.find((entry) => entry.role === 'primary')?.entityRef.title ??
                  (record.taskId ? 'Linked task' : 'No linked task');
                return (
                  <li key={record.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onOpen(record);
                      }}
                      className="hover:bg-surface-container focus-visible:outline-primary focus-visible:outline-inset flex min-h-14 w-full min-w-0 items-center gap-3 px-4 py-2 text-left focus-visible:outline-2"
                      aria-label={`Open ${title}, ${spokenDuration(duration)}`}
                    >
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <Text token="body-medium" truncate>
                          {title}
                        </Text>
                        <span className="flex min-w-0 items-center gap-2">
                          <Text token="body-small" tone="muted" truncate>
                            {context}
                          </Text>
                          {source ? (
                            <span className="text-on-surface-variant text-label-small inline-flex shrink-0 items-center gap-1">
                              <span className="size-3 [&>svg]:size-3">{source.icon}</span>
                              {source.label}
                            </span>
                          ) : null}
                        </span>
                      </span>
                      <Text
                        token="label-large"
                        numeric
                        className="w-20 shrink-0 text-right"
                        aria-label={spokenDuration(duration)}
                      >
                        {formatDuration(duration)}
                      </Text>
                    </button>
                  </li>
                );
              })}
            </Surface>
          </section>
        );
      })}
    </div>
  );
}

/** Preserve the settled day-group geometry while the first ledger request loads. */
function SessionSkeleton(): JSX.Element {
  return (
    <div className="flex flex-col gap-6" aria-label="Loading tracked sessions" aria-busy="true">
      {[0, 1].map((group) => (
        <div key={group} className="flex flex-col gap-2">
          <Skeleton className="h-5 w-40" />
          <Surface tone="card" shape="medium" className="overflow-hidden">
            {[0, 1, 2].map((row) => (
              <Skeleton
                key={row}
                className="border-outline-variant/30 h-14 rounded-none border-b last:border-b-0"
              />
            ))}
          </Surface>
        </div>
      ))}
    </div>
  );
}
