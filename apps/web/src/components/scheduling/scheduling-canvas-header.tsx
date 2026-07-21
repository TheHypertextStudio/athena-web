import type { JSX, RefObject } from 'react';

import { SchedulingAllDayLane } from './scheduling-all-day-lane';
import { SchedulingCanvasNotice } from './scheduling-canvas-notice';
import type { ScheduleLane, SchedulingCanvasProps } from './scheduling-types';
import type { SchedulingRelationshipMode } from './use-scheduling-relationship-mode';

/** Render sticky lane headings, all-day items, and fail-soft calendar notices. */
export function SchedulingCanvasHeader({
  lanes,
  displayTimezone,
  viewportRef,
  gutterWidth,
  contentWidth,
  laneWidth,
  viewportWidth,
  emptyMessage,
  error,
  renderItem,
  onOpenItem,
  onMoveAllDayItem,
  onResizeAllDayItem,
  onDropObjectOnItem,
  relationshipMode,
  onGestureAnnouncementChange,
}: {
  readonly lanes: readonly ScheduleLane[];
  readonly displayTimezone: string;
  readonly viewportRef: RefObject<HTMLElement | null>;
  readonly gutterWidth: number;
  readonly contentWidth: number;
  readonly laneWidth: number;
  readonly viewportWidth: number;
  readonly emptyMessage: string;
  readonly error?: string | null;
  readonly renderItem?: SchedulingCanvasProps['renderItem'];
  readonly onOpenItem?: SchedulingCanvasProps['onOpenItem'];
  readonly onMoveAllDayItem?: SchedulingCanvasProps['onMoveAllDayItem'];
  readonly onResizeAllDayItem?: SchedulingCanvasProps['onResizeAllDayItem'];
  readonly onDropObjectOnItem?: SchedulingCanvasProps['onDropObjectOnItem'];
  readonly relationshipMode: SchedulingRelationshipMode;
  readonly onGestureAnnouncementChange: (announcement: string) => void;
}): JSX.Element {
  return (
    <header className="bg-surface-container-low sticky top-0 z-[60] flex">
      <div
        className="text-on-surface-variant bg-surface-container-low border-outline-variant/50 sticky left-0 z-[70] shrink-0 self-stretch border-r px-2 py-3 text-[11px] font-medium"
        style={{ width: gutterWidth }}
      >
        All day
      </div>
      <div className="flex" style={{ width: contentWidth }}>
        {lanes.map((lane, laneIndex) => (
          <div
            key={lane.id}
            className="border-outline-variant/50 min-w-0 shrink-0 border-r px-2 py-2"
            style={{ width: laneWidth }}
          >
            <p className="text-on-surface truncate text-xs font-semibold">{lane.label}</p>
            <p className="text-on-surface-variant truncate text-[10px] tabular-nums">
              <span>{lane.date}</span>
              {lane.timezone ? <span className="ml-1">{lane.timezone}</span> : null}
            </p>
            <SchedulingAllDayLane
              lane={lane}
              laneIndex={laneIndex}
              lanes={lanes}
              displayTimezone={displayTimezone}
              laneWidth={laneWidth}
              viewportRef={viewportRef}
              renderItem={renderItem}
              onOpenItem={onOpenItem}
              onMoveAllDayItem={onMoveAllDayItem}
              onResizeAllDayItem={onResizeAllDayItem}
              onDropObjectOnItem={onDropObjectOnItem}
              relationshipMode={relationshipMode}
              onGestureAnnouncementChange={onGestureAnnouncementChange}
            />
          </div>
        ))}
      </div>
      <SchedulingCanvasNotice
        emptyMessage={emptyMessage}
        error={error}
        gutterWidth={gutterWidth}
        isEmpty={lanes.every((lane) => lane.items.length === 0)}
        viewportWidth={viewportWidth}
      />
    </header>
  );
}
