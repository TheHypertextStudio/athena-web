'use client';

/**
 * The generated week, as seven columns of shaped blocks.
 *
 * @remarks
 * This is the surface the whole feature is for: one glance that answers "is the week actually
 * planned, and does it contain all the different kinds of time I need?". So the board leads with
 * the legend of kinds present, states the coverage honestly (including protected time it
 * deliberately left alone and any hole it could not fill), and lists anything it could not place
 * with the reason — rather than showing a tidy grid that quietly omits what went wrong.
 *
 * Blocks are positioned by start order within a day rather than by absolute pixel offset: a week
 * at a glance is about sequence and kind, and a proportional day grid at seven-column width turns
 * a twenty-minute reading block into an unreadable sliver.
 */
import type { UnplacedDemandOut, WeekPlanOut } from '@docket/planning/scheduling-contract';
import { Button, ControlGroup, Stack, Text, Toolbar } from '@docket/ui/primitives';
import { cn } from '@docket/ui/lib/utils';
import { MapPin, Users } from '@docket/ui/icons';
import type { JSX } from 'react';

import { shapeVisual, WorkShapeChip, WorkShapeLegend } from './work-shape-chip';

/** Stable machine code → application-owned sentence. Never a server string. */
const UNPLACED_COPY: Readonly<Record<UnplacedDemandOut['reason'], string>> = {
  no_matching_window: 'There was no window of the right kind for it this week.',
  window_too_short: 'Every window left was shorter than one session needs.',
  missing_location: 'It needs a location before it can be scheduled.',
  missing_attendees: 'It needs at least one person before it can be scheduled.',
  no_source_event: 'It follows an event, and there was no event to follow.',
  week_full: 'The week filled up before it got a turn.',
};

/**
 * Local weekday/day-of-month labels for a column header.
 *
 * @remarks
 * Read at noon UTC and formatted in UTC on purpose: the date string is already the plan's own
 * local date, so re-projecting it through a timezone would shift the label off by a day at the
 * edges. Noon is far enough from either boundary that no offset can move it.
 */
function dayLabel(date: string): { weekday: string; day: string } {
  const at = new Date(`${date}T12:00:00Z`);
  return {
    weekday: at.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }),
    day: at.toLocaleDateString('en-US', { day: 'numeric', month: 'short', timeZone: 'UTC' }),
  };
}

/** A block's local clock reading, in the plan's own timezone. */
function clock(iso: string, timezone: string): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: timezone,
  });
}

