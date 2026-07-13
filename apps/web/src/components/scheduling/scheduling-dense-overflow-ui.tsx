'use client';

import { Popover, PopoverContent, PopoverTrigger } from '@docket/ui/primitives';
import { type JSX, useRef, useState } from 'react';

import type { DenseScheduleOverflowGroup } from './scheduling-dense-overflow';
import { scheduleOverlapHorizontalStyle } from './scheduling-overlap-layout';
import { formatScheduleInstantRange } from './scheduling-time-label';
import type { ScheduleItemOpen, ScheduleLane, SchedulingCanvasProps } from './scheduling-types';

/** Props for one measured dense-overlap disclosure. */
interface SchedulingDenseOverflowProps {
  readonly group: DenseScheduleOverflowGroup;
  readonly lane: ScheduleLane;
  readonly displayTimezone: string;
  readonly renderItem?: SchedulingCanvasProps['renderItem'];
  readonly onOpenItem?: SchedulingCanvasProps['onOpenItem'];
  readonly onRevealItem?: (request: ScheduleItemOpen) => void;
}

/**
 * Render width-constrained events as an accessible `+N` popover instead of sub-pixel cards.
 *
 * @remarks
 * The trigger occupies a real collision column and remains keyboard/touch operable. Every hidden
 * item is named with its exact time range and remains openable when the consumer supports details.
 */
export function SchedulingDenseOverflow({
  group,
  lane,
  displayTimezone,
  renderItem,
  onOpenItem,
  onRevealItem,
}: SchedulingDenseOverflowProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const revealingRef = useRef(false);
  const count = group.items.length;
  const label = `${String(count)} more events in ${lane.label}`;
  const horizontalStyle = scheduleOverlapHorizontalStyle(group.placement);

  return (
    <div
      className="absolute z-20"
      data-schedule-overflow-cluster={group.clusterId}
      style={{
        top: group.top,
        height: group.height,
        ...horizontalStyle,
      }}
    >
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={`Show ${label}`}
            className="border-outline-variant bg-surface-container-high text-primary hover:bg-primary-container focus-visible:ring-ring size-full rounded-md border px-1 text-xs font-semibold shadow-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-inset motion-reduce:transition-none"
          >
            +{String(count)}
          </button>
        </PopoverTrigger>
        <PopoverContent
          role="dialog"
          aria-label={label}
          align="end"
          className="z-[90] w-80 max-w-[calc(100vw-2rem)] p-2"
          onCloseAutoFocus={(event) => {
            if (revealingRef.current) event.preventDefault();
            revealingRef.current = false;
          }}
        >
          <p className="text-on-surface px-2 py-1 text-xs font-semibold">{label}</p>
          <div className="flex max-h-72 flex-col overflow-y-auto" role="list">
            {group.items.map(({ item }) => {
              const timeRange =
                formatScheduleInstantRange(item.startsAt, item.endsAt, displayTimezone) ??
                'Unavailable time';
              const content =
                renderItem?.({ item, lane, allDay: false, density: 'compact' }) ?? item.title;
              const sharedClassName =
                'focus-visible:ring-ring hover:bg-surface-container-highest flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded px-2 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset';
              const children = (
                <>
                  <span
                    aria-hidden="true"
                    className="bg-primary h-8 w-1 shrink-0 rounded-full"
                    style={item.color ? { backgroundColor: item.color } : undefined}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="text-on-surface block truncate text-xs font-medium">
                      {content}
                    </span>
                    <span className="text-on-surface-variant block truncate text-[10px] tabular-nums">
                      {timeRange}
                    </span>
                  </span>
                </>
              );
              return (
                <div key={item.id} role="listitem" className="flex min-w-0 items-stretch gap-1">
                  {item.openable !== false && onOpenItem ? (
                    <button
                      type="button"
                      aria-label={`Open ${item.title}, ${timeRange}`}
                      className={sharedClassName}
                      onClick={() => {
                        setOpen(false);
                        onOpenItem({ item, lane });
                      }}
                    >
                      {children}
                    </button>
                  ) : (
                    <div className={sharedClassName}>{children}</div>
                  )}
                  {onRevealItem ? (
                    <button
                      type="button"
                      aria-label={`Show ${item.title} on calendar`}
                      className="text-primary hover:bg-primary-container focus-visible:ring-ring min-h-11 min-w-11 shrink-0 rounded px-2 text-[10px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-inset"
                      onClick={() => {
                        revealingRef.current = true;
                        setOpen(false);
                        onRevealItem({ item, lane });
                      }}
                    >
                      Show
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
