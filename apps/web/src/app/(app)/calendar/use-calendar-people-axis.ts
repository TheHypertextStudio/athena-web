'use client';

import { ActorId, type OrgSummary, type ScheduleComparisonOut } from '@docket/types';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { useActiveOrg } from '@/components/active-org';
import type { ScheduleLane } from '@/components/scheduling';
import { api } from '@/lib/api';
import { apiQueryOptions, queryKeys, STALE, useApiQuery } from '@/lib/query';

import { buildComparisonLane, dateRange, type CalendarAxis } from './calendar-schedule-model';
import type { SharedCalendarItemDetail } from './calendar-shared-item-details';

/** Minimal member projection needed by the comparison picker. */
export interface ComparisonMember {
  readonly actorId: string;
  readonly displayName: string;
}

/** State and actions for the arbitrary-person comparison axis. */
export interface CalendarPeopleAxisState {
  readonly sharedWorkspaces: readonly OrgSummary[];
  readonly comparisonOrgId: string;
  readonly selectedActorIds: readonly string[];
  readonly activeMembers: readonly ComparisonMember[];
  readonly lanes: readonly ScheduleLane[];
  readonly detailByItemId: ReadonlyMap<string, SharedCalendarItemDetail>;
  readonly membersPending: boolean;
  readonly error: boolean;
  readonly comparisonPending: boolean;
  readonly retrying: boolean;
  readonly retry: () => void;
  readonly selectWorkspace: (orgId: string) => void;
  readonly toggleActor: (actorId: string, selected: boolean) => void;
}

/** Load workspace members and permission-filtered schedules for an arbitrary actor selection. */
export function useCalendarPeopleAxis(
  axis: CalendarAxis,
  anchorDate: string,
  displayTimezone: string,
): CalendarPeopleAxisState {
  const { orgs } = useActiveOrg();
  const sharedWorkspaces = useMemo(() => orgs.filter((org) => !org.isPersonal), [orgs]);
  const [comparisonOrgId, setComparisonOrgId] = useState('');
  const [selectedActorIds, setSelectedActorIds] = useState<string[]>([]);
  const [initializedSelectionOrgId, setInitializedSelectionOrgId] = useState<string | null>(null);

  useEffect(() => {
    if (!comparisonOrgId && sharedWorkspaces[0]) setComparisonOrgId(sharedWorkspaces[0].id);
  }, [comparisonOrgId, sharedWorkspaces]);

  const membersQuery = useApiQuery(
    apiQueryOptions(
      queryKeys.members(comparisonOrgId || 'none'),
      () =>
        api.v1.orgs[':orgId'].members.$get({
          param: { orgId: comparisonOrgId },
        }),
      'Could not load workspace members.',
      { enabled: axis === 'people' && Boolean(comparisonOrgId), staleTime: STALE.standard },
    ),
  );
  const activeMembers = useMemo(
    () =>
      (membersQuery.data?.items ?? [])
        .filter((member) => member.status === 'active')
        .map((member) => ({ actorId: member.actorId, displayName: member.displayName })),
    [membersQuery.data],
  );

  useEffect(() => {
    if (
      axis !== 'people' ||
      !comparisonOrgId ||
      activeMembers.length === 0 ||
      initializedSelectionOrgId === comparisonOrgId
    ) {
      return;
    }
    setSelectedActorIds(activeMembers.map((member) => member.actorId));
    setInitializedSelectionOrgId(comparisonOrgId);
  }, [activeMembers, axis, comparisonOrgId, initializedSelectionOrgId]);

  const range = dateRange(anchorDate, 1, displayTimezone);
  const actorIdsKey = [...selectedActorIds].sort().join(',');
  const comparisonQuery = useApiQuery(
    apiQueryOptions(
      queryKeys.scheduleComparison(
        comparisonOrgId || 'none',
        actorIdsKey,
        range.startISO,
        range.endISO,
      ),
      () =>
        api.v1.orgs[':orgId'].calendar.schedules.$get({
          param: { orgId: comparisonOrgId },
          query: {
            start: range.startISO,
            end: range.endISO,
            actorIds: selectedActorIds,
          },
        }),
      'Could not compare schedules.',
      {
        enabled: axis === 'people' && Boolean(comparisonOrgId) && selectedActorIds.length > 0,
        staleTime: STALE.volatile,
      },
    ),
  );
  const peopleByActorId = useMemo<ReadonlyMap<string, ScheduleComparisonOut['people'][number]>>(
    () => new Map((comparisonQuery.data?.people ?? []).map((person) => [person.actorId, person])),
    [comparisonQuery.data],
  );
  const activeMemberByActorId = useMemo<ReadonlyMap<string, ComparisonMember>>(
    () => new Map(activeMembers.map((member) => [member.actorId, member])),
    [activeMembers],
  );
  const lanes = useMemo(
    () =>
      selectedActorIds.flatMap((actorId) => {
        const person = peopleByActorId.get(actorId);
        if (person) return [buildComparisonLane(person, anchorDate, displayTimezone)];
        const member = activeMemberByActorId.get(actorId);
        return member
          ? [
              buildComparisonLane(
                {
                  actorId: ActorId.parse(actorId),
                  displayName: member.displayName,
                  avatar: null,
                  timezone: null,
                  items: [],
                },
                anchorDate,
                displayTimezone,
              ),
            ]
          : [];
      }),
    [activeMemberByActorId, anchorDate, displayTimezone, peopleByActorId, selectedActorIds],
  );
  const detailByItemId = useMemo(
    () =>
      new Map(
        (comparisonQuery.data?.people ?? []).flatMap((person) =>
          person.items.flatMap((item) =>
            item.access === 'details'
              ? [
                  [
                    item.itemId,
                    {
                      personName: person.displayName,
                      personTimezone: person.timezone,
                      item,
                    },
                  ] as const,
                ]
              : [],
          ),
        ),
      ),
    [comparisonQuery.data],
  );
  const retry = useCallback(() => {
    if (membersQuery.isError) void membersQuery.refetch();
    if (comparisonQuery.isError) void comparisonQuery.refetch();
  }, [
    comparisonQuery.isError,
    comparisonQuery.refetch,
    membersQuery.isError,
    membersQuery.refetch,
  ]);

  return {
    sharedWorkspaces,
    comparisonOrgId,
    selectedActorIds,
    activeMembers,
    lanes,
    detailByItemId,
    membersPending: membersQuery.isPending,
    error: comparisonQuery.isError || membersQuery.isError,
    comparisonPending: selectedActorIds.length > 0 && comparisonQuery.isPending,
    retrying: membersQuery.isFetching || comparisonQuery.isFetching,
    retry,
    selectWorkspace: (orgId: string) => {
      if (orgId === comparisonOrgId) return;
      setComparisonOrgId(orgId);
      setSelectedActorIds([]);
    },
    toggleActor: (actorId: string, selected: boolean) => {
      setInitializedSelectionOrgId(comparisonOrgId);
      setSelectedActorIds((current) =>
        selected ? [...current, actorId] : current.filter((id) => id !== actorId),
      );
    },
  };
}
