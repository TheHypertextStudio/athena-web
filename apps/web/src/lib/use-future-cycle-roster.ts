'use client';

import type { CycleOut } from '@docket/work/cycle-contract';
import type { CycleSchedule } from '@docket/work/cycle-schedule';

import { groupFutureCycles } from '@/lib/future-cycle-roster';
import { useFutureCycleLoader } from '@/lib/use-future-cycle-loader';

/** State and actions shared by every future-cycle assignment picker. */
export interface FutureCycleRosterState {
  readonly cycles: readonly CycleOut[];
  readonly retained: readonly CycleOut[];
  readonly current: readonly CycleOut[];
  readonly upcoming: readonly CycleOut[];
  /** Whether the initial cycle list and authoritative team cadence have loaded. */
  readonly ready: boolean;
  readonly loading: boolean;
  readonly error: string | null;
  readonly schedule: CycleSchedule;
  readonly cadenceRevision?: number;
  readonly providerOwned: boolean;
  readonly ensureThrough: (date: string) => Promise<readonly CycleOut[]>;
}

/** Load one team's future-aware cycle roster and materialize bounded ranges on demand. */
export function useFutureCycleRoster(input: {
  readonly orgId: string;
  readonly teamId: string;
  readonly cadenceDays?: number;
  readonly cadenceAnchor?: string;
  readonly selectedCycleId: string | null;
  readonly enabled: boolean;
}): FutureCycleRosterState {
  const loader = useFutureCycleLoader(input);
  const cycles = loader.cycles;
  const groups = groupFutureCycles(
    cycles,
    input.teamId,
    input.selectedCycleId,
    new Date().toISOString().slice(0, 10),
  );
  return {
    ...loader,
    ...groups,
  };
}
