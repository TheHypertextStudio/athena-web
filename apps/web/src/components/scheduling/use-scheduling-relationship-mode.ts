'use client';

import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { resolveObjectRelation } from '@/components/dnd/object-drag-data';
import type { ObjectRef } from '@/lib/actions/object';
import { useOptionalActionRegistry } from '@/lib/actions/registry-context';

import type { ScheduleItem, ScheduleLane } from './scheduling-types';

/** The consumer-owned object and rendered item that began relationship targeting. */
export interface SchedulingRelationshipSource {
  readonly item: ScheduleItem;
  readonly object: ObjectRef;
  readonly focusFirstTarget: boolean;
}

/** Shared relationship-targeting state consumed by timed and all-day schedule items. */
export interface SchedulingRelationshipMode {
  readonly enabled: boolean;
  readonly source: SchedulingRelationshipSource | null;
  readonly begin: (options: {
    readonly item: ScheduleItem;
    readonly object: ObjectRef;
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
  onAnnouncementChange,
}: {
  readonly viewportRef: RefObject<HTMLElement | null>;
  readonly onAnnouncementChange: (announcement: string) => void;
}): SchedulingRelationshipMode {
  const registry = useOptionalActionRegistry();
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
      readonly object: ObjectRef;
      readonly control: HTMLButtonElement;
      readonly focusFirstTarget: boolean;
    }): void => {
      if (!registry) return;
      sourceControlRef.current = control;
      setSource({ item, object, focusFirstTarget });
      onAnnouncementChange(
        `Choose an event or timebox to link with ${item.title}. Press Escape to cancel.`,
      );
    },
    [onAnnouncementChange, registry],
  );

  const isTarget = useCallback(
    (item: ScheduleItem): boolean =>
      Boolean(
        source &&
        registry &&
        item.object &&
        item.dropTarget === true &&
        item.id !== source.item.id &&
        (() => {
          const resolution = resolveObjectRelation([source.object], item.object);
          return resolution.accepted && registry.getByRelation(resolution.intent.relationId);
        })(),
      ),
    [registry, source],
  );

  const activateTarget = useCallback(
    (item: ScheduleItem, _lane: ScheduleLane): void => {
      if (!source || !registry || !item.object || !isTarget(item)) return;
      const targetObject = item.object;
      const resolution = resolveObjectRelation([source.object], targetObject);
      if (!resolution.accepted) return;
      const action = registry.getByRelation(resolution.intent.relationId);
      if (!action) return;
      void registry.invoke(action.id, () => ({
        objects: [source.object],
        target: targetObject,
        source: 'shortcut',
        organizationId: source.object.organizationId,
        actionScope: 'all',
        params: { relationId: resolution.intent.relationId },
      }));
      setSource(null);
      onAnnouncementChange(
        `Relationship requested between ${source.item.title} and ${item.title}.`,
      );
      restoreSourceFocus();
    },
    [isTarget, onAnnouncementChange, registry, restoreSourceFocus, source],
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
    enabled: registry !== null,
    source,
    begin,
    cancel,
    isTarget,
    activateTarget,
  };
}
