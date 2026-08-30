'use client';

/**
 * `today/focus-card` — the one plan item you are on, rendered above the rest of the day.
 *
 * @remarks
 * This was `focus-sequence`, a standalone section rendering two cards labelled "Now" and "After
 * this" — the only two of the day's tasks the page showed at all. The rest of `plan[]` was fetched
 * and dropped, so a fifteen-item day and a two-item day drew the identical surface.
 *
 * The day is now one list (`day-plan.tsx`), and this is its promoted first entry: the same task
 * the sequence called "Now", carrying the inline actions that only make sense for the thing you are
 * actually doing — the timer, complete, the timebox popover, defer. "After this" is no longer a
 * second card; it is simply the next row.
 *
 * The card is a filled surface rather than an outlined one. It needs to read as *more* than the
 * rows beneath it, and a tonal step does that without spending a border on a page that is trying to
 * lose them.
 */
import type { HubTodayPlanItem } from '@docket/types';
import { StatusIcon } from '@docket/ui/components';
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
  ControlGroup,
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
          {/* The same status glyph every row on this page carries. It used to be spelled out as a
              word on the meta line below — the workspace's own state key, rendered as text, under a
              card that says "Now". The glyph says it in the shared vocabulary instead. */}
          <Row gap={2} align="start" className="mt-1">
            <StatusIcon type={item.stateType} />
            <Link
              href={`/orgs/${item.organizationId}/tasks/${item.id}`}
              className="text-on-surface text-title-medium focus-visible:ring-ring block text-balance hover:underline focus-visible:rounded focus-visible:ring-2 focus-visible:outline-none"
            >
              {item.title}
            </Link>
          </Row>
          {/* Tier one is `task.summary`, written on the write path; the server falls back to a
              lead-sentence extract of the description and sends null only when there is neither.
              Nothing is reserved for the null case — an empty line under a title is what makes a
              card look unwritten, whereas a card that simply ends after its title still carries a
              glyph, a workspace, its timing, and its actions. */}
          {item.summary ? (
            <p className="text-on-surface-variant text-body-small mt-1 line-clamp-2">
              {item.summary}
            </p>
          ) : null}
        </Stack>
        <OrgChip orgId={item.organizationId} name={orgName(item.organizationId)} />
      </Row>
      {/* Only facts that change what to do: a deadline or running timer (`reason`), and when it is
          scheduled or how long it should take (`time`). The row disappears when there are neither,
          rather than standing empty or being padded with the task's own state spelled out. */}
      {(item.reason ?? time) ? (
        <Row gap={3} className="text-on-surface-variant text-body-small mt-2 flex-wrap">
          {item.reason ? <span>{item.reason}</span> : null}
          {time ? (
            <span className="inline-flex items-center gap-1">
              <AlarmClock aria-hidden="true" className="size-3.5" /> {time}
            </span>
          ) : null}
        </Row>
      ) : null}
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
          {/* One primary, one secondary, everything else behind `⋯`. Five ghost buttons in a row
              gave completing the task, starting a timer, scheduling it, deferring it, and opening
              it identical weight, so the card asked the reader to rank them. */}
          <ControlGroup controlSize="sm" className="mt-3">
            <Button
              type="button"
              disabled={completing}
              onClick={() => {
                onComplete(item);
              }}
            >
              <Check aria-hidden="true" /> Complete
            </Button>
            <TaskTimerButton taskId={item.id} title={item.title} />
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" iconOnly aria-label="More actions">
                <Ellipsis aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <Button asChild variant="ghost" className="ml-auto">
              <Link href={taskHref}>
                Open <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
          </ControlGroup>
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
