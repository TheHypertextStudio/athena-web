'use client';

/** Today's real time-ledger summary shared by both Focus surfaces. */
import type { TimeRecordOut } from '@docket/types';
import { Text } from '@docket/ui/primitives';
import Link from '@/components/docket-link';
import type { JSX } from 'react';

import { formatDuration } from './format-duration';

/** Props for {@link FocusToday}. */
export interface FocusTodayProps {
  readonly records: readonly TimeRecordOut[];
  readonly activeRecordId?: string | null;
  readonly limit?: number;
  readonly comfortable?: boolean;
}

/** Show the day's human total and most recent sessions, never synthetic suggestions. */
export default function FocusToday({
  records,
  activeRecordId = null,
  limit = 2,
}: FocusTodayProps): JSX.Element | null {
  if (records.length === 0) return null;
  const total = records.reduce((sum, record) => sum + record.measures.humanEffortMs, 0);
  const recent = records.filter((record) => record.id !== activeRecordId).slice(0, limit);

  return (
    <section aria-labelledby="focus-today-heading" className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <h3 id="focus-today-heading" className="text-on-surface text-label-large">
          Today
        </h3>
        <Text token="body-small" tone="muted" numeric>
          {formatDuration(total)} tracked
        </Text>
      </div>
      {recent.length > 0 ? (
        <ul className="bg-surface-container-low flex flex-col rounded-xl">
          {recent.map((record) => {
            const title = record.title.trim() || 'Unnamed session';
            const content = (
              <>
                <span className="text-on-surface text-body-medium min-w-0 flex-1 truncate">
                  {title}
                </span>
                <span className="text-on-surface-variant text-body-small shrink-0 tabular-nums">
                  {formatDuration(record.measures.humanEffortMs)}
                </span>
              </>
            );
            return (
              <li key={record.id} className="border-outline-variant/30 border-b last:border-b-0">
                {record.taskId && record.organizationId ? (
                  <Link
                    href={`/orgs/${record.organizationId}/tasks/${record.taskId}`}
                    aria-label={title}
                    className="hover:bg-surface-container focus-visible:outline-primary flex min-h-10 min-w-0 items-center gap-3 rounded-xl px-3 py-2 focus-visible:outline-2 focus-visible:outline-offset-2"
                  >
                    {content}
                  </Link>
                ) : (
                  <div className="flex min-w-0 items-center gap-3 px-3 py-2">{content}</div>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
