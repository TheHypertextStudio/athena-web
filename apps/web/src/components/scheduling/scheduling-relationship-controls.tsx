'use client';

import type { JSX, ReactNode } from 'react';

import { ObjectSurface } from '@/components/objects/object-surface';
import type { ObjectRef } from '@/lib/actions/object';

import type { ScheduleItem, ScheduleLane } from './scheduling-types';
import type { SchedulingRelationshipMode } from './use-scheduling-relationship-mode';

/** Render one Dnd Kit and keyboard relationship source control. */
export function SchedulingRelationshipSourceControl({
  item,
  object,
  mode,
  className,
  activeClassName,
  inactiveClassName = '',
  children,
}: {
  readonly item: ScheduleItem;
  readonly object: ObjectRef;
  readonly mode: SchedulingRelationshipMode;
  readonly className: string;
  readonly activeClassName: string;
  readonly inactiveClassName?: string;
  readonly children: ReactNode;
}): JSX.Element {
  const active = mode.source?.item.id === item.id;

  return (
    <ObjectSurface object={object} surfaceId="scheduling-relationship-control">
      <button
        type="button"
        aria-label={
          mode.enabled
            ? active
              ? `Cancel relationship from ${item.title}`
              : `Create relationship from ${item.title}`
            : `Drag ${item.title} to create a relationship`
        }
        aria-pressed={mode.enabled ? active : undefined}
        className={`${className} ${active ? activeClassName : inactiveClassName}`}
        onPointerDown={(event) => {
          event.stopPropagation();
        }}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (!mode.enabled) return;
          if (active) {
            mode.cancel();
            return;
          }
          mode.begin({
            item,
            object,
            control: event.currentTarget,
            focusFirstTarget: event.detail === 0,
          });
        }}
      >
        {children}
      </button>
    </ObjectSurface>
  );
}

/** Cover one eligible item with a clear, full-target relationship action while mode is active. */
export function SchedulingRelationshipTargetControl({
  item,
  lane,
  mode,
  className,
}: {
  readonly item: ScheduleItem;
  readonly lane: ScheduleLane;
  readonly mode: SchedulingRelationshipMode;
  readonly className: string;
}): JSX.Element | null {
  const source = mode.source;
  if (!source || !mode.isTarget(item)) return null;

  return (
    <button
      type="button"
      aria-label={`Link ${source.item.title} to ${item.title}`}
      className={className}
      data-schedule-relationship-target={item.id}
      onPointerDown={(event) => {
        event.stopPropagation();
      }}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        mode.activateTarget(item, lane);
      }}
    >
      <span className="bg-primary text-on-primary text-label-medium pointer-events-none rounded-full px-2 py-1">
        Link here
      </span>
    </button>
  );
}
