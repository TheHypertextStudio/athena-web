'use client';

import type { HubTaskItem, HubTodayOut } from '@docket/types';
import { useContextState } from '@docket/ui/components';
import { useMemo } from 'react';

import { useActiveOrg } from '@/components/active-org';
import { api } from '@/lib/api';
import { apiQueryOptions, queryKeys, useApiQuery } from '@/lib/query';
import { todayISODate } from '@/lib/today';
import { userErrorMessage } from '@/lib/problem';

/** A plan group: one organization and the caller's tasks for the day within it. */
export interface PlanGroup {
  orgId: string;
  orgName: string;
  tasks: HubTaskItem[];
}

/** All data + state the Today page needs from the data layer. */
export interface TodayPageData {
  data: HubTodayOut | null;
  loading: boolean;
  error: string | null;
  /** Force a re-fetch (error-state retry, or after a task is captured). */
  refetch: () => void;
  planGroups: PlanGroup[];
  taskTitle: (taskId: string) => string;
  planCount: number;
  inbox: number;
  attentionCount: number;
  activeOrgId: string | null;
  orgName: (orgId: string) => string;
  heading: string;
}

/**
 * Coordinates the Today screen's data via the shared {@link useApiQuery} layer: it auto-refetches
 * on window focus and after its 30s stale window, so the page needs no manual Refresh control.
 */
export function useTodayData(): TodayPageData {
  const { orgName } = useActiveOrg();
  const { activeOrgId } = useContextState();

  const date = todayISODate();
  const todayQ = useApiQuery(
    apiQueryOptions(
      queryKeys.today(date),
      () => api.v1.hub.today.$get({ query: { date } }),
      'Could not load your day.',
    ),
  );
  const data = todayQ.data ?? null;

  const heading = useMemo(
    () =>
      new Date().toLocaleDateString(undefined, {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      }),
    [],
  );

  const planGroups = useMemo<PlanGroup[]>(() => {
    if (!data) return [];
    const byOrg = new Map<string, PlanGroup>();
    for (const task of data.plan) {
      const group = byOrg.get(task.organizationId);
      if (group) group.tasks.push(task);
      else
        byOrg.set(task.organizationId, {
          orgId: task.organizationId,
          orgName: orgName(task.organizationId),
          tasks: [task],
        });
    }
    return [...byOrg.values()];
  }, [data, orgName]);

  const taskTitle = useMemo(() => {
    const byId = new Map<string, string>(data?.plan.map((t) => [t.id, t.title]) ?? []);
    return (taskId: string): string => byId.get(taskId) ?? 'Timeboxed work';
  }, [data]);

  const planCount = data?.plan.length ?? 0;
  const inbox = data?.needsAttention.inbox ?? 0;
  const attentionCount = data
    ? data.needsAttention.approvals.length +
      data.needsAttention.blocked.length +
      data.needsAttention.dueToday.length
    : 0;

  return {
    data,
    loading: todayQ.isPending,
    error: todayQ.error ? userErrorMessage(todayQ.error, 'Could not load today.') : null,
    refetch: () => {
      void todayQ.refetch();
    },
    planGroups,
    taskTitle,
    planCount,
    inbox,
    attentionCount,
    activeOrgId,
    orgName,
    heading,
  };
}
