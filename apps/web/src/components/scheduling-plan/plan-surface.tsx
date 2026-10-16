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
import { ImmersiveShell } from '@docket/ui/components';
import Link from '@/components/docket-link';
import { QueryLoadFailure, type QueryFailureSource } from '@/components/feedback';
import { useAppSearchParams } from '@/lib/app-location';
import type { JSX } from 'react';
import { useState } from 'react';

import { DayCheckIns } from './day-check-ins';
import { DayStartReview } from './day-start-review';
import { DayHighlights } from '@/components/activity/day-highlights';

import { EveningReview } from './evening-review';
import {
  useAcknowledgeAgenda,
  useAnswerReviewPrompt,
  useConfirmTomorrow,
  useDayCheckIns,
  useDayReview,
  useDayStart,
  useDecideMorningProposal,
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
  return (
    <ImmersiveShell
      header={
        <Button asChild variant="ghost">
          <Link navigation="activity" href="/today">
            Back to Today
          </Link>
        </Button>
      }
    >
      <PlanContent {...props} />
    </ImmersiveShell>
  );
}

function PlanContent(props: PlanSurfaceProps): JSX.Element {
  // `?date=` and `?lens=` make the surface addressable: a link can open someone straight on the
  // morning walk-through for a specific day, which is exactly what a day-start deep link needs.
  const search = useAppSearchParams();
  const now = props.now ?? new Date();
  const date = asDate(search.get('date')) ?? todayString(now);
  // Only a day the person actually chose. The highlights panel treats an absent date as "today", and
  // lets the server resolve it from the Hub timezone rather than trusting this browser's clock —
  // which disagrees whenever they travel, and can ask for a day that has not happened.
  const explicitDate = asDate(search.get('date')) ?? undefined;
  const weekStartDate = asDate(search.get('week')) ?? weekStartOf(new Date(`${date}T12:00:00Z`));
  const [lens, setLens] = useState<Lens>(asLens(search.get('lens')) ?? props.initialLens ?? 'week');

  const week = useWeekPlan(weekStartDate);
  const dayStart = useDayStart(date);
  const directive = useDirective(date);
  const checkIns = useDayCheckIns(date);
  const review = useDayReview(date);

  const generate = useGenerateWeek(weekStartDate);
  const acknowledge = useAcknowledgeAgenda(date);
  const decide = useDecideMorningProposal(date);
  const reorganize = useReorganizeDay(date);
  const respond = useRespondToCheckIn();
  const dispose = useDisposeReviewItem(date);
  const answer = useAnswerReviewPrompt(date);
  const confirm = useConfirmTomorrow(date);

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 px-3 pb-4 sm:gap-6 sm:px-6 sm:pb-8 @2xl:px-10">
      <Stack gap={2} as="header">
        <Text as="h1" token="title-large" className="sm:text-headline-large">
          Plan
        </Text>
        <Text token="body-medium" tone="muted" className="hidden sm:block">
          Make room for work, review today, or prepare for tomorrow.
        </Text>
      </Stack>

      <Toolbar
        controlSize="md"
        leading={
          <ControlGroup controlSize="md" className="flex-wrap">
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
        <LensBody query={week} title="Your week">
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
        <LensBody query={dayStart} title="Today's agenda">
          {dayStart.data === undefined ? null : (
            <Stack gap={8}>
              <DayStartReview
                dayStart={dayStart.data}
                directive={directive.data}
                acknowledging={acknowledge.isPending}
                onAcknowledge={() => {
                  acknowledge.mutate({});
                }}
                onDecide={(input) => {
                  decide.mutate(input);
                }}
                deciding={decide.isPending}
                onReorganize={() => {
                  reorganize.mutate({});
                }}
                reorganizing={reorganize.isPending}
              />
              {checkIns.data === undefined || !dayStart.data.ready ? null : (
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
        <LensBody query={review} title="Your day review">
          {review.data === undefined ? null : (
            <EveningReview
              review={review.data}
              // Activity stays available as context without preceding the current review decision.
              leadingPanel={<DayHighlights date={explicitDate} mode="review" headingLevel={3} />}
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

/** The part of a lens's query that {@link LensBody} reads. */
interface LensQuery extends QueryFailureSource {
  readonly isPending: boolean;
  readonly isError: boolean;
}

/** Props for {@link LensBody}. */
interface LensBodyProps {
  /** The query feeding this lens. */
  readonly query: LensQuery;
  /** Name of what the lens shows, used when a failure carries nothing more specific. */
  readonly title: string;
  readonly children: React.ReactNode;
}

/** Loading / failed / content for one lens. */
function LensBody(props: LensBodyProps): JSX.Element {
  if (props.query.isPending) {
    return (
      <Stack gap={3} aria-busy>
        {/* placeholder: this lens's own heading and body, both read per lens. */}
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
      </Stack>
    );
  }
  if (props.query.isError) {
    return <QueryLoadFailure title={props.title} query={props.query} size="panel" />;
  }
  return <>{props.children}</>;
}
