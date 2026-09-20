'use client';

import { cycleWindowsThrough } from '@docket/work/cycle-schedule';
import { InlineBanner } from '@docket/ui/components';
import { Button, Field, Input, Surface } from '@docket/ui/primitives';
import { type ChangeEventHandler, type JSX, useMemo, useState } from 'react';

import { formatWindow } from '@/components/cycles/format-window';
import { api } from '@/lib/api';
import type { TeamDetail } from '@/lib/contracts/team';
import { queryKeys, unwrap, useApiMutation } from '@/lib/query';
import { userErrorMessage } from '@/lib/problem';

function dateAfter(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function inputValue(onChange: (value: string) => void): ChangeEventHandler<HTMLInputElement> {
  return (event) => {
    onChange(event.target.value);
  };
}

/** Props for the team cadence settings form. */
export interface TeamCycleSettingsProps {
  readonly orgId: string;
  readonly team: TeamDetail;
}

/** Build the three windows shown before a cadence change is saved. */
export function cycleCadencePreview(
  anchorDate: string,
  cadenceDays: number,
): ReturnType<typeof cycleWindowsThrough> {
  return cycleWindowsThrough(
    { anchorDate, cadenceDays },
    dateAfter(anchorDate, cadenceDays * 3 - 1),
  ).slice(0, 3);
}

function CyclePreview({
  windows,
}: {
  readonly windows: ReturnType<typeof cycleWindowsThrough>;
}): JSX.Element {
  return (
    <div aria-label="Cycle preview" className="flex flex-col gap-2">
      <h3 className="text-on-surface text-title-small">Next three cycles</h3>
      <div className="grid gap-2 sm:grid-cols-3">
        {windows.map((window) => (
          <Surface key={window.startDate} tone="card" shape="medium" pad="tight">
            <p className="text-on-surface text-label-large">
              {formatWindow(window.startsAt.toISOString(), window.endsAt.toISOString())}
            </p>
          </Surface>
        ))}
      </div>
    </div>
  );
}

function CadenceFeedback({
  successMessage,
  errorMessage,
}: {
  readonly successMessage?: string;
  readonly errorMessage?: string;
}): JSX.Element {
  return (
    <>
      {successMessage ? (
        <p role="status" className="text-on-surface-variant text-body-small">
          {successMessage}
        </p>
      ) : null}
      {errorMessage ? (
        <InlineBanner tone="critical" density="compact" title={errorMessage} />
      ) : null}
    </>
  );
}

function CycleCadenceForm({
  cadenceDays,
  earliestAnchor,
  effectiveAnchor,
  validDays,
  preview,
  pending,
  successMessage,
  errorMessage,
  onCadenceChange,
  onAnchorChange,
  onSubmit,
}: {
  readonly cadenceDays: string;
  readonly earliestAnchor: string;
  readonly effectiveAnchor: string;
  readonly validDays: boolean;
  readonly preview: ReturnType<typeof cycleWindowsThrough>;
  readonly pending: boolean;
  readonly successMessage?: string | undefined;
  readonly errorMessage?: string | undefined;
  readonly onCadenceChange: (value: string) => void;
  readonly onAnchorChange: (value: string) => void;
  readonly onSubmit: () => void;
}): JSX.Element {
  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (validDays) onSubmit();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Cycle length"
          description="Calendar days per cycle. Use 1 for daily cycles."
          {...(!validDays ? { error: 'Enter a whole number from 1 through 365.' } : {})}
        >
          <Input
            aria-label="Cycle length"
            type="number"
            inputMode="numeric"
            min={1}
            max={365}
            value={cadenceDays}
            onChange={inputValue(onCadenceChange)}
          />
        </Field>
        <Field
          label="New cadence starts"
          description={`The old schedule is preserved through ${dateAfter(earliestAnchor, -1)}.`}
        >
          <Input
            aria-label="New cadence starts"
            type="date"
            min={earliestAnchor}
            value={effectiveAnchor}
            onChange={inputValue(onAnchorChange)}
          />
        </Field>
      </div>
      <CyclePreview windows={preview} />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={!validDays || pending}>
          {pending ? 'Saving…' : 'Save cadence'}
        </Button>
        <CadenceFeedback
          {...(successMessage === undefined ? {} : { successMessage })}
          {...(errorMessage === undefined ? {} : { errorMessage })}
        />
      </div>
    </form>
  );
}

/** Edit and preview one team's native cycle cadence without moving existing assignments. */
export function TeamCycleSettings({ orgId, team }: TeamCycleSettingsProps): JSX.Element {
  const providerOwned = team.cycleCadenceProviderOwned;
  const earliestAnchor = team.cycleCadenceEarliestAnchor;
  const [cadenceDays, setCadenceDays] = useState(String(team.cycleCadenceDays));
  const [anchor, setAnchor] = useState(earliestAnchor);
  const effectiveAnchor = anchor < earliestAnchor ? earliestAnchor : anchor;
  const days = Number(cadenceDays);
  const validDays = Number.isInteger(days) && days >= 1 && days <= 365;
  const preview = useMemo(
    () => (validDays ? cycleCadencePreview(effectiveAnchor, days) : []),
    [days, effectiveAnchor, validDays],
  );
  const save = useApiMutation({
    mutationFn: () =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].teams[':teamId'].$patch({
            param: { orgId, teamId: team.id },
            json: {
              cycleCadenceDays: days,
              cycleCadenceAnchor: effectiveAnchor,
              cycleCadenceRevision: team.cycleCadenceRevision,
            },
          }),
        'Could not save cycle settings.',
      ),
    invalidateKeys: [queryKeys.team(orgId, team.id), queryKeys.cycles(orgId)],
  });
  const successMessage = save.isSuccess
    ? `Cycle cadence starts ${save.data.cadenceChange?.effectiveAnchor ?? effectiveAnchor}. Removed ${String(save.data.cadenceChange?.removedEmptyCycles ?? 0)} empty future cycles. Existing assignments did not move.`
    : undefined;
  const errorMessage = save.error
    ? userErrorMessage(save.error, 'Could not save cycle settings.')
    : undefined;

  return (
    <section aria-labelledby="cycle-settings-heading" className="flex max-w-2xl flex-col gap-5">
      <div>
        <h2 id="cycle-settings-heading" className="text-on-surface text-title-medium">
          Cycle cadence
        </h2>
        <p className="text-on-surface-variant text-body-medium mt-1">
          Set the length of new cycles. Existing assignments keep their current dates.
        </p>
      </div>

      {providerOwned ? (
        <Surface tone="card" shape="large" pad="comfortable">
          <p className="text-on-surface text-body-medium">
            A connected provider manages this team’s cycle cadence. Change the schedule there.
          </p>
        </Surface>
      ) : (
        <CycleCadenceForm
          cadenceDays={cadenceDays}
          earliestAnchor={earliestAnchor}
          effectiveAnchor={effectiveAnchor}
          validDays={validDays}
          preview={preview}
          pending={save.isPending}
          successMessage={successMessage}
          errorMessage={errorMessage}
          onCadenceChange={(value) => {
            save.reset();
            setCadenceDays(value);
          }}
          onAnchorChange={(value) => {
            save.reset();
            setAnchor(value);
          }}
          onSubmit={() => {
            save.mutate(undefined);
          }}
        />
      )}
    </section>
  );
}
