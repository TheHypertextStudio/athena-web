'use client';

import { defaultEntityDisplay, type ProgramViewRow } from '@docket/types';
import { cn, relativeTime } from '@docket/ui';
import { ActorAvatar } from '@docket/ui/components';
import { useVocabulary } from '@docket/ui/hooks';
import { FolderKanban, ListChecks } from '@docket/ui/icons';
import { Text, toneClass, typeClass } from '@docket/ui/primitives';
import type { ComponentType, JSX } from 'react';

import { EntityIconGlyph } from '@/components/entity-display/entity-icon-glyph';
import { HealthLabel } from '@/components/entity-display/health';
import { useWorkStatus } from '@/components/entity-display/use-work-status';
import { WorkStatusBadge } from '@/components/entity-display/work-status';

import { CARD_GLYPH_FADE_CLASS } from './card-styles';

/** Props for {@link ProgramWorkCard}. */
export interface ProgramWorkCardProps {
  /** The Program row with its visible, eight-week activity summary. */
  readonly row: ProgramViewRow;
  /**
   * The display fields the view has switched on.
   *
   * @remarks
   * The Display → Properties control writes `presentation.properties`, and every other lens reads
   * it. This one used to ignore it, which made those toggles do nothing on the only card lens that
   * renders anything — a dead control, which the craft rubric's "no placeholder" gate forbids.
   */
  readonly properties: ReadonlySet<string>;
}

/** Render the recent visible activity label without turning an old record update into a signal. */
function activityRecency(latestOccurredAt: string | null): string {
  return latestOccurredAt ? `Active ${relativeTime(latestOccurredAt)}` : 'No recent activity';
}

/**
 * The four fill heights an activity week can take, quietest first.
 *
 * @remarks
 * A fixed ladder rather than a computed pixel height: the previous version wrote
 * `style={{ height }}` on every bar, which put an un-tokenised value in the markup and made each
 * bar a one-off. Four static utilities carry the same shape, and the exact per-week counts stay
 * where they were always the real answer — the bar's accessible name.
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
const PULSE_FRAME_CLASS = 'flex h-8 w-24 shrink-0';

/**
 * Place one week's event count on the {@link PULSE_FILL_CLASS} ladder.
 *
 * @param count - Events in that week.
 * @param maximum - The busiest week in the same eight-week window.
 * @returns `0` for a week with no activity, otherwise a rung from 1 to 4.
 */
function pulseLevel(count: number, maximum: number): number {
  if (count === 0 || maximum === 0) return 0;
  const rung = Math.ceil((count / maximum) * PULSE_FILL_CLASS.length);
  return Math.min(PULSE_FILL_CLASS.length, Math.max(1, rung));
}

/**
 * Render a restrained eight-week activity histogram with a label for every visible bucket.
 *
 * @remarks
 * Every week is drawn as a full-height track the bar fills from the bottom, so a quiet week reads
 * as an empty slot. Bars used to be drawn with no track at all, which left a run of quiet weeks
 * looking like disconnected 4px dashes — a rendering artifact rather than data.
 *
 * The fill is neutral on purpose, and quiet within that. Activity is not a verdict, and health is
 * the one thing on this card that has earned colour; spending the brand's primary on a
 * histogram — or a near-black neutral, which shouts just as loudly — takes attention the title
 * should be getting. `outline` reads as data against its track without competing for the card.
 *
 * Heights normalise against the busiest week of this Program alone, so the shape answers "is this
 * one moving?" rather than "is this one busier than its neighbour?" — a comparison eight buckets
 * of eight weeks cannot honestly support.
 */
