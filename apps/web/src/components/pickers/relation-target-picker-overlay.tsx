'use client';

import { PickerList, type PickerOption } from '@docket/ui/components';
import { Calendar, GanttChart, ListChecks, Users } from '@docket/ui/icons';
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  type PopoverVirtualAnchor,
  Button,
  Skeleton,
} from '@docket/ui/primitives';
import { RELATION_DEFINITIONS } from '@docket/work/relation-contract';
import { type JSX, useCallback, useMemo, useRef, useState } from 'react';

import { calendarItemsDef } from '@/components/calendar/calendar-data';
import { CalendarTimeField } from '@/components/calendar/calendar-time-field';
import {
  fromLocalInputValue,
  type LocalInputOccurrence,
  localInputResolutionError,
} from '@/components/calendar/datetime-input';
import type { RelationTargetPickerRequest } from '@/components/pickers/picker-overlay';
import {
  type ComposerOptionKind,
  useComposerOptions,
} from '@/components/pickers/use-composer-options';
import { useActionDispatch, useActionRegistry } from '@/lib/actions';
import { api } from '@/lib/api';
import { userErrorMessage } from '@/lib/problem';
import { apiQueryOptions, queryKeys, STALE, useApiListQuery } from '@/lib/query';

/** Props for the relation target picker. */
export interface RelationTargetPickerOverlayProps {
  readonly request: RelationTargetPickerRequest;
  readonly onClose: () => void;
}

