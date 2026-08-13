'use client';

/**
 * `activity` — a narrated day, as a panel.
 *
 * @remarks
 * One component, mountable wherever a day belongs. It knows nothing about reviews, steps or gates, and
 * imports nothing from `scheduling-plan/` — that is the structural reason it can be reused rather than
 * quietly becoming a piece of the evening review.
 *
 * Its states are the point. An empty list is not one state but three, and they must not look alike:
 * nothing is connected, something could not be read, or the day was genuinely quiet. Saying "nothing
 * came in today" when a source was unreachable is the single most likely way for this surface to lie,
 * so the copy names which sources answered and which did not.
 */
import type { HighlightsDayOut } from '@docket/types';
import { Skeleton, Stack, Text } from '@docket/ui/primitives';
import { EntityList } from '@docket/ui/components';
import Link from 'next/link';
import type { JSX } from 'react';

import { userErrorMessage } from '@/lib/problem';

import { DayHighlightRow } from './day-highlight-row';
import { joinLabels, sourceLabel, summarizeDay } from './highlight-view';
import { useCurateHighlight, useDayHighlights } from './use-day-highlights';

/** Props for {@link DayHighlights}. */
export interface DayHighlightsProps {
  /** The local day to show (`YYYY-MM-DD`). */
  readonly date: string;
  /**
   * Whether the sentences can be curated.
   *
   * @remarks
   * `review` lets a person keep, drop and rewrite; `record` is read-only. Curation belongs to a *day*,
   * so a surface that is not about one particular day should always use `record`.
   */
  readonly mode: 'review' | 'record';
  /** Heading level, so the panel nests correctly under whatever mounts it. */
  readonly headingLevel?: 2 | 3;
}

/** The panel's own heading. */
function Heading({ level }: { readonly level: 2 | 3 }): JSX.Element {
  return (
    <Text as={level === 2 ? 'h2' : 'h3'} token={level === 2 ? 'title-medium' : 'title-small'}>
      What happened
    </Text>
  );
}

/**
 * A narrated day: one line per thing, curatable when it is today's own review.
 *
 * @param props - The day, whether it can be curated, and the heading level.
 * @returns the panel.
 */
export function DayHighlights({ date, mode, headingLevel = 3 }: DayHighlightsProps): JSX.Element {
  const query = useDayHighlights(date);
  const curate = useCurateHighlight(date);
  const day: HighlightsDayOut | undefined = query.data;
  const summary = summarizeDay(day);

  const shell = (children: JSX.Element): JSX.Element => (
    <section aria-labelledby="day-highlights-heading" className="w-full min-w-0">
      <Stack gap={3} className="bg-surface-container rounded-xl p-4">
        <div id="day-highlights-heading">
          <Heading level={headingLevel} />
        </div>
        {children}
      </Stack>
    </section>
  );

  if (query.isError) {
    return shell(
      <Text token="body-small" tone="muted" role="alert">
        {userErrorMessage(query.error, 'Could not load what happened today.')}
      </Text>,
    );
  }

  if (summary.shape === 'loading') {
    return shell(
      <Stack gap={2} aria-busy="true">
        {[0, 1, 2].map((row) => (
          <Skeleton key={row} className="h-11 w-full rounded-lg" />
        ))}
      </Stack>,
    );
  }

  if (summary.shape === 'not_connected') {
    return shell(
      <Text token="body-small" tone="muted">
        Nothing is connected yet, so there is nothing to gather.{' '}
        <Link href="/settings/connections" className="text-primary underline">
          Connect a tool
        </Link>
        .
      </Text>,
    );
  }

  if (summary.shape === 'incomplete') {
    const troubled = joinLabels(
      summary.troubledSources.map((source) => sourceLabel(source.system)),
    );
    return shell(
      <Text token="body-small" tone="muted" role="status">
        {troubled
          ? `${troubled} could not be read yet, so this day is incomplete.`
          : 'This day has not been gathered yet.'}
      </Text>,
    );
  }

  if (summary.shape === 'quiet') {
    // Naming what *was* checked is the honesty mechanism: it makes a quiet day legible as quiet,
    // rather than indistinguishable from a day nobody looked at.
    const checked = joinLabels(summary.readSources.map((source) => sourceLabel(source.system)));
    return shell(
      <Text token="body-small" tone="muted">
        {checked ? `Nothing came in from ${checked} today.` : 'Nothing came in today.'}
      </Text>,
    );
  }

  const troubled = summary.troubledSources;
  return shell(
    <Stack gap={3}>
      <Text token="body-small" tone="muted" numeric>
        {`${String(summary.keptCount)} of ${String(summary.totalCount)} kept`}
      </Text>

      {troubled.length > 0 ? (
        // Above the list, and explicit: a list that is missing a source must never read as complete.
        <Text token="body-small" tone="muted" role="status">
          {`${joinLabels(troubled.map((source) => sourceLabel(source.system)))} could not be read, so anything from there is missing.`}
        </Text>
      ) : null}

      <EntityList tone="tonal" aria-label="What happened today">
        {day?.highlights.map((highlight) => (
          <DayHighlightRow
            key={highlight.id}
            highlight={highlight}
            timezone={day.timezone}
            {...(mode === 'review'
              ? {
                  actions: {
                    onKeepChange: (kept: boolean) => {
                      curate.mutate({ id: highlight.id, kept });
                    },
                    onNarrationChange: (text: string | null) => {
                      curate.mutate({ id: highlight.id, narration: text });
                    },
                    busy: curate.isPending && curate.variables.id === highlight.id,
                  },
                }
              : {})}
          />
        ))}
      </EntityList>
    </Stack>,
  );
}
