'use client';

import { defaultEntityDisplay } from '@docket/work/entity-display-contract';
import { type ProgramViewRow } from '@docket/work/work-view-contract';
import { cn, relativeTime } from '@docket/ui';
import { useVocabulary } from '@docket/ui/hooks';
import { FolderKanban, ListChecks } from '@docket/ui/icons';
import { Text, toneClass, typeClass } from '@docket/ui/primitives';
import type { JSX } from 'react';

import { EntityIconGlyph } from '@/components/entity-display/entity-icon-glyph';
import { HealthLabel } from '@/components/entity-display/health';
import { ActorName, WorkCount } from '@/components/entity-display/roster-cells';
import { useWorkStatus } from '@/components/entity-display/use-work-status';
import { WorkStatusBadge } from '@/components/entity-display/work-status';

import { CARD_GLYPH_FADE_CLASS } from './card-styles';
import { formatWorkViewValue, workViewRowDisplayValue } from './renderer-types';
import { workViewDisplayFieldCatalog } from './view-state';

/** Props for {@link ProgramWorkCard}. */
export interface ProgramWorkCardProps {
  /** The Program row with its visible, eight-week activity summary. */
  readonly row: ProgramViewRow;
  /**
   * The display fields the view has switched on.
   *
   * @remarks
   * Read from `presentation.properties`, which the Display → Properties control writes. The card
   * composes its own treatment for the five it can lay out — see {@link COMPOSED_FIELDS}.
   */
  readonly properties: ReadonlySet<string>;
}

/**
 * The fields the card lays out itself, rather than as a label and a value.
 *
 * @remarks
 * `name` is the title. The other five carry a designed treatment — health tints the identity
 * mark, the counts share a container, the owner takes an avatar — so rendering them again in the
 * fall-through list would say everything twice.
 */
const COMPOSED_FIELDS: ReadonlySet<string> = new Set([
  'name',
  'status',
  'health',
  'owner',
  'projectCount',
  'taskCount',
]);

/** Render the recent visible activity label without turning an old record update into a signal. */
function activityRecency(latestOccurredAt: string | null): string {
  return latestOccurredAt ? `Active ${relativeTime(latestOccurredAt)}` : 'No recent activity';
}

/**
 * The four fill heights an activity week can take, quietest first.
 *
 * @remarks
 * A fixed ladder rather than a height computed per bar, so every bar is a token and none is a
 * one-off. The exact per-week counts live where they are actually readable — the accessible name.
 */
const PULSE_FILL_CLASS = ['h-2', 'h-4', 'h-6', 'h-8'] as const;

/**
 * The pulse's own box, identical whether it holds eight bars or one flat rule.
 *
 * @remarks
 * Fixing the width here (rather than letting eight bars add up to it) keeps a busy Program and a
 * quiet one the same size, so the roll-up line beneath them starts at the same place on every
 * card in a row.
 */
const PULSE_FRAME_CLASS = 'flex h-8 w-24 shrink-0 items-end';

/**
 * Place one week's event count on the {@link PULSE_FILL_CLASS} ladder.
 *
 * @param count - Events in that week.
 * @param maximum - The busiest week in the same eight-week window.
 * @returns `0` for a week with no activity, otherwise a rung from 1 to 4.
 */
function pulseLevel(count: number, maximum: number): number {
  // `maximum` is guarded here rather than only at the caller: dividing by zero yields `Infinity`,
  // which indexes past the ladder and renders a bar with no height class and no error.
  if (count === 0 || maximum === 0) return 0;
  return Math.ceil((count / maximum) * PULSE_FILL_CLASS.length);
}

/**
 * Render a restrained eight-week activity histogram with a label for every visible bucket.
 *
 * @remarks
 * Each week is a full-height track the bar fills from the bottom, so a quiet week reads as an
 * empty slot rather than as a bar that failed to draw.
 *
 * The fill is neutral, and quiet within that. Health is the one thing on this card that has
 * earned colour, and a histogram loud enough to compete with the title takes attention the name
 * should be getting.
 *
 * Heights normalise against this Program's own busiest week, so the shape answers "is this one
 * moving?" rather than inviting a comparison across cards that eight buckets cannot support.
 */
function ActivityPulse({ activity }: Pick<ProgramViewRow, 'activity'>): JSX.Element {
  const maximum = Math.max(...activity.weeks);

  // A flat baseline rather than eight empty tracks: on a roster of quiet Programs, eight tall
  // grey slots per card is most of what the reader sees, all of it the absence of information.
  if (maximum === 0) {
    return (
      <div className={PULSE_FRAME_CLASS}>
        <span
          role="img"
          aria-label="No activity in the last 8 weeks"
          className="bg-surface-container-highest h-1 w-full rounded-full"
        />
      </div>
    );
  }

  const label = `Activity over the last 8 weeks: ${activity.weeks.join(', ')}`;
  return (
    <div role="list" aria-label={label} className={cn(PULSE_FRAME_CLASS, 'gap-1')}>
      {activity.weeks.map((count, index) => {
        const level = pulseLevel(count, maximum);
        const eventNoun = count === 1 ? 'event' : 'events';
        return (
          <span
            key={index}
            role="listitem"
            aria-label={`Week ${index + 1}: ${count} ${eventNoun}`}
            className="bg-surface-container-highest flex h-8 flex-1 items-end rounded-full"
          >
            {level > 0 ? (
              <span
                aria-hidden="true"
                className={cn('bg-outline w-full rounded-full', PULSE_FILL_CLASS[level - 1])}
              />
            ) : null}
          </span>
        );
      })}
    </div>
  );
}

