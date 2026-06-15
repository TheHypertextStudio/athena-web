'use client';

import type { HubTaskItem, HubTodayOut } from '@docket/types';
import { useContextState } from '@docket/ui/components';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { useActiveOrg } from '@/components/active-org';
import { api } from '@/lib/api';
import { readError, readProblem } from '@/lib/problem';
import { todayISODate } from '@/lib/today';

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
  refreshing: boolean;
  error: string | null;
  load: (initial: boolean) => Promise<void>;
  planGroups: PlanGroup[];
  taskTitle: (taskId: string) => string;
  planCount: number;
  inbox: number;
  attentionCount: number;
  activeOrgId: string | null;
  orgName: (orgId: string) => string;
  heading: string;
}

/** useTodayData coordinates today state, loading, and mutations for its screen. */
export function useTodayData(): TodayPageData {
  const { orgName } = useActiveOrg();
  const { activeOrgId } = useContextState();

  const [data, setData] = useState<HubTodayOut | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (initial: boolean): Promise<void> => {
    if (initial) setLoading(true);
    else setRefreshing(true);
    setError(null);
    const date = todayISODate();
    try {
      const res = await api.v1.hub.today.$get({ query: { date } });
      if (!res.ok) {
        setError(await readProblem(res, 'Could not load your day.'));
        return;
      }
      setData(await res.json());
    } catch (caught) {
      setError(readError(caught, 'Something went wrong loading your day.'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load(true);
  }, [load]);

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
    loading,
    refreshing,
    error,
    load,
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
