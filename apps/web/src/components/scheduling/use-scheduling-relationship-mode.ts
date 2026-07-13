'use client';

import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import type {
  ScheduleDragObject,
  ScheduleItem,
  ScheduleLane,
  SchedulingCanvasProps,
} from './scheduling-types';

/** The consumer-owned object and rendered item that began relationship targeting. */
export interface SchedulingRelationshipSource {
  readonly item: ScheduleItem;
  readonly object: ScheduleDragObject;
  readonly focusFirstTarget: boolean;
}

/** Shared relationship-targeting state consumed by timed and all-day schedule items. */
export interface SchedulingRelationshipMode {
  readonly enabled: boolean;
  readonly source: SchedulingRelationshipSource | null;
  readonly begin: (options: {
    readonly item: ScheduleItem;
    readonly object: ScheduleDragObject;
    readonly control: HTMLButtonElement;
    readonly focusFirstTarget: boolean;
  }) => void;
  readonly cancel: () => void;
  readonly isTarget: (item: ScheduleItem) => boolean;
  readonly activateTarget: (item: ScheduleItem, lane: ScheduleLane) => void;
}

/** Own the short-lived keyboard/touch mode without changing the object-drop contract. */
export function useSchedulingRelationshipMode({
  viewportRef,
  onDropObjectOnItem,
  onAnnouncementChange,
}: {
  readonly viewportRef: RefObject<HTMLElement | null>;
  readonly onDropObjectOnItem?: SchedulingCanvasProps['onDropObjectOnItem'];
  readonly onAnnouncementChange: (announcement: string) => void;
}): SchedulingRelationshipMode {
  const [source, setSource] = useState<SchedulingRelationshipSource | null>(null);
  const sourceControlRef = useRef<HTMLButtonElement | null>(null);

  const restoreSourceFocus = useCallback((): void => {
    queueMicrotask(() => {
      sourceControlRef.current?.focus();
    });
  }, []);

  const cancel = useCallback((): void => {
    setSource(null);
    onAnnouncementChange('Relationship creation canceled.');
    restoreSourceFocus();
  }, [onAnnouncementChange, restoreSourceFocus]);

  const begin = useCallback(
    ({
      item,
      object,
      control,
      focusFirstTarget,
    }: {
      readonly item: ScheduleItem;
      readonly object: ScheduleDragObject;
      readonly control: HTMLButtonElement;
      readonly focusFirstTarget: boolean;
    }): void => {
      if (!onDropObjectOnItem) return;
      sourceControlRef.current = control;
      setSource({ item, object, focusFirstTarget });
      onAnnouncementChange(
        `Choose an event or timebox to link with ${item.title}. Press Escape to cancel.`,
      );
    },
    [onAnnouncementChange, onDropObjectOnItem],
  );

  const isTarget = useCallback(
    (item: ScheduleItem): boolean =>
      Boolean(
        source && onDropObjectOnItem && item.dropTarget === true && item.id !== source.item.id,
      ),
    [onDropObjectOnItem, source],
  );

  const activateTarget = useCallback(
    (item: ScheduleItem, lane: ScheduleLane): void => {
      if (!source || !onDropObjectOnItem || !isTarget(item)) return;
      onDropObjectOnItem({ object: source.object, targetItem: item, targetLane: lane });
      setSource(null);
      onAnnouncementChange(
        `Relationship requested between ${source.item.title} and ${item.title}.`,
      );
      restoreSourceFocus();
    },
    [isTarget, onAnnouncementChange, onDropObjectOnItem, restoreSourceFocus, source],
  );

  useEffect(() => {
    if (!source) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      cancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [cancel, source]);

  useLayoutEffect(() => {
    if (!source?.focusFirstTarget) return;
    viewportRef.current
      ?.querySelector<HTMLButtonElement>('[data-schedule-relationship-target]')
      ?.focus();
  }, [source, viewportRef]);

  return {
    enabled: onDropObjectOnItem !== undefined,
    source,
    begin,
    cancel,
    isTarget,
    activateTarget,
  };
}
