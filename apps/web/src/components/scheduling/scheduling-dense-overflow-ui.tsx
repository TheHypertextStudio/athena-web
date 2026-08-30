'use client';

import {
  Button,
  Popover,
  PopoverBody,
  PopoverContent,
  PopoverHeader,
  PopoverTrigger,
} from '@docket/ui/primitives';
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
  readonly laneWidth?: number;
  readonly leadingInset?: number;
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
  laneWidth,
  leadingInset = 0,
  renderItem,
  onOpenItem,
  onRevealItem,
}: SchedulingDenseOverflowProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const revealingRef = useRef(false);
  const count = group.items.length;
  const label = `${String(count)} more events in ${lane.label}`;
  const horizontalStyle = scheduleOverlapHorizontalStyle(group.placement, laneWidth, leadingInset);
  const estimatedWidth =
    laneWidth === undefined
      ? Number.POSITIVE_INFINITY
      : Math.max(0, (laneWidth - leadingInset) / group.placement.columnCount - 2);
  const compactLabel = estimatedWidth < 96;

  return (
    <div
      className="absolute z-20"
      data-schedule-overflow-cluster={group.clusterId}
      data-schedule-leading-inset={leadingInset}
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
            className="bg-surface-container-high text-primary text-label-medium hover:bg-primary-container focus-visible:ring-ring size-full rounded-md px-1 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-inset motion-reduce:transition-none"
          >
            +{String(count)}
            {compactLabel ? '' : ' more'}
          </button>
        </PopoverTrigger>
        <PopoverContent
          presentation="panel"
          width="lg"
          aria-label={label}
          align="end"
          onCloseAutoFocus={(event) => {
            if (revealingRef.current) event.preventDefault();
            revealingRef.current = false;
          }}
        >
          <PopoverHeader inset="compact">
            <p className="text-label-medium text-on-surface-variant">{label}</p>
          </PopoverHeader>
          <PopoverBody className="flex flex-col gap-1" inset="compact">
            {group.items.map(({ item }) => {
              const timeRange =
                formatScheduleInstantRange(item.startsAt, item.endsAt, displayTimezone) ??
                'Unavailable time';
              const content =
                renderItem?.({ item, lane, allDay: false, density: 'compact' }) ?? item.title;
              const children = (
                <>
                  <span
                    aria-hidden="true"
                    className="bg-primary h-8 w-1 shrink-0 rounded-full"
                    style={item.color ? { backgroundColor: item.color } : undefined}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="text-on-surface text-body-medium block truncate">
                      {content}
                    </span>
                    <span className="text-on-surface-variant text-body-small block truncate tabular-nums">
                      {timeRange}
                    </span>
                  </span>
                </>
              );
              return (
                <div key={item.id} className="flex min-w-0 items-stretch gap-1">
                  {item.openable !== false && onOpenItem ? (
                    <Button
                      type="button"
                      aria-label={`Open ${item.title}, ${timeRange}`}
                      variant="ghost"
                      className="h-auto min-h-11 min-w-0 flex-1 justify-start gap-2 px-2 py-2 text-left"
                      onClick={() => {
                        setOpen(false);
                        onOpenItem({ item, lane });
                      }}
                    >
                      {children}
                    </Button>
                  ) : (
                    <div className="text-on-surface flex min-h-11 min-w-0 flex-1 items-center gap-2 px-2 py-2">
                      {children}
                    </div>
                  )}
                  {onRevealItem ? (
                    <Button
                      type="button"
                      aria-label={`Show ${item.title} on calendar`}
                      variant="ghost"
                      size="sm"
                      className="min-h-11 shrink-0 px-2"
                      onClick={() => {
                        revealingRef.current = true;
                        setOpen(false);
                        onRevealItem({ item, lane });
                      }}
                    >
                      Show
                    </Button>
                  ) : null}
                </div>
              );
            })}
          </PopoverBody>
        </PopoverContent>
      </Popover>
    </div>
  );
}