/**
 * Render the Programs card lens as a calm portfolio summary.
 *
 * @remarks
 * The card carries what the List lens carries — status, health, owner, and the rolled-up child
 * work — because switching lens should change how a roster is arranged, not how much of it you
 * are allowed to see.
 *
 * The signal and roll-up bands are pinned to the bottom edge (`mt-auto`) so they line up across
 * every card in a row however long a summary runs and whether or not health is set.
 *
 * @param props - The {@link ProgramWorkCardProps}.
 */
export function ProgramWorkCard({ row, properties }: ProgramWorkCardProps): JSX.Element {
  const display = row.display ?? defaultEntityDisplay('program', row.id);
  const status = useWorkStatus('program', row.status);
  const projectNoun = useVocabulary('project', { plural: row.projectCount !== 1 }).toLowerCase();
  const taskNoun = useVocabulary('task', { plural: row.taskCount !== 1 }).toLowerCase();

  const showProjectCount = properties.has('projectCount');
  const showTaskCount = properties.has('taskCount');
  // The contract marks eleven Program fields displayable and Display offers a toggle for each.
  // Five have a designed place on the card; the rest fall through to the same label-and-value pair
  // the other targets' cards render, so a toggle never does nothing. The catalog is memoized per
  // target, so reading it here rather than taking it as a prop costs a map lookup.
  const extras = workViewDisplayFieldCatalog('program').filter(
    (field) => properties.has(field.key) && !COMPOSED_FIELDS.has(field.key),
  );
  // Health names itself on the signal line. It does not tint the identity mark: a Program's mark
  // carries the icon and colour its owner chose, and that choice outranks a derived signal.
  const health = properties.has('health') ? row.health : null;
  const owner = properties.has('owner') ? row.ownerActor : null;

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex min-w-0 items-start gap-3">
        {/* Fades under the frame's selection checkbox, which is laid over this slot. */}
        <span className={CARD_GLYPH_FADE_CLASS}>
          <EntityIconGlyph
            iconKey={display.iconKey}
            colorKey={display.colorKey}
            customColor={display.customColor}
            size={40}
          />
        </span>
        {/* `title` so a name the two-line clamp cuts is still readable on hover. */}
        <Text as="h2" token="title-large" title={row.name} className="line-clamp-2 min-w-0 flex-1">
          {row.name}
        </Text>
        {properties.has('status') ? (
          <span className="shrink-0">
            <WorkStatusBadge name={status.name} category={status.category} />
          </span>
        ) : null}
      </div>

      {row.summary ? (
        <Text as="p" token="body-medium" tone="muted" className="line-clamp-2">
          {row.summary}
        </Text>
      ) : null}

      <div className="mt-auto flex flex-col gap-3">
        {/*
         * Verdict and recency read as one statement on one line, and `items-end` sits the pulse on
         * that line's baseline — its bars grow from the bottom of a fixed frame.
         */}
        <div className="flex items-end justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            {health ? (
              <>
                <HealthLabel health={health} />
                <span
                  aria-hidden="true"
                  className={cn(typeClass('label-small'), toneClass('muted'))}
                >
                  ·
                </span>
              </>
            ) : null}
            <time
              dateTime={row.activity.latestOccurredAt ?? undefined}
              className={cn(typeClass('label-small'), toneClass('muted'), 'truncate')}
            >
              {activityRecency(row.activity.latestOccurredAt)}
            </time>
          </div>
          <ActivityPulse activity={row.activity} />
        </div>

        {owner !== null || showProjectCount || showTaskCount ? (
          <div className="flex items-center gap-3">
            {owner ? <ActorName actor={owner} token="label-medium" /> : null}
            <span className="bg-surface-container-highest ml-auto flex shrink-0 items-center gap-3 rounded-full px-3 py-1">
              {showProjectCount ? (
                <WorkCount
                  icon={FolderKanban}
                  value={row.projectCount}
                  noun={projectNoun}
                  token="label-medium"
                />
              ) : null}
              {showTaskCount ? (
                <WorkCount
                  icon={ListChecks}
                  value={row.taskCount}
                  noun={taskNoun}
                  token="label-medium"
                />
              ) : null}
            </span>
          </div>
        ) : null}

        {extras.length > 0 ? (
          <dl className="text-on-surface-variant text-body-small grid gap-1">
            {extras.map((field) => (
              <div key={field.key} className="flex min-w-0 gap-2">
                <dt className="shrink-0">{field.label}</dt>
                <dd className="truncate">
                  {formatWorkViewValue(workViewRowDisplayValue(row, field.key), field.kind)}
                </dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>
    </div>
  );
}
