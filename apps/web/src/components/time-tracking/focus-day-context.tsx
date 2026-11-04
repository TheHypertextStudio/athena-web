'use client';

import { Button, Text } from '@docket/ui/primitives';
import { InlineBanner } from '@docket/ui/components';
import type { JSX } from 'react';
import Link from '@/components/docket-link';
import type { DayData } from '@/components/daily-planning/daily-planning-controller';
import {
  useDailyPlanningDay,
  useDailyPlanningPreferences,
} from '@/components/daily-planning/daily-planning-queries';

/** Keep the day's next commitment and other accepted work beside the focused task. */
export default function FocusDayContext({
  taskId,
}: {
  readonly taskId: string | null;
}): JSX.Element | null {
  const preferences = useDailyPlanningPreferences();
  const timezone = preferences.data?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const date = new Date().toLocaleDateString('en-CA', { timeZone: timezone });
  const day = useDailyPlanningDay(date, preferences.isSuccess);
  if (day.isError)
    return (
      <InlineBanner
        tone="critical"
        title="Could not load today's context."
        action={{
          label: 'Retry',
          onSelect: () => {
            void day.refetch();
          },
        }}
      />
    );
  const data = day.data;
  if (!data) return null;
  const { otherWork, next } = focusDayFacts(data, taskId);
  if (!next && !otherWork.length) return null;
  return (
    <div className="space-y-5">
      {next ? (
        <section className="space-y-1">
          <h3 className="text-label-large">Next commitment</h3>
          <Text as="p" token="body-medium">
            {next.title}
          </Text>
          <Text as="p" token="body-small" tone="muted">
            {new Date(next.startsAt).toLocaleTimeString(undefined, {
              timeZone: timezone,
              hour: 'numeric',
              minute: '2-digit',
            })}
          </Text>
        </section>
      ) : null}
      {otherWork.length ? (
        <section className="space-y-2">
          <h3 className="text-label-large">Also planned today</h3>
          {otherWork.map((task) => (
            <Link
              key={task.taskId}
              className="text-body-medium text-primary block hover:underline"
              href={`/orgs/${task.organizationId}/tasks/${task.taskId}`}
            >
              {data.tasks.find((entry) => entry.taskId === task.taskId)?.title}
            </Link>
          ))}
          <Button size="sm" variant="ghost" className="px-0" asChild>
            <Link href={`/plan/day?date=${date}`}>Review day</Link>
          </Button>
        </section>
      ) : null}
    </div>
  );
}

function focusDayFacts(data: DayData, taskId: string | null) {
  const accepted = data.accepted?.current.snapshot;
  const otherWork =
    accepted?.tasks
      .filter((task) => {
        const details = data.tasks.find((entry) => entry.taskId === task.taskId);
        const recorded = data.actual
          .filter((entry) => entry.taskId === task.taskId)
          .reduce((sum, entry) => sum + entry.recordedMinutes, 0);
        return (
          task.taskId !== taskId &&
          details &&
          !details.completedAt &&
          recorded < task.plannedMinutes
        );
      })
      .slice(0, 2) ?? [];
  const events = [
    ...data.fixedIntervals,
    ...data.agenda.entries.flatMap((entry) =>
      entry.kind === 'google_calendar_event' && entry.event.startsAt
        ? [{ title: entry.event.title, startsAt: entry.event.startsAt }]
        : [],
    ),
  ]
    .filter((event) => Date.parse(event.startsAt) >= Date.now())
    .sort((left, right) => left.startsAt.localeCompare(right.startsAt));
  const next = events[0];
  return { otherWork, next };
}
