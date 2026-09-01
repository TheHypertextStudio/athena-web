'use client';

/** Today's real time-ledger summary shared by both Focus surfaces. */
import type { TimeRecordOut } from '../../lib/contracts/time';
import { Surface, Text } from '@docket/ui/primitives';
import Link from '@/components/docket-link';
import type { JSX } from 'react';

import { formatDuration } from './format-duration';
import type { FocusPresentation } from './focus-route-frame';

/** Props for {@link FocusToday}. */
export interface FocusTodayProps {
  readonly records: readonly TimeRecordOut[];
  readonly activeRecordId?: string | null;
  readonly limit?: number;
  /** The enclosing rail or page presentation. This is separate from saved shell density. */
  readonly presentation?: FocusPresentation | undefined;
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
        <div className="flex shrink-0 items-baseline gap-2">
          <Text token="body-small" tone="muted" numeric>
            {formatDuration(total)} tracked
          </Text>
          <Link
            href="/time?period=day"
            className="text-primary text-label-medium focus-visible:outline-primary rounded-sm hover:underline focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            Review today’s time
          </Link>
        </div>
      </div>
      {recent.length > 0 ? (
        <Surface as="ul" tone="card" shape="medium" className="flex flex-col">
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
        </Surface>
      ) : null}
    </section>
  );
}
