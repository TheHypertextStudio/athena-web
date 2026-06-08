'use client';

/**
 * The robust "New {cycle}" create composer for the Cycles list.
 *
 * @remarks
 * A Cycle is a *team-scoped* time-box, so creating one needs a team, a date range, and an
 * explicit team-local sequence `number` (cycles are "{Cycle} 3", "Sprint 12", …). The composer
 * collects an optional name (the title — unnamed cycles read as "{Cycle} N"), the required start →
 * end timeline (pre-filled to a sensible upcoming two-week window), and an inline strip of compact
 * pickers — the team it belongs to and its lifecycle status (upcoming / active / completed). The
 * next `number` is derived from the chosen team's existing cycles via
 * {@link CreateCycleDialogProps.nextNumberForTeam}. Built on the shared {@link ComposerShell}.
 *
 * The dialog is *controlled* by the host page so its header "New {cycle}" button and empty-state
 * CTA open the *same* dialog. This component owns only the form's transient field state (reset
 * whenever the dialog closes). The parent is handed the created {@link CycleOut} through
 * {@link CreateCycleDialogProps.onCreated} so it can optimistically prepend the new row + route.
 *
 * @see {@link useActiveOrg} for the `teams` + `defaultTeamId` the {@link TeamPicker} is driven from.
 */
import { type CycleOut, type CycleStatus, TeamId, type TeamOut } from '@docket/types';
import { DateRangePicker, EnumPicker } from '@docket/ui/components';
import { type JSX, useCallback, useMemo, useState } from 'react';

import { api } from '@/lib/api';
import { ComposerShell } from '@/components/composer/composer-shell';
import { enumOptions } from '@/components/pickers/options';
import { TeamPicker } from '@/components/teams/team-picker';
import { formatCalendarDate } from '@/lib/format-date';
import { readError, readProblem } from '@/lib/problem';
import { todayISODate } from '@/lib/today';

/** Default cycle length, in days, used to pre-fill the end date from the start. */
const DEFAULT_CYCLE_DAYS = 14;

/** The Cycle statuses, ordered by cadence: coming up → live → wrapped. */
const CYCLE_STATUS_ORDER: readonly CycleStatus[] = ['upcoming', 'active', 'completed'];

/** Human labels for {@link CycleStatus}. */
const CYCLE_STATUS_LABEL: Record<CycleStatus, string> = {
  upcoming: 'Upcoming',
  active: 'Active',
  completed: 'Completed',
};

/** A `YYYY-MM-DD` calendar day `days` after the given start day (local wall clock). */
function addDaysISO(startISO: string, days: number): string {
  const start = new Date(`${startISO}T00:00:00`);
  start.setDate(start.getDate() + days);
  return todayISODate(start);
}

/** Format an ISO date for a picker trigger, narrowing the app helper's `null` to `undefined`. */
function triggerDate(value: string | null): string | undefined {
  return formatCalendarDate(value, { month: 'short', day: 'numeric' }) ?? undefined;
}

/** Props for {@link CreateCycleDialog}. */
export interface CreateCycleDialogProps {
  /** The org the cycle is created in (from the route). */
  orgId: string;
  /** The singular, vocabulary-skinned cycle noun (e.g. "Cycle", "Sprint"). */
  cycleNoun: string;
  /** The teams a cycle may belong to (the active org's teams). */
  teams: readonly TeamOut[];
  /** The team id new cycles default to, or `null` before teams resolve. */
  defaultTeamId: string | null;
  /** Whether the active org's teams are still loading. */
  teamsLoading: boolean;
  /** The next team-local sequence number to assign on a given team (max existing + 1). */
  nextNumberForTeam: (teamId: string) => number;
  /** Whether the dialog is open (the host page owns this state). */
  open: boolean;
  /** Notify the parent that the open state changed (Esc, backdrop, X, Cancel, or success). */
  onOpenChange: (open: boolean) => void;
  /** Notify the parent that a cycle was created, so it can prepend + route. */
  onCreated: (cycle: CycleOut) => void;
}

/**
 * The robust cycle-create composer dialog.
 *
 * @param props - The {@link CreateCycleDialogProps}.
 * @returns the rendered composer.
 */