/** Choose a target and invoke the same relation action that a pointer drop invokes. */
export function RelationTargetPickerOverlay({
  request,
  onClose,
}: RelationTargetPickerOverlayProps): JSX.Element {
  const organizationId = request.organizationId ?? '';
  const [slotStart, setSlotStart] = useState('');
  const [slotOccurrence, setSlotOccurrence] = useState<LocalInputOccurrence | null>(null);
  const [slotError, setSlotError] = useState<string | null>(null);
  const displayTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const relation = RELATION_DEFINITIONS.find(({ id }) => id === request.relationId);
  const targetKind = relation?.targetKind;
  const composerKind: ComposerOptionKind | null =
    targetKind === 'actor'
      ? 'actors'
      : targetKind === 'project'
        ? 'projects'
        : targetKind === 'program'
          ? 'programs'
          : targetKind === 'initiative'
            ? 'initiatives'
            : targetKind === 'label'
              ? 'labels'
              : targetKind === 'cycle'
                ? 'cycles'
                : targetKind === 'milestone'
                  ? 'milestones'
                  : null;
  const composer = useComposerOptions(
    organizationId,
    composerKind === null ? [] : [composerKind],
    composerKind !== null,
  );
  const tasksQ = useApiListQuery(
    apiQueryOptions(
      queryKeys.tasks(organizationId),
      () => api.v1.orgs[':orgId'].tasks.$get({ param: { orgId: organizationId }, query: {} }),
      'Could not load tasks.',
      { enabled: targetKind === 'task', staleTime: STALE.volatile },
    ),
  );
  const teamsQ = useApiListQuery(
    apiQueryOptions(
      queryKeys.teams(organizationId),
      () => api.v1.orgs[':orgId'].teams.$get({ param: { orgId: organizationId } }),
      'Could not load teams.',
      { enabled: targetKind === 'team', staleTime: STALE.static },
    ),
  );
  const calendarWindow = useMemo(() => {
    const start = new Date();
    start.setDate(start.getDate() - 30);
    const end = new Date();
    end.setDate(end.getDate() + 90);
    return { start: start.toISOString(), end: end.toISOString() };
  }, []);
  const calendarQ = useApiListQuery({
    ...calendarItemsDef(calendarWindow.start, calendarWindow.end),
    enabled: targetKind === 'calendar_item',
  });
  const registry = useActionRegistry();
  const dispatch = useActionDispatch();
  const options = useMemo<readonly PickerOption[]>(() => {
    switch (targetKind) {
      case 'actor':
        return composer.actorOptions;
      case 'project':
        return composer.projectOptions;
      case 'program':
        return composer.programOptions;
      case 'initiative':
        return composer.initiativeOptions;
      case 'label':
        return composer.labelOptions;
      case 'cycle':
        return composer.cycles.map((cycle) => ({
          value: cycle.id,
          label: cycle.displayName,
          icon: <GanttChart aria-hidden className="size-5" />,
        }));
      case 'milestone':
        return composer.milestones.map((milestone) => ({
          value: milestone.id,
          label: milestone.name,
        }));
      case 'task':
        return (tasksQ.data?.items ?? []).map((task) => ({
          value: task.id,
          label: task.title,
          icon: <ListChecks aria-hidden className="size-5" />,
        }));
      case 'team':
        return (teamsQ.data?.items ?? []).map((team) => ({
          value: team.id,
          label: team.name,
          icon: <Users aria-hidden className="size-5" />,
        }));
      case 'calendar_item':
        return (calendarQ.data?.items ?? []).map((item) => ({
          value: item.id,
          label: item.title,
          icon: <Calendar aria-hidden className="size-5" />,
          supporting: item.startsAt ? new Date(item.startsAt).toLocaleString() : 'All day',
        }));
      default:
        return [];
    }
  }, [calendarQ.data, composer, targetKind, tasksQ.data, teamsQ.data]);
  const anchorRef = useRef<PopoverVirtualAnchor | null>(
    request.anchor ??
      (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null),
  );
  const closedRef = useRef(false);
  const close = useCallback(() => {
    if (closedRef.current) return;
    closedRef.current = true;
    if (anchorRef.current instanceof HTMLElement) anchorRef.current.focus();
    onClose();
  }, [onClose]);
  const activeError = tasksQ.error ?? teamsQ.error ?? calendarQ.error;
  const loading = composer.loading || tasksQ.isLoading || teamsQ.isLoading || calendarQ.isLoading;
  const targetNoun = targetKind?.replace('_', ' ') ?? 'item';

  return (
    <Popover
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <PopoverAnchor virtualRef={anchorRef} />
      <PopoverContent
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (anchorRef.current instanceof HTMLElement) anchorRef.current.focus();
        }}
      >
        {activeError ? (
          <div
            role="alert"
            className="text-error bg-error/5 border-error/30 text-body-medium m-1 rounded-md border px-3 py-2"
          >
            {userErrorMessage(activeError, `Could not load ${targetNoun}s.`)}
          </div>
        ) : loading ? (
          <div className="flex flex-col gap-1.5 p-1.5" aria-hidden="true">
            <Skeleton className="h-10 w-full rounded-md" />
            <Skeleton className="h-10 w-full rounded-md" />
            <Skeleton className="h-10 w-full rounded-md" />
          </div>
        ) : targetKind === 'calendar_slot' ? (
          <form
            className="flex min-w-72 flex-col gap-3 p-3"
            onSubmit={(event) => {
              event.preventDefault();
              const resolutionError = localInputResolutionError(
                slotStart,
                displayTimezone,
                slotOccurrence,
                'start',
              );
              setSlotError(resolutionError);
              if (resolutionError !== null) return;
              const instant = fromLocalInputValue(slotStart, displayTimezone, slotOccurrence);
              const action = registry.getByRelation(request.relationId);
              if (action === undefined || instant === null) return;
              const startsAt = new Date(instant);
              const endsAt = new Date(startsAt.getTime() + 30 * 60 * 1000);
              void dispatch(action.id, () => ({
                objects: request.subjects,
                target: {
                  kind: 'calendar_slot',
                  id: startsAt.toISOString(),
                  organizationId: request.organizationId,
                  title: startsAt.toLocaleString(),
                  meta: { startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() },
                },
                source: 'button',
                organizationId: request.organizationId,
              })).then(close);
            }}
          >
            <CalendarTimeField
              label="Schedule start"
              value={slotStart}
              displayTimezone={displayTimezone}
              occurrence={slotOccurrence}
              invalid={slotError !== null}
              describedBy={slotError === null ? undefined : 'relation-slot-error'}
              onValueChange={(value) => {
                setSlotStart(value);
                setSlotOccurrence(null);
                setSlotError(null);
              }}
              onOccurrenceChange={(occurrence) => {
                setSlotOccurrence(occurrence);
                setSlotError(null);
              }}
            />
            {slotError ? (
              <p id="relation-slot-error" role="alert" className="text-error text-body-small">
                {slotError}
              </p>
            ) : null}
            <Button type="submit" disabled={slotStart.length === 0}>
              Schedule for 30 minutes
            </Button>
          </form>
        ) : (
          <PickerList
            options={options}
            selected={null}
            onSelect={(targetId) => {
              const option = options.find(({ value }) => value === targetId);
              const action = registry.getByRelation(request.relationId);
              if (
                option === undefined ||
                action === undefined ||
                relation === undefined ||
                targetKind === undefined ||
                targetKind === 'initiative_root'
              )
                return;
              const calendarItem =
                targetKind === 'calendar_item'
                  ? calendarQ.data?.items.find((item) => item.id === targetId)
                  : undefined;
              void dispatch(action.id, () => ({
                objects: request.subjects,
                target: {
                  kind:
                    targetKind === 'calendar_item'
                      ? calendarItem?.kind === 'native_block' || calendarItem?.kind === 'timebox'
                        ? 'time_block'
                        : 'calendar_event'
                      : targetKind,
                  id: targetId,
                  organizationId: targetKind === 'calendar_item' ? null : organizationId,
                  title: option.label,
                  ...(targetKind === 'milestone'
                    ? {
                        meta: {
                          projectId:
                            composer.milestones.find(({ id }) => id === targetId)?.projectId ??
                            null,
                        },
                      }
                    : {}),
                },
                source: 'button',
                organizationId,
              })).then(close);
            }}
            searchPlaceholder={`Choose a ${targetNoun}…`}
            emptyText={`No ${targetNoun}s`}
            ariaLabel={`Target ${targetNoun}`}
            clear={null}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}