/** Human duration: "20m", "1h", "2h 30m". */
function duration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${String(rest)}m`;
  if (rest === 0) return `${String(hours)}h`;
  return `${String(hours)}h ${String(rest)}m`;
}

/** Props for {@link WeekPlanBoard}. */
export interface WeekPlanBoardProps {
  readonly plan: WeekPlanOut;
  readonly onGenerate?: () => void;
  readonly generating?: boolean;
}

/**
 * The week board.
 *
 * @param props - The generated week and an optional re-plan action.
 * @returns the board.
 */
export function WeekPlanBoard(props: WeekPlanBoardProps): JSX.Element {
  const { plan } = props;
  const days = Array.from({ length: 7 }, (_, index) => {
    const at = new Date(`${plan.weekStartDate}T12:00:00Z`);
    at.setUTCDate(at.getUTCDate() + index);
    return at.toISOString().slice(0, 10);
  });

  return (
    <Stack gap={6} className="w-full min-w-0">
      <Toolbar
        controlSize="md"
        leading={
          <Stack gap={1} className="min-w-0">
            <Text as="h2" token="headline-small">
              Your week
            </Text>
            <Text token="body-small" tone="muted">
              {plan.blocks.length === 0
                ? 'Nothing planned yet.'
                : `${String(plan.blocks.length)} blocks across ${String(plan.shapesPresent.length)} kinds of time · planned in ${String(plan.userInputCount)} step`}
            </Text>
          </Stack>
        }
        trailing={
          props.onGenerate === undefined ? null : (
            <Button onClick={props.onGenerate} disabled={props.generating === true}>
              {props.generating === true ? 'Planning…' : 'Plan this week'}
            </Button>
          )
        }
      />

      {plan.shapesPresent.length > 0 ? <WorkShapeLegend shapes={plan.shapesPresent} /> : null}

      <CoverageSummary plan={plan} />

      <div
        className="grid min-w-0 grid-cols-1 gap-3 @2xl:grid-cols-4 @5xl:grid-cols-7"
        data-testid="week-plan-grid"
      >
        {days.map((date) => (
          <DayColumn
            key={date}
            date={date}
            timezone={plan.timezone}
            blocks={plan.blocks.filter((block) => block.date === date)}
          />
        ))}
      </div>

      {plan.unplaced.length > 0 ? <UnplacedList unplaced={plan.unplaced} /> : null}
    </Stack>
  );
}

/** The coverage report, stated plainly rather than as a bare percentage. */
function CoverageSummary({ plan }: { plan: WeekPlanOut }): JSX.Element {
  const { coverage } = plan;
  return (
    <div className="bg-surface-container-low grid grid-cols-2 gap-4 rounded-xl p-4 @2xl:grid-cols-4">
      <Stack gap={1}>
        <Text token="label-medium" tone="muted">
          Time accounted for
        </Text>
        <Text token="title-medium" numeric>
          {coverage.coveragePercent.toFixed(1)}%
        </Text>
        <Text token="body-small" tone="muted" numeric>
          {duration(coverage.scheduledMinutes)} of {duration(coverage.availableMinutes)}
        </Text>
      </Stack>
      <Stack gap={1}>
        <Text token="label-medium" tone="muted">
          Kept for yourself
        </Text>
        <Text token="title-medium" numeric>
          {duration(coverage.protectedMinutes)}
        </Text>
        <Text token="body-small" tone="muted">
          Never scheduled into
        </Text>
      </Stack>
      <Stack gap={1}>
        <Text token="label-medium" tone="muted">
          Largest unplanned gap
        </Text>
        <Text token="title-medium" numeric>
          {duration(coverage.largestGapMinutes)}
        </Text>
        <Text token="body-small" tone={coverage.withinThreshold ? 'muted' : 'error'}>
          {coverage.withinThreshold ? 'Within your limit' : 'Over your limit'}
        </Text>
      </Stack>
      <Stack gap={1}>
        <Text token="label-medium" tone="muted">
          Holes left
        </Text>
        <Text token="title-medium" numeric>
          {String(coverage.gaps.length)}
        </Text>
        <Text token="body-small" tone="muted">
          {coverage.gaps.length === 0 ? 'None worth naming' : 'Listed in your calendar'}
        </Text>
      </Stack>
    </div>
  );
}

/** One day column. */
function DayColumn(props: {
  readonly date: string;
  readonly timezone: string;
  readonly blocks: WeekPlanOut['blocks'];
}): JSX.Element {
  const label = dayLabel(props.date);
  return (
    <Stack gap={2} className="min-w-0" data-testid="week-plan-day" data-date={props.date}>
      <Stack gap={0} className="px-1">
        <Text token="label-large">{label.weekday}</Text>
        <Text token="body-small" tone="muted">
          {label.day}
        </Text>
      </Stack>
      {props.blocks.length === 0 ? (
        <div className="bg-surface-container-low rounded-xl px-3 py-4">
          <Text token="body-small" tone="muted">
            Clear
          </Text>
        </div>
      ) : (
        <Stack gap={2}>
          {props.blocks.map((block) => (
            <BlockCard
              key={block.calendarItemId ?? `${block.shape}-${block.startsAt}`}
              block={block}
              timezone={props.timezone}
            />
          ))}
        </Stack>
      )}
    </Stack>
  );
}

/** One scheduled block. */
function BlockCard(props: {
  readonly block: WeekPlanOut['blocks'][number];
  readonly timezone: string;
}): JSX.Element {
  const { block } = props;
  const visual = shapeVisual(block.shape);
  return (
    <article
      className="bg-surface-container-low relative flex min-w-0 flex-col gap-2 overflow-hidden rounded-xl px-3 py-3 pl-4"
      data-testid="week-plan-block"
      data-work-shape={block.shape}
      data-origin={block.origin}
    >
      <span aria-hidden className={cn('absolute inset-y-0 left-0 w-1', visual.accent)} />
      <Stack gap={0} className="min-w-0">
        <Text token="body-small" tone="muted" numeric>
          {clock(block.startsAt, props.timezone)} · {duration(block.minutes)}
        </Text>
        <Text token="title-small" truncate>
          {block.title}
        </Text>
      </Stack>
      <WorkShapeChip shape={block.shape} controlSize="xs" />
      {block.organizationName === null ? null : (
        <Text token="body-small" tone="muted" truncate>
          {block.organizationName}
        </Text>
      )}
      {block.location === null ? null : (
        <div className="text-on-surface-variant flex min-w-0 items-center gap-1">
          <MapPin fontSize="inherit" aria-hidden />
          <Text token="body-small" tone="muted" truncate>
            {block.location}
          </Text>
        </div>
      )}
      {block.attendees.length === 0 ? null : (
        <div className="text-on-surface-variant flex min-w-0 items-center gap-1">
          <Users fontSize="inherit" aria-hidden />
          <Text token="body-small" tone="muted" truncate>
            {block.attendees.join(', ')}
          </Text>
        </div>
      )}
      {block.anchorCalendarItemId === null ? null : (
        <Text token="label-small" tone="muted">
          Follows the block above it
        </Text>
      )}
    </article>
  );
}

/** Everything the planner could not place, and why — never silently omitted. */
function UnplacedList(props: { readonly unplaced: readonly UnplacedDemandOut[] }): JSX.Element {
  return (
    <Stack gap={3} className="bg-surface-container-low rounded-xl p-4">
      <Text as="h3" token="title-small">
        Not scheduled this week
      </Text>
      <Stack gap={2} as="ul">
        {props.unplaced.map((item) => (
          <li key={`${item.shape}-${item.title}`} className="flex min-w-0 flex-col gap-1">
            <ControlGroup controlSize="xs">
              <WorkShapeChip shape={item.shape} />
              <Text token="title-small" truncate>
                {item.title}
              </Text>
            </ControlGroup>
            <Text token="body-small" tone="muted">
              {UNPLACED_COPY[item.reason]}
              {item.placedSessions > 0
                ? ` ${String(item.placedSessions)} of ${String(item.requestedSessions)} sessions did fit.`
                : ''}
            </Text>
          </li>
        ))}
      </Stack>
    </Stack>
  );
}