function ActivityPulse({ activity }: Pick<ProgramViewRow, 'activity'>): JSX.Element {
  const maximum = Math.max(...activity.weeks);

  // A Program with nothing in the window gets a flat baseline rather than eight empty tracks.
  // Eight of them is a row of tall grey slots drawing the eye to the absence of information,
  // which on a roster of quiet Programs is most of what the reader sees. One flat rule says the
  // same thing and lets the verdict beside it stay the loudest mark on the card.
  if (maximum === 0) {
    return (
      <div className={cn(PULSE_FRAME_CLASS, 'items-end')}>
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
    <div role="list" aria-label={label} className={cn(PULSE_FRAME_CLASS, 'items-end gap-1')}>
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

/** The owner's avatar and name, or the fact that nobody holds this Program. */
function ProgramOwner({ ownerActor }: Pick<ProgramViewRow, 'ownerActor'>): JSX.Element {
  if (!ownerActor) {
    return (
      <Text token="label-medium" tone="muted">
        Unowned
      </Text>
    );
  }
  return (
    <span className="flex min-w-0 items-center gap-2">
      <ActorAvatar
        kind={ownerActor.kind}
        name={ownerActor.displayName}
        avatarUrl={ownerActor.avatar}
        size={20}
      />
      <Text token="label-medium" tone="muted" truncate>
        {ownerActor.displayName}
      </Text>
    </span>
  );
}

/** Props for {@link ProgramCount}. */
interface ProgramCountProps {
  /** The glyph naming what is being counted. */
  readonly icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
  /** The rolled-up count. */
  readonly value: number;
  /** The org-skinned singular noun, for the count's accessible name. */
  readonly singular: string;
  /** The org-skinned plural noun, for the count's accessible name. */
  readonly plural: string;
}

/** One rolled-up child count: a glyph, an aligned number, and the noun a screen reader hears. */
function ProgramCount({ icon: Icon, value, singular, plural }: ProgramCountProps): JSX.Element {
  return (
    <Text token="label-medium" tone="muted" numeric className="flex items-center gap-1.5">
      <Icon aria-hidden className="size-4" />
      {value}
      <span className="sr-only">{value === 1 ? singular : plural}</span>
    </Text>
  );
}

/**
 * Render the Programs card lens as a calm portfolio summary.
 *
 * @remarks
 * The card carries what the List lens carries — status, health, owner, and the rolled-up child
 * work — because switching lens should change how a roster is arranged, not how much of it you
 * are allowed to see. It previously showed the name, the summary, and the activity pulse only,
 * which made the Cards lens strictly less informative than the rows it replaced.
 *
 * The signal and roll-up bands are pushed to the bottom edge (`mt-auto`) so they line up across
 * every card in a row however long a summary runs and whether or not a verdict is set. Ragged
 * bottom edges were most of why the grid read as unfinished.
 *
 * @param props - The {@link ProgramWorkCardProps}.
 */
export function ProgramWorkCard({ row, properties }: ProgramWorkCardProps): JSX.Element {
  const display = row.display ?? defaultEntityDisplay('program', row.id);
  const status = useWorkStatus('program', row.status);
  const projectNoun = useVocabulary('project').toLowerCase();
  const projectNounPlural = useVocabulary('project', { plural: true }).toLowerCase();
  const taskNoun = useVocabulary('task').toLowerCase();
  const taskNounPlural = useVocabulary('task', { plural: true }).toLowerCase();

  const showStatus = properties.has('status');
  const showHealth = properties.has('health');
  const showOwner = properties.has('owner');
  const showProjectCount = properties.has('projectCount');
  const showTaskCount = properties.has('taskCount');
  const showRollup = showOwner || showProjectCount || showTaskCount;

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
        <Text as="h2" token="title-medium" className="line-clamp-2 min-w-0 flex-1">
          {row.name}
        </Text>
        {showStatus ? (
          <span className="shrink-0">
            <WorkStatusBadge name={status.name} category={status.category} />
          </span>
        ) : null}
      </div>

      {row.summary ? (
        <Text as="p" token="body-small" tone="muted" className="line-clamp-2">
          {row.summary}
        </Text>
      ) : null}

      <div className="mt-auto flex flex-col gap-3">
        {/*
         * Verdict and recency read as one statement on one line. Stacked, they were two muted
         * lines four pixels apart that blurred into each other and made recency compete with a
         * verdict it only qualifies. The em dash a table column needs for alignment is dropped
         * here: on a card, "no verdict yet" is better said by the absence of one.
         */}
        {/*
         * `items-end` so the pulse sits on the text's own baseline: its bars grow from the bottom
         * of a fixed frame, and centering that frame against a single line left the quiet state's
         * flat rule hovering in the gap below it.
         */}
        <div className="flex items-end justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            {showHealth && row.health ? (
              <>
                <HealthLabel health={row.health} />
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

        {showRollup ? (
          <div className="flex items-center gap-3">
            {showOwner ? <ProgramOwner ownerActor={row.ownerActor} /> : null}
            <span className="ml-auto flex shrink-0 items-center gap-4">
              {showProjectCount ? (
                <ProgramCount
                  icon={FolderKanban}
                  value={row.projectCount}
                  singular={projectNoun}
                  plural={projectNounPlural}
                />
              ) : null}
              {showTaskCount ? (
                <ProgramCount
                  icon={ListChecks}
                  value={row.taskCount}
                  singular={taskNoun}
                  plural={taskNounPlural}
                />
              ) : null}
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
