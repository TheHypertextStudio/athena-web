'use client';

import type { EntityDisplayOut } from '@docket/work/entity-display-contract';
import { DatePicker, EntityPicker, InlineBanner, type PickerOption } from '@docket/ui/components';
import { RefreshCw } from '@docket/ui/icons';
import { type JSX, useMemo, useState } from 'react';

import { formatWindow } from '@/components/cycles/format-window';
import { cycleOptions } from '@/components/pickers/options';
import { endOfNextQuarter } from '@/lib/future-cycle-roster';
import { useFutureCycleRoster } from '@/lib/use-future-cycle-roster';

/** Props for the future-aware cycle assignment picker. */
export interface FutureCyclePickerProps {
  readonly orgId: string;
  readonly teamId: string;
  readonly cadenceDays?: number;
  readonly cadenceAnchor?: string;
  readonly value: string | null;
  readonly onChange: (cycleId: string | null, cadenceRevision?: number) => void;
  readonly displays?: readonly EntityDisplayOut[];
  readonly noun?: string;
  readonly placeholder?: string;
  readonly disabled?: boolean;
  readonly readOnly?: boolean;
  readonly triggerVariant?: 'ghost' | 'secondary';
  readonly triggerClassName?: string;
}

function groupedOptions(
  roster: ReturnType<typeof useFutureCycleRoster>,
  displays: readonly EntityDisplayOut[],
): readonly PickerOption[] {
  return [
    ...cycleOptions(roster.retained, formatWindow, displays).map((option) => ({
      ...option,
      group: 'Assigned',
    })),
    ...cycleOptions(roster.current, formatWindow, displays).map((option) => ({
      ...option,
      group: 'Current',
    })),
    ...cycleOptions(roster.upcoming, formatWindow, displays).map((option) => ({
      ...option,
      group: 'Upcoming',
    })),
  ];
}

function CycleDateFooter({
  roster,
  teamId,
  onResolve,
}: {
  readonly roster: ReturnType<typeof useFutureCycleRoster>;
  readonly teamId: string;
  readonly onResolve: (name: string) => void;
}): JSX.Element {
  return (
    <div className="bg-surface-container-low mx-2 mb-2 rounded-lg p-1.5">
      <DatePicker
        value={null}
        onChange={(date) => {
          if (!date) return;
          void roster
            .ensureThrough(date)
            .then((cycles) => {
              const target = cycles.find(
                (cycle) =>
                  cycle.teamId === teamId &&
                  cycle.startsAt.slice(0, 10) <= date &&
                  cycle.endsAt.slice(0, 10) >= date,
              );
              if (target) onResolve(target.displayName);
            })
            .catch(() => undefined);
        }}
        placeholder="Go to date…"
        ariaLabel="Go to date"
        min={roster.schedule.anchorDate}
        triggerClassName="w-full justify-start"
      />
    </div>
  );
}

/** Search, extend, and select one team's current or future cycle roster. */
export function FutureCyclePicker({
  orgId,
  teamId,
  cadenceDays,
  cadenceAnchor,
  value,
  onChange,
  displays = [],
  noun = 'Cycle',
  placeholder,
  disabled,
  readOnly,
  triggerVariant = 'ghost',
  triggerClassName,
}: FutureCyclePickerProps): JSX.Element {
  const [query, setQuery] = useState('');
  const roster = useFutureCycleRoster({
    orgId,
    teamId,
    ...(cadenceDays === undefined ? {} : { cadenceDays }),
    ...(cadenceAnchor === undefined ? {} : { cadenceAnchor }),
    selectedCycleId: value,
    enabled: true,
  });
  const options = useMemo(() => groupedOptions(roster, displays), [displays, roster]);
  const nounLower = noun.toLowerCase();

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <EntityPicker
        options={options}
        value={value}
        onChange={(cycleId) => {
          onChange(cycleId, roster.cadenceRevision);
        }}
        placeholder={placeholder ?? `No ${nounLower}`}
        triggerIcon={<RefreshCw className="text-on-surface-variant size-4" />}
        clearLabel={`No ${nounLower}`}
        searchPlaceholder={`Search ${nounLower}s…`}
        idleText={roster.loading ? 'Loading cycles…' : 'No current or upcoming cycles'}
        query={query}
        onQueryChange={setQuery}
        loading={roster.loading}
        onOpenChange={(open) => {
          if (!open) return;
          const today = new Date().toISOString().slice(0, 10);
          void roster.ensureThrough(endOfNextQuarter(today)).catch(() => undefined);
        }}
        ariaLabel={noun}
        disabled={Boolean(disabled) || !roster.ready}
        {...(readOnly === undefined ? {} : { readOnly })}
        triggerVariant={triggerVariant}
        {...(triggerClassName === undefined ? {} : { triggerClassName })}
        footer={<CycleDateFooter roster={roster} teamId={teamId} onResolve={setQuery} />}
      />
      {roster.error ? (
        <InlineBanner tone="critical" density="compact" title={roster.error} />
      ) : null}
    </div>
  );
}
