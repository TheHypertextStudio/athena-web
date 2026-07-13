'use client';

import type { OrgSummary } from '@docket/types';
import { useEffect, useMemo, useState } from 'react';

import { useActiveOrg } from '@/components/active-org';
import type { ScheduleLane } from '@/components/scheduling';
import { api } from '@/lib/api';
import { apiQueryOptions, queryKeys, STALE, useApiListQuery } from '@/lib/query';

import { buildComparisonLane, dateRange, type CalendarAxis } from './calendar-schedule-model';

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
  readonly membersPending: boolean;
  readonly error: boolean;
  readonly comparisonPending: boolean;
  readonly selectWorkspace: (orgId: string) => void;
  readonly toggleActor: (actorId: string, selected: boolean) => void;
}

/** Load workspace members and permission-filtered schedules for an arbitrary actor selection. */
export function useCalendarPeopleAxis(
  axis: CalendarAxis,
  anchorDate: string,
): CalendarPeopleAxisState {
  const { orgs } = useActiveOrg();
  const sharedWorkspaces = useMemo(() => orgs.filter((org) => !org.isPersonal), [orgs]);
  const [comparisonOrgId, setComparisonOrgId] = useState('');
  const [selectedActorIds, setSelectedActorIds] = useState<string[]>([]);

  useEffect(() => {
    if (!comparisonOrgId && sharedWorkspaces[0]) setComparisonOrgId(sharedWorkspaces[0].id);
  }, [comparisonOrgId, sharedWorkspaces]);

  const membersQuery = useApiListQuery(
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
    if (axis !== 'people' || activeMembers.length === 0 || selectedActorIds.length > 0) return;
    setSelectedActorIds(activeMembers.map((member) => member.actorId));
  }, [activeMembers, axis, selectedActorIds.length]);

  const range = dateRange(anchorDate, 1);
  const actorIdsKey = [...selectedActorIds].sort().join(',');
  const comparisonQuery = useApiListQuery(
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
  const lanes = useMemo(
    () =>
      (comparisonQuery.data?.people ?? []).map((person) => buildComparisonLane(person, anchorDate)),
    [anchorDate, comparisonQuery.data],
  );

  return {
    sharedWorkspaces,
    comparisonOrgId,
    selectedActorIds,
    activeMembers,
    lanes,
    membersPending: membersQuery.isPending,
    error: comparisonQuery.isError || membersQuery.isError,
    comparisonPending: comparisonQuery.isPending,
    selectWorkspace: (orgId: string) => {
      setComparisonOrgId(orgId);
      setSelectedActorIds([]);
    },
    toggleActor: (actorId: string, selected: boolean) => {
      setSelectedActorIds((current) =>
        selected ? [...current, actorId] : current.filter((id) => id !== actorId),
      );
    },
  };
}
