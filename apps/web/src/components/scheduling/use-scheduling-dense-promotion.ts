'use client';

import { type RefObject, useCallback, useLayoutEffect, useState } from 'react';

import type { ScheduleItemOpen } from './scheduling-types';

interface DenseSchedulePromotion {
  readonly laneId: string;
  readonly itemId: string;
  readonly preferRelationshipTarget: boolean;
}

/** Promote one disclosed collision item into the canvas's existing interaction surface. */
export function useSchedulingDensePromotion({
  viewportRef,
  relationshipTargeting,
  onAnnouncementChange,
}: {
  readonly viewportRef: RefObject<HTMLElement | null>;
  readonly relationshipTargeting: boolean;
  readonly onAnnouncementChange: (announcement: string) => void;
}): {
  readonly promotion: DenseSchedulePromotion | null;
  readonly revealItem: (request: ScheduleItemOpen) => void;
} {
  const [promotion, setPromotion] = useState<DenseSchedulePromotion | null>(null);

  useLayoutEffect(() => {
    if (!promotion) return;
    const itemElement = [
      ...(viewportRef.current?.querySelectorAll<HTMLElement>('[data-schedule-item]') ?? []),
    ].find((element) => element.dataset['scheduleItem'] === promotion.itemId);
    const relationshipTarget = promotion.preferRelationshipTarget
      ? itemElement?.querySelector<HTMLButtonElement>('[data-schedule-relationship-target]')
      : null;
    const itemBody = itemElement?.querySelector<HTMLButtonElement>(
      'button[data-schedule-item-body]',
    );
    (
      relationshipTarget ??
      itemBody ??
      itemElement?.querySelector<HTMLButtonElement>('button')
    )?.focus();
  }, [promotion, viewportRef]);

  const revealItem = useCallback(
    ({ item, lane }: ScheduleItemOpen): void => {
      setPromotion({
        laneId: lane.id,
        itemId: item.id,
        preferRelationshipTarget: relationshipTargeting,
      });
      onAnnouncementChange(
        `${item.title} is shown in ${lane.label}. Calendar controls are available.`,
      );
    },
    [onAnnouncementChange, relationshipTargeting],
  );

  return { promotion, revealItem };
}
