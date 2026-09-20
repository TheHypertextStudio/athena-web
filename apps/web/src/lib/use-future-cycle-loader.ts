'use client';

import type { CycleOut } from '@docket/work/cycle-contract';
import type { CycleSchedule } from '@docket/work/cycle-schedule';
import { useCallback, useMemo } from 'react';

import { api } from '@/lib/api';
import { ensureCycleRanges } from '@/lib/future-cycle-roster';
import {
  apiQueryOptions,
  queryKeys,
  STALE,
  unwrap,
  useApiMutation,
  useApiQuery,
} from '@/lib/query';

interface TeamCyclePolicy {
  readonly cycleCadenceAnchor: string;
  readonly cycleCadenceDays: number;
  readonly cycleCadenceRevision: number;
  readonly cycleCadenceProviderOwned: boolean;
}

interface EnsureFutureCyclesInput {
  readonly date: string;
  readonly schedule: CycleSchedule;
  readonly cadenceAnchor?: string | undefined;
  readonly cadenceDays?: number | undefined;
  readonly needsSchedule: boolean;
  readonly loadTeam: () => Promise<TeamCyclePolicy | undefined>;
  readonly ensureRange: (range: { fromDate: string; throughDate: string }) => Promise<void>;
  readonly refreshCycles: () => Promise<readonly CycleOut[]>;
}

async function ensureFutureCycles(input: EnsureFutureCyclesInput): Promise<readonly CycleOut[]> {
  const team = input.needsSchedule ? await input.loadTeam() : undefined;
  const schedule = {
    anchorDate: input.cadenceAnchor ?? team?.cycleCadenceAnchor ?? input.schedule.anchorDate,
    cadenceDays: input.cadenceDays ?? team?.cycleCadenceDays ?? input.schedule.cadenceDays,
  };
  if (team?.cycleCadenceProviderOwned) return input.refreshCycles();
  const today = new Date().toISOString().slice(0, 10);
  const fromDate = today < schedule.anchorDate ? schedule.anchorDate : today;
  await ensureCycleRanges(schedule, fromDate, input.date, input.ensureRange);
  return input.refreshCycles();
}

function cadenceRevision(value: number | undefined): { readonly cadenceRevision?: number } {
  return value === undefined ? {} : { cadenceRevision: value };
}

function loaderError(
  cyclesFailed: boolean,
  teamFailed: boolean,
  ensureFailed: boolean,
): string | null {
  return cyclesFailed || teamFailed || ensureFailed
    ? 'Could not load future cycles. Try again.'
    : null;
}

/** Query and mutation state used to materialize a future cycle roster. */
export interface FutureCycleLoaderState {
  readonly cycles: readonly CycleOut[];
  readonly ready: boolean;
  readonly loading: boolean;
  readonly error: string | null;
  readonly schedule: CycleSchedule;
  readonly cadenceRevision?: number;
  readonly providerOwned: boolean;
  readonly ensureThrough: (date: string) => Promise<readonly CycleOut[]>;
}

/** Load team cadence metadata and materialize bounded future ranges on demand. */
export function useFutureCycleLoader(input: {
  readonly orgId: string;
  readonly teamId: string;
  readonly cadenceDays?: number;
  readonly cadenceAnchor?: string;
  readonly enabled: boolean;
}): FutureCycleLoaderState {
  const cyclesQuery = useApiQuery(
    apiQueryOptions(
      queryKeys.cycles(input.orgId),
      () => api.v1.orgs[':orgId'].cycles.$get({ param: { orgId: input.orgId }, query: {} }),
      'Could not load cycles.',
      { enabled: input.enabled, staleTime: STALE.static },
    ),
  );
  const needsSchedule = input.cadenceDays === undefined || input.cadenceAnchor === undefined;
  const teamQuery = useApiQuery(
    apiQueryOptions(
      queryKeys.team(input.orgId, input.teamId),
      () =>
        api.v1.orgs[':orgId'].teams[':teamId'].$get({
          param: { orgId: input.orgId, teamId: input.teamId },
        }),
      'Could not load cycle settings.',
      { enabled: input.enabled && needsSchedule, staleTime: STALE.static },
    ),
  );
  const ensureMutation = useApiMutation({
    mutationFn: (range: { fromDate: string; throughDate: string }) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].cycles.ensure.$post({
            param: { orgId: input.orgId },
            json: { teamId: input.teamId, ...range },
          }),
        'Could not load future cycles.',
      ),
  });
  const schedule = useMemo<CycleSchedule>(
    () => ({
      anchorDate: input.cadenceAnchor ?? teamQuery.data?.cycleCadenceAnchor ?? '2024-01-01',
      cadenceDays: input.cadenceDays ?? teamQuery.data?.cycleCadenceDays ?? 7,
    }),
    [input.cadenceAnchor, input.cadenceDays, teamQuery.data],
  );
  const ensureThrough = useCallback(
    (date: string) =>
      ensureFutureCycles({
        date,
        schedule,
        cadenceAnchor: input.cadenceAnchor,
        cadenceDays: input.cadenceDays,
        needsSchedule,
        loadTeam: async () => teamQuery.data ?? (await teamQuery.refetch()).data,
        ensureRange: async (range) => {
          await ensureMutation.mutateAsync(range);
        },
        refreshCycles: async () => (await cyclesQuery.refetch()).data?.items ?? [],
      }),
    [
      cyclesQuery,
      ensureMutation.mutateAsync,
      input.cadenceAnchor,
      input.cadenceDays,
      needsSchedule,
      schedule,
      teamQuery,
    ],
  );
  return {
    cycles: cyclesQuery.data?.items ?? [],
    schedule,
    ...cadenceRevision(teamQuery.data?.cycleCadenceRevision),
    providerOwned: teamQuery.data?.cycleCadenceProviderOwned ?? false,
    ready: cyclesQuery.data !== undefined && (!needsSchedule || teamQuery.data !== undefined),
    loading: cyclesQuery.isLoading || teamQuery.isLoading || ensureMutation.isPending,
    error: loaderError(cyclesQuery.isError, teamQuery.isError, ensureMutation.isError),
    ensureThrough,
  };
}