export function CreateCycleDialog({
  orgId,
  cycleNoun,
  teams,
  defaultTeamId,
  teamsLoading,
  nextNumberForTeam,
  open,
  onOpenChange,
  onCreated,
}: CreateCycleDialogProps): JSX.Element {
  const cycleNounLower = cycleNoun.toLowerCase();

  const today = useMemo(() => todayISODate(), []);

  const [name, setName] = useState('');
  const [teamOverride, setTeamOverride] = useState<string | null>(null);
  const [startsAt, setStartsAt] = useState<string | null>(today);
  const [endsAt, setEndsAt] = useState<string | null>(() => addDaysISO(today, DEFAULT_CYCLE_DAYS));
  const [status, setStatus] = useState<CycleStatus>('upcoming');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const teamId = teamOverride ?? defaultTeamId;

  // The team-local sequence number this cycle will take (shown in the placeholder).
  const nextNumber = teamId ? nextNumberForTeam(teamId) : 1;

  /** Whether the chosen date range is valid (both set, end strictly after start). */
  const rangeValid =
    startsAt !== null &&
    endsAt !== null &&
    startsAt.length > 0 &&
    endsAt.length > 0 &&
    endsAt > startsAt;

  /** Reset transient form state whenever the dialog closes (next range re-derives from today). */
  const handleOpenChange = useCallback(
    (next: boolean): void => {
      if (!next) {
        const freshStart = todayISODate();
        setName('');
        setTeamOverride(null);
        setStartsAt(freshStart);
        setEndsAt(addDaysISO(freshStart, DEFAULT_CYCLE_DAYS));
        setStatus('upcoming');
        setError(null);
      }
      onOpenChange(next);
    },
    [onOpenChange],
  );

  const canSubmit = teamId !== null && !teamsLoading && rangeValid;

  /** Create the cycle, then hand it to the parent for optimistic insertion + routing. */
  const submit = useCallback(async (): Promise<void> => {
    if (!teamId) {
      setError(`Pick a team to create the ${cycleNounLower} in.`);
      return;
    }
    if (startsAt === null || endsAt === null || endsAt <= startsAt) {
      setError('Pick a start and end date — the end must come after the start.');
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const trimmed = name.trim();
      const res = await api.v1.orgs[':orgId'].cycles.$post({
        param: { orgId },
        json: {
          teamId: TeamId.parse(teamId),
          number: nextNumberForTeam(teamId),
          startsAt,
          endsAt,
          status,
          ...(trimmed.length > 0 ? { name: trimmed } : {}),
        },
      });
      if (!res.ok) {
        setError(await readProblem(res, `Could not create the ${cycleNounLower}.`));
        return;
      }
      const created = await res.json();
      onOpenChange(false);
      onCreated(created);
    } catch (caught) {
      setError(readError(caught, `Something went wrong creating the ${cycleNounLower}.`));
    } finally {
      setCreating(false);
    }
  }, [
    teamId,
    startsAt,
    endsAt,
    status,
    name,
    orgId,
    cycleNounLower,
    nextNumberForTeam,
    onOpenChange,
    onCreated,
  ]);

  return (
    <ComposerShell
      open={open}
      onOpenChange={handleOpenChange}
      heading={`New ${cycleNoun}`}
      description={`Pick a team and a date range to time-box your work. Name it, or leave it as ${cycleNoun} ${String(nextNumber)}.`}
      title={name}
      onTitleChange={setName}
      titlePlaceholder={`${cycleNoun} ${String(nextNumber)} — name optional`}
      body=""
      onBodyChange={() => {
        /* Cycles carry no description; the body field is intentionally hidden. */
      }}
      error={error}
      creating={creating}
      canSubmit={canSubmit}
      onSubmit={() => void submit()}
      submitLabel={`Create ${cycleNoun}`}
    >
      <TeamPicker
        teams={teams}
        value={teamId}
        onChange={setTeamOverride}
        disabled={creating}
        className="h-8"
      />
      <DateRangePicker
        triggerVariant="outline"
        value={{ start: startsAt, end: endsAt }}
        onChange={({ start, end }) => {
          setStartsAt(start);
          setEndsAt(end);
        }}
        placeholder="Set dates"
        formatLabel={triggerDate}
        ariaLabel="Dates"
        startLabel="Starts"
        endLabel="Ends"
        disabled={creating}
      />
      <EnumPicker
        triggerVariant="outline"
        options={enumOptions(CYCLE_STATUS_ORDER, CYCLE_STATUS_LABEL)}
        value={status}
        onChange={(next) => {
          if (next) setStatus(next);
        }}
        placeholder="Status"
        ariaLabel="Status"
        disabled={creating}
      />
    </ComposerShell>
  );
}
