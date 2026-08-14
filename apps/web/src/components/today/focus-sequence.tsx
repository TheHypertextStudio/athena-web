'use client';

import type { HubTodayFocus, HubTodayPlanItem } from '@docket/types';
import { AlarmClock, ArrowRight, Check, Ellipsis } from '@docket/ui/icons';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Popover,
  PopoverAnchor,
  PopoverContent,
} from '@docket/ui/primitives';
import Link from 'next/link';
import { type JSX, useRef, useState } from 'react';

import { TimeboxForm } from '@/components/agenda/agenda-timebox-form';
import { OrgChip } from '@/components/org-chip';
import { TaskTimerButton } from '@/components/time-tracking/task-timer-button';

/** Inline mutations supported by the finite Today sequence. */
export interface FocusSequenceProps {
  readonly focus: HubTodayFocus;
  readonly orgName: (organizationId: string) => string;
  readonly completing: boolean;
  readonly onComplete: (item: HubTodayPlanItem) => void;
  readonly onDefer: (item: HubTodayPlanItem) => void;
  readonly onPromote: (item: HubTodayPlanItem, beforeSort: number) => void;
  readonly onTimebox: (item: HubTodayPlanItem, startsAt: string, endsAt: string) => void;
  readonly date: string;
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

function FocusCard({
  item,
  label,
  primary,
  orgName,
  completing,
  onComplete,
  onDefer,
  onPromote,
  onTimebox,
  beforeSort,
  date,
  displayTimezone,
}: {
  readonly item: HubTodayPlanItem;
  readonly label: 'Now' | 'After this';
  readonly primary: boolean;
  readonly orgName: (organizationId: string) => string;
  readonly completing: boolean;
  readonly onComplete: (item: HubTodayPlanItem) => void;
  readonly onDefer: (item: HubTodayPlanItem) => void;
  readonly onPromote: (item: HubTodayPlanItem, beforeSort: number) => void;
  readonly onTimebox: (item: HubTodayPlanItem, startsAt: string, endsAt: string) => void;
  readonly beforeSort: number | null;
  readonly date: string;
  readonly displayTimezone: string;
}): JSX.Element {
  const time = timing(item, displayTimezone);
  return (
    <article
      aria-label={`${label}: ${item.title}`}
      className={
        primary
          ? 'border-primary/25 bg-surface-container-lowest shadow-elevation-1 rounded-2xl border p-5 @xl:p-6'
          : 'border-outline-variant bg-surface-container-low/55 rounded-xl border p-4 @xl:ml-8'
      }
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p
            className={`${primary ? 'text-primary' : 'text-on-surface-variant'} text-label-large font-semibold`}
          >
            {label}
          </p>
          <Link
            href={`/orgs/${item.organizationId}/tasks/${item.id}`}
            className="text-on-surface focus-visible:ring-ring mt-1 block text-lg font-semibold text-balance hover:underline focus-visible:rounded focus-visible:ring-2 focus-visible:outline-none"
          >
            {item.title}
          </Link>
        </div>
        <OrgChip orgId={item.organizationId} name={orgName(item.organizationId)} />
      </div>
      <div className="text-on-surface-variant text-body-small mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span>{item.reason}</span>
        {time ? (
          <span className="inline-flex items-center gap-1">
            <AlarmClock aria-hidden="true" className="size-3.5" /> {time}
          </span>
        ) : null}
        <span className="capitalize">{item.state.replaceAll('_', ' ')}</span>
      </div>
      <FocusActions
        item={item}
        completing={completing}
        beforeSort={beforeSort}
        date={date}
        displayTimezone={displayTimezone}
        onComplete={onComplete}
        onDefer={onDefer}
        onPromote={onPromote}
        onTimebox={onTimebox}
      />
    </article>
  );
}

function FocusActions({
  item,
  completing,
  beforeSort,
  date,
  displayTimezone,
  onComplete,
  onDefer,
  onPromote,
  onTimebox,
}: {
  readonly item: HubTodayPlanItem;
  readonly completing: boolean;
  readonly beforeSort: number | null;
  readonly date: string;
  readonly displayTimezone: string;
  readonly onComplete: (item: HubTodayPlanItem) => void;
  readonly onDefer: (item: HubTodayPlanItem) => void;
  readonly onPromote: (item: HubTodayPlanItem, beforeSort: number) => void;
  readonly onTimebox: (item: HubTodayPlanItem, startsAt: string, endsAt: string) => void;
}): JSX.Element {
  const [timeboxOpen, setTimeboxOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [announcement, setAnnouncement] = useState('');
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
          <div className="mt-4 flex min-h-11 items-center gap-2">
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
            <div className="ml-auto hidden min-w-0 items-center gap-1 @lg:flex">
              {beforeSort !== null ? (
                <Button
                  type="button"
                  variant="ghost"
                  className="min-h-11"
                  onClick={() => {
                    onPromote(item, beforeSort);
                    setAnnouncement(`${item.title} is now first in your plan.`);
                  }}
                >
                  Make next
                </Button>
              ) : null}
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
            </div>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" className="ml-auto min-h-11 @lg:hidden">
                <Ellipsis aria-hidden="true" /> More
              </Button>
            </DropdownMenuTrigger>
          </div>
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
          {beforeSort !== null ? (
            <DropdownMenuItem
              onSelect={() => {
                onPromote(item, beforeSort);
                setAnnouncement(`${item.title} is now first in your plan.`);
              }}
            >
              Make next
            </DropdownMenuItem>
          ) : null}
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
      <span className="sr-only" aria-live="polite">
        {announcement}
      </span>
    </Popover>
  );
}

/** Render the single current action and the single action immediately following it. */
export default function FocusSequence({
  focus,
  orgName,
  completing,
  onComplete,
  onDefer,
  onPromote,
  onTimebox,
  date,
  displayTimezone,
}: FocusSequenceProps): JSX.Element | null {
  if (!focus.now && !focus.after) return null;
  return (
    <section aria-labelledby="whats-next-heading" className="flex flex-col gap-3">
      <h2 id="whats-next-heading" className="text-on-surface text-title-large font-semibold">
        What’s next
      </h2>
      {focus.now ? (
        <FocusCard
          item={focus.now}
          label="Now"
          primary
          orgName={orgName}
          completing={completing}
          onComplete={onComplete}
          onDefer={onDefer}
          onPromote={onPromote}
          onTimebox={onTimebox}
          beforeSort={null}
          date={date}
          displayTimezone={displayTimezone}
        />
      ) : null}
      {focus.after ? (
        <FocusCard
          item={focus.after}
          label="After this"
          primary={false}
          orgName={orgName}
          completing={completing}
          onComplete={onComplete}
          onDefer={onDefer}
          onPromote={onPromote}
          onTimebox={onTimebox}
          beforeSort={
            focus.now &&
            focus.now.reason !== 'Focus timer is running' &&
            focus.now.reason !== 'Scheduled now'
              ? focus.now.sort
              : null
          }
          date={date}
          displayTimezone={displayTimezone}
        />
      ) : null}
    </section>
  );
}
