'use client';

/**
 * The plan surface: the generated week and the day's loop, in one place.
 *
 * @remarks
 * Three lenses over the same data — the week, the morning walk-through, and the evening close —
 * because they are three moments in one loop and splitting them across three routes would make
 * the loop invisible. The lens switcher lives on the toolbar's leading edge (the view's own
 * control) and the actions that act *on* the view sit on the trailing edge, per the shell's
 * toolbar contract.
 *
 * Every read goes through the typed query layer; every failure renders application-owned copy
 * and never a server sentence.
 */
import { Button, ControlGroup, Skeleton, Stack, Text, Toolbar } from '@docket/ui/primitives';
import { useAppSearchParams } from '@/lib/app-location';
import type { JSX } from 'react';
import { useState } from 'react';

import { DayCheckIns } from './day-check-ins';
import { DayStartReview } from './day-start-review';
import { EveningReview } from './evening-review';
import {
  useAcknowledgeAgenda,
  useAnswerReviewPrompt,
  useConfirmTomorrow,
  useDayCheckIns,
  useDayReview,
  useDayStart,
  useDirective,
  useDisposeReviewItem,
  useGenerateWeek,
  useReorganizeDay,
  useRespondToCheckIn,
  useWeekPlan,
} from './use-schedule-plan';
import { WeekPlanBoard } from './week-plan-board';

/** The three moments of the loop. */
type Lens = 'week' | 'morning' | 'evening';

const LENS_LABEL: Readonly<Record<Lens, string>> = {
  week: 'The week',
  morning: 'Start of day',
  evening: 'End of day',
};

/** The local Monday of the week containing `date`, in the browser's own calendar. */
function weekStartOf(date: Date): string {
  const copy = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const weekday = copy.getUTCDay();
  copy.setUTCDate(copy.getUTCDate() - (weekday === 0 ? 6 : weekday - 1));
  return copy.toISOString().slice(0, 10);
}

/** Today, as a local `YYYY-MM-DD`. */
function todayString(date: Date): string {
  return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
    .toISOString()
    .slice(0, 10);
}

/** The lens values the URL accepts. */
const LENSES: readonly Lens[] = ['week', 'morning', 'evening'];

/** Narrow an arbitrary query value to a lens. */
function asLens(value: string | null): Lens | null {
  return value !== null && (LENSES as readonly string[]).includes(value) ? (value as Lens) : null;
}

/** Narrow an arbitrary query value to an ISO date. */
function asDate(value: string | null): string | null {
  return value !== null && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

/** Props for {@link PlanSurface}. */
export interface PlanSurfaceProps {
  /** Fixes "now" so a screenshot or a test is reproducible; defaults to the real clock. */
  readonly now?: Date;
  /** The lens to open on. */
  readonly initialLens?: Lens;
}

/**
 * The plan surface.
 *
 * @param props - Optional fixed clock and initial lens.
 * @returns the surface.
 */
export function PlanSurface(props: PlanSurfaceProps = {}): JSX.Element {
  // `?date=` and `?lens=` make the surface addressable: a link can open someone straight on the
  // morning walk-through for a specific day, which is exactly what a day-start deep link needs.
  const search = useAppSearchParams();
  const now = props.now ?? new Date();
  const date = asDate(search.get('date')) ?? todayString(now);
  const weekStartDate = asDate(search.get('week')) ?? weekStartOf(new Date(`${date}T12:00:00Z`));
  const [lens, setLens] = useState<Lens>(asLens(search.get('lens')) ?? props.initialLens ?? 'week');

  const week = useWeekPlan(weekStartDate);
  const dayStart = useDayStart(date);
  const directive = useDirective(date);
  const checkIns = useDayCheckIns(date);
  const review = useDayReview(date);

  const generate = useGenerateWeek(weekStartDate);
  const acknowledge = useAcknowledgeAgenda(date);
  const reorganize = useReorganizeDay(date);
  const respond = useRespondToCheckIn();
  const dispose = useDisposeReviewItem(date);
  const answer = useAnswerReviewPrompt(date);
  const confirm = useConfirmTomorrow(date);

  return (
    <div className="mx-auto flex h-full w-full max-w-7xl flex-col gap-8 px-6 py-10 @2xl:px-10">
      <Stack gap={2} as="header">
        <Text as="h1" token="headline-large">
          Plan
        </Text>
        <Text token="body-medium" tone="muted">
          One run lays out the week across every kind of time you work in. The day walks itself from
          there.
        </Text>
      </Stack>

      <Toolbar
        controlSize="md"
        leading={
          <ControlGroup controlSize="md">
            {(['week', 'morning', 'evening'] as const).map((option) => (
              <Button
                key={option}
                variant={lens === option ? 'secondary' : 'ghost'}
                aria-pressed={lens === option}
                onClick={() => {
                  setLens(option);
                }}
              >
                {LENS_LABEL[option]}
              </Button>
            ))}
          </ControlGroup>
        }
        trailing={null}
      />

      {lens === 'week' ? (
        <LensBody
          pending={week.isPending}
          error={week.isError}
          errorCopy="We could not load your week. Try again in a moment."
        >
          {week.data === undefined ? null : (
            <WeekPlanBoard
              plan={week.data}
              onGenerate={() => {
                generate.mutate({});
              }}
              generating={generate.isPending}
            />
          )}
        </LensBody>
      ) : null}

      {lens === 'morning' ? (
        <LensBody
          pending={dayStart.isPending}
          error={dayStart.isError}
          errorCopy="We could not load today's agenda. Try again in a moment."
        >
          {dayStart.data === undefined ? null : (
            <Stack gap={8}>
              <DayStartReview
                dayStart={dayStart.data}
                directive={directive.data}
                acknowledging={acknowledge.isPending}
                onAcknowledge={() => {
                  acknowledge.mutate({});
                }}
                onReorganize={() => {
                  reorganize.mutate({});
                }}
                reorganizing={reorganize.isPending}
              />
              {checkIns.data === undefined ? null : (
                <DayCheckIns
                  checkIns={checkIns.data.items}
                  timezone={dayStart.data.timezone}
                  busy={respond.isPending}
                  onRespond={(input) => {
                    respond.mutate(input);
                  }}
                />
              )}
            </Stack>
          )}
        </LensBody>
      ) : null}

      {lens === 'evening' ? (
        <LensBody
          pending={review.isPending}
          error={review.isError}
          errorCopy="We could not load your day review. Try again in a moment."
        >
          {review.data === undefined ? null : (
            <EveningReview
              review={review.data}
              busy={dispose.isPending || answer.isPending || confirm.isPending}
              onDispose={(input) => {
                dispose.mutate(input);
              }}
              onAnswer={(input) => {
                answer.mutate(input);
              }}
              onConfirmTomorrow={(acceptedKeys) => {
                confirm.mutate({ acceptedKeys });
              }}
            />
          )}
        </LensBody>
      ) : null}
    </div>
  );
}

/** Loading / error / content, with application-owned copy in every state. */
function LensBody(props: {
  readonly pending: boolean;
  readonly error: boolean;
  readonly errorCopy: string;
  readonly children: React.ReactNode;
}): JSX.Element {
  if (props.pending) {
    return (
      <Stack gap={3} aria-busy>
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
      </Stack>
    );
  }
  if (props.error) {
    return (
      <div role="alert" className="bg-surface-container-low rounded-xl p-6">
        <Text token="body-medium">{props.errorCopy}</Text>
      </div>
    );
  }
  return <>{props.children}</>;
}
