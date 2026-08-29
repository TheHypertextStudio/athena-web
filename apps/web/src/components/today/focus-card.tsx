'use client';

/**
 * `today/focus-card` — the one plan item you are on, rendered above the rest of the day.
 *
 * @remarks
 * This was `focus-sequence`, a standalone section rendering two cards labelled "Now" and "After
 * this" — the only two of the day's tasks the page showed at all. The rest of `plan[]` was fetched
 * and dropped, so a fifteen-item day and a two-item day drew the identical surface.
 *
 * The day is now one list (`todays-work.tsx`), and this is its promoted first entry: the same task
 * the sequence called "Now", carrying the inline actions that only make sense for the thing you are
 * actually doing — the timer, complete, the timebox popover, defer. "After this" is no longer a
 * second card; it is simply the next row.
 *
 * The card is a filled surface rather than an outlined one. It needs to read as *more* than the
 * rows beneath it, and a tonal step does that without spending a border on a page that is trying to
 * lose them.
 */
import type { HubTodayPlanItem } from '@docket/types';
import { AlarmClock, ArrowRight, Check, Ellipsis } from '@docket/ui/icons';
import {
  Button,
  Card,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Popover,
  PopoverAnchor,
  PopoverContent,
  Row,
  Stack,
} from '@docket/ui/primitives';
import Link from '@/components/docket-link';
import { type JSX, useRef, useState } from 'react';

import { TimeboxForm } from '@/components/agenda/agenda-timebox-form';
import { OrgChip } from '@/components/org-chip';
import { TaskTimerButton } from '@/components/time-tracking/task-timer-button';

/** Props for {@link FocusCard}. */
export interface FocusCardProps {
  /** The plan item being worked on now. */
  readonly item: HubTodayPlanItem;
  /** Resolve a workspace's display name. */
  readonly orgName: (organizationId: string) => string;
  /** Whether a completion is in flight. */
  readonly completing: boolean;
  readonly onComplete: (item: HubTodayPlanItem) => void;
  readonly onDefer: (item: HubTodayPlanItem) => void;
  readonly onTimebox: (item: HubTodayPlanItem, startsAt: string, endsAt: string) => void;
  /** The day this card belongs to, for the timebox form. */
  readonly date: string;
  /** The timezone times are read in. */
  readonly displayTimezone: string;
}

function timing(item: HubTodayPlanItem, displayTimezone: string): string | null {
  if (item.timeboxStartsAt) {
    return new Date(item.timeboxStartsAt).toLocaleTimeString([], {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: displayTimezone,
    });
  }
  return item.estimateMinutes ? `${String(item.estimateMinutes)} min` : null;
}

/** The single item you are on now: a filled surface carrying its own inline actions. */
export function FocusCard({
  item,
  orgName,
  completing,
  onComplete,
  onDefer,
  onTimebox,
  date,
  displayTimezone,
}: FocusCardProps): JSX.Element {
  const time = timing(item, displayTimezone);
  return (
    <Card role="article" aria-label={`Now: ${item.title}`} className="p-4 @xl:p-5">
      <Row gap={4} align="start" justify="between">
        <Stack className="min-w-0">
          <p className="text-primary text-label-large">Now</p>
          <Link
            href={`/orgs/${item.organizationId}/tasks/${item.id}`}
            className="text-on-surface text-title-medium focus-visible:ring-ring mt-1 block text-balance hover:underline focus-visible:rounded focus-visible:ring-2 focus-visible:outline-none"
          >
            {item.title}
          </Link>
        </Stack>
        <OrgChip orgId={item.organizationId} name={orgName(item.organizationId)} />
      </Row>
      <Row gap={3} className="text-on-surface-variant text-body-small mt-2 flex-wrap">
        <span>{item.reason}</span>
        {time ? (
          <span className="inline-flex items-center gap-1">
            <AlarmClock aria-hidden="true" className="size-3.5" /> {time}
          </span>
        ) : null}
        <span className="capitalize">{item.state.replaceAll('_', ' ')}</span>
      </Row>
      <FocusActions
        item={item}
        completing={completing}
        date={date}
        displayTimezone={displayTimezone}
        onComplete={onComplete}
        onDefer={onDefer}
        onTimebox={onTimebox}
      />
    </Card>
  );
}

function FocusActions({
  item,
  completing,
  date,
  displayTimezone,
  onComplete,
  onDefer,
  onTimebox,
}: {
  readonly item: HubTodayPlanItem;
  readonly completing: boolean;
  readonly date: string;
  readonly displayTimezone: string;
  readonly onComplete: (item: HubTodayPlanItem) => void;
  readonly onDefer: (item: HubTodayPlanItem) => void;
  readonly onTimebox: (item: HubTodayPlanItem, startsAt: string, endsAt: string) => void;
}): JSX.Element {
  const [timeboxOpen, setTimeboxOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const openingTimebox = useRef(false);
  const timeboxLabel = item.timeboxStartsAt ? 'Adjust timebox' : 'Set timebox';
  const taskHref = `/orgs/${item.organizationId}/tasks/${item.id}`;
  const openTimebox = (): void => {
    openingTimebox.current = true;
    setMenuOpen(false);
    setTimeboxOpen(true);
  };

  return (
    <Popover open={timeboxOpen} onOpenChange={setTimeboxOpen}>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <PopoverAnchor asChild>
          <Row gap={2} className="mt-4 min-h-11">
            <TaskTimerButton taskId={item.id} title={item.title} />
            <Button
              type="button"
              variant="outline"
              disabled={completing}
              onClick={() => {
                onComplete(item);
              }}
              className="hidden min-h-11 shrink-0 @md:inline-flex"
            >
              <Check aria-hidden="true" /> Mark complete
            </Button>
            <Row gap={1} className="ml-auto hidden @lg:flex">
              <Button type="button" variant="ghost" className="min-h-11" onClick={openTimebox}>
                {timeboxLabel}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="min-h-11"
                onClick={() => {
                  onDefer(item);
                }}
              >
                Defer
              </Button>
              <Button asChild variant="ghost" className="min-h-11">
                <Link href={taskHref}>
                  Open <ArrowRight aria-hidden="true" />
                </Link>
              </Button>
            </Row>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" className="ml-auto min-h-11 @lg:hidden">
                <Ellipsis aria-hidden="true" /> More
              </Button>
            </DropdownMenuTrigger>
          </Row>
        </PopoverAnchor>
        <DropdownMenuContent
          align="end"
          width="sm"
          onCloseAutoFocus={(event) => {
            if (!openingTimebox.current) return;
            openingTimebox.current = false;
            event.preventDefault();
          }}
        >
          <DropdownMenuItem
            disabled={completing}
            onSelect={() => {
              onComplete(item);
            }}
          >
            Mark complete
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={openTimebox}>{timeboxLabel}…</DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              onDefer(item);
            }}
          >
            Defer
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href={taskHref}>Open task</Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <PopoverContent align="end" className="w-80">
        <TimeboxForm
          startsAt={item.timeboxStartsAt}
          endsAt={item.timeboxEndsAt}
          date={date}
          displayTimezone={displayTimezone}
          onSetTimebox={(startsAt, endsAt) => {
            onTimebox(item, startsAt, endsAt);
          }}
          onDone={() => {
            setTimeboxOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
