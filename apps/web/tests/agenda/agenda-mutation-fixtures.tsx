/** Shared fixtures for Agenda plan and timebox mutation behavior tests. */
import { DailyPlanItemId } from '@docket/planning/ids';
import { type AgendaOut } from '@docket/planning/agenda-contract';
import { type DailyPlanItemOut } from '@docket/planning/daily-plan-contract';
import { type HubTodayOut } from '../../src/lib/contracts/hub';
import { OrganizationId } from '@docket/identity-access/ids';
import { TaskId } from '@docket/work/ids';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { JSX, ReactNode } from 'react';

import type { AgendaEntry } from '../../src/components/agenda/agenda-context';

export const DAY = '2026-07-01';
export const TARGET_DAY = '2026-07-02';
export const ORG_ID = OrganizationId.parse('01BX5ZZKBKACTAV9WEVGEMMVRZ');
export const TASK_ID = TaskId.parse('01ARZ3NDEKTSV4RRFFQ69G5FA0');
export const PLAN_ITEM_ID = DailyPlanItemId.parse('01BX5ZZKBKACTAV9WEVGEMMVS1');
export const OLD_START = '2026-07-01T16:00:00.000Z';
export const OLD_END = '2026-07-01T17:00:00.000Z';
export const NEW_START = '2026-07-01T18:00:00.000Z';
export const NEW_END = '2026-07-01T19:00:00.000Z';
export const LATER_START = '2026-07-01T20:00:00.000Z';
export const LATER_END = '2026-07-01T21:00:00.000Z';

/** Return a planned task rendered by the Agenda surface. */
export function agendaEntry(): AgendaEntry {
  return {
    id: TASK_ID,
    source: 'task',
    taskId: TASK_ID,
    organizationId: ORG_ID,
    title: 'Draft launch memo',
    startsAt: OLD_START,
    endsAt: OLD_END,
    sort: 0,
    done: false,
    planItemId: PLAN_ITEM_ID,
  };
}

/** Return the daily-plan metadata projected alongside the rendered Agenda. */
export function dailyPlanItem(): DailyPlanItemOut {
  return {
    id: PLAN_ITEM_ID,
    refOrganizationId: ORG_ID,
    refTaskId: TASK_ID,
    date: DAY,
    sort: 0,
    status: 'planned',
    timeboxStartsAt: OLD_START,
    timeboxEndsAt: OLD_END,
    createdAt: '2026-07-01T00:00:00.000Z',
  };
}

/** Return the combined Agenda projection for the fixture task. */
export function agendaOut(): AgendaOut {
  return {
    date: DAY,
    entries: [
      {
        kind: 'task_timebox',
        taskId: TASK_ID,
        organizationId: ORG_ID,
        title: 'Draft launch memo',
        state: 'in_progress',
        priority: 'medium',
        startsAt: OLD_START,
        endsAt: OLD_END,
      },
    ],
  };
}

/** Return the Hub Today projection that shares the fixture task's timebox. */
export function todayOut(): HubTodayOut {
  return {
    date: DAY,
    planState: 'active',
    brief: { text: 'Your next two moves are ready.', href: null, attentionCount: 0 },
    plan: [
      {
        id: TASK_ID,
        organizationId: ORG_ID,
        title: 'Draft launch memo',
        summary: null,
        state: 'in_progress',
        stateType: 'started',
        priority: 'medium',
        planItemId: PLAN_ITEM_ID,
        planStatus: 'planned',
        sort: 0,
        position: 0,
        estimateMinutes: 60,
        timeboxStartsAt: OLD_START,
        timeboxEndsAt: OLD_END,
        blocked: false,
        dependencyImpact: 0,
        reason: 'Scheduled now',
      },
    ],
    focus: {
      now: {
        id: TASK_ID,
        organizationId: ORG_ID,
        title: 'Draft launch memo',
        summary: null,
        state: 'in_progress',
        stateType: 'started',
        priority: 'medium',
        planItemId: PLAN_ITEM_ID,
        planStatus: 'planned',
        sort: 0,
        position: 0,
        estimateMinutes: 60,
        timeboxStartsAt: OLD_START,
        timeboxEndsAt: OLD_END,
        blocked: false,
        dependencyImpact: 0,
        reason: 'Scheduled now',
      },
      after: null,
    },
    statusCards: [],
    suggestions: [],
    calendar: [
      {
        taskId: TASK_ID,
        organizationId: ORG_ID,
        startsAt: OLD_START,
        endsAt: OLD_END,
      },
    ],
    needsAttention: { approvals: [], blocked: [], dueToday: [], inbox: 0 },
  };
}

/** Create an isolated QueryClient and React wrapper for a hook behavior test. */
export function makeWrapper(): {
  client: QueryClient;
  wrapper: (props: { children: ReactNode }) => JSX.Element;
} {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }): JSX.Element => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}
