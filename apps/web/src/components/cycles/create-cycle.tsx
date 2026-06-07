'use client';

/**
 * The inline "New {cycle}" create composer for the Cycles list.
 *
 * @remarks
 * A Cycle is a *team-scoped* time-box, so creating one needs a team and a date range, and the
 * API requires an explicit, team-local sequence `number` (cycles are "{Cycle} 3", "Sprint 12",
 * …). This composer collects the minimal fields — team (defaulting to the org's default team,
 * shown only when the org has more than one), a date range (pre-filled to a sensible upcoming
 * two-week window), and an optional name override — and derives the next `number` from the
 * existing cycles on the chosen team via {@link CreateCyclePanelProps.nextNumberForTeam}.
 *
 * Rather than a bare `prompt`, it renders a styled, dismissable composer panel: a card-framed
 * form with focused inputs and Create / Cancel actions. The panel is rendered by the page only
 * while its create composer is open (so the page's header "New {cycle}" button and its
 * empty-state "Create your first {cycle}" CTA both open the *same* composer). It owns only the
 * form's transient field state; the parent owns the roster and is handed the created
 * {@link CycleOut} via {@link CreateCyclePanelProps.onCreated} so it can optimistically prepend
 * the new row and route to its detail, and is told to close via
 * {@link CreateCyclePanelProps.onClose}.
 *
 * @see {@link useActiveOrg} for the `teams` + `defaultTeamId` the team picker is driven from.
 */
import { type CycleOut, TeamId, type TeamOut } from '@docket/types';
import { Plus } from '@docket/ui/icons';
import { Button, Input } from '@docket/ui/primitives';
import { type JSX, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { api } from '@/lib/api';
import { readError, readProblem } from '@/lib/problem';
import { todayISODate } from '@/lib/today';
import { TeamPicker } from '@/components/teams/team-picker';

/** Default cycle length, in days, used to pre-fill the end date from the start. */
const DEFAULT_CYCLE_DAYS = 14;

/** A `YYYY-MM-DD` calendar day `days` after the given start day (local wall clock). */
function addDaysISO(startISO: string, days: number): string {
  const start = new Date(`${startISO}T00:00:00`);
  start.setDate(start.getDate() + days);
  return todayISODate(start);
}

/** Props for {@link CreateCyclePanel}. */
export interface CreateCyclePanelProps {
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
  /** Notify the parent to close (dismiss) the composer. */
  onClose: () => void;
  /** Notify the parent that a cycle was created, so it can prepend + route. */
  onCreated: (cycle: CycleOut) => void;
}

/**
 * The dismissable composer panel for creating a new cycle.
 *
 * @param props - The {@link CreateCyclePanelProps}.
 * @returns the rendered composer form.
 */
export function CreateCyclePanel({
  orgId,
  cycleNoun,
  teams,
  defaultTeamId,
  teamsLoading,
  nextNumberForTeam,
  onClose,
  onCreated,
}: CreateCyclePanelProps): JSX.Element {
  const cycleNounLower = cycleNoun.toLowerCase();

  const today = useMemo(() => todayISODate(), []);

  const [name, setName] = useState('');
  const [teamOverride, setTeamOverride] = useState<string | null>(null);
  const [startsAt, setStartsAt] = useState(today);
  const [endsAt, setEndsAt] = useState(() => addDaysISO(today, DEFAULT_CYCLE_DAYS));
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nameRef = useRef<HTMLInputElement>(null);
  const teamId = teamOverride ?? defaultTeamId;

  // The team-local sequence number this cycle will take (shown in the heading + placeholder).
  const nextNumber = teamId ? nextNumberForTeam(teamId) : 1;

  // Focus the name field on mount so the composer is immediately typeable.
  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  /** Whether the chosen date range is valid (end strictly after start). */
  const rangeValid = startsAt.length > 0 && endsAt.length > 0 && endsAt > startsAt;

  /** Create the cycle, then hand it to the parent for optimistic insertion + routing. */
  const submit = useCallback(async (): Promise<void> => {
    if (!teamId) {
      setError(`Pick a team to create the ${cycleNounLower} in.`);
      return;
    }
    if (!rangeValid) {
      setError('The end date must come after the start date.');
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
          ...(trimmed.length > 0 ? { name: trimmed } : {}),
        },
      });
      if (!res.ok) {
        setError(await readProblem(res, `Could not create the ${cycleNounLower}.`));
        return;
      }
      const created = await res.json();
      onCreated(created);
    } catch (caught) {
      setError(readError(caught, `Something went wrong creating the ${cycleNounLower}.`));
    } finally {
      setCreating(false);
    }
  }, [
    teamId,
    rangeValid,
    name,
    orgId,
    startsAt,
    endsAt,
    cycleNounLower,
    nextNumberForTeam,
    onCreated,
  ]);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !creating) onClose();
      }}
      className="bg-card text-card-foreground flex flex-col gap-3 rounded-xl border p-4 shadow"
      aria-label={`New ${cycleNounLower}`}
    >
      <Input
        ref={nameRef}
        aria-label={`${cycleNoun} name (optional)`}
        placeholder={`${cycleNoun} ${String(nextNumber)} — name optional`}
        value={name}
        disabled={creating}
        onChange={(event) => {
          setName(event.target.value);
        }}
      />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-muted-foreground text-xs font-medium">Starts</span>
          <Input
            type="date"
            aria-label={`${cycleNoun} start date`}
            value={startsAt}
            max={endsAt || undefined}
            disabled={creating}
            onChange={(event) => {
              setStartsAt(event.target.value);
            }}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-muted-foreground text-xs font-medium">Ends</span>
          <Input
            type="date"
            aria-label={`${cycleNoun} end date`}
            value={endsAt}
            min={startsAt || undefined}
            disabled={creating}
            onChange={(event) => {
              setEndsAt(event.target.value);
            }}
          />
        </label>
      </div>
      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
      <div className="flex items-center justify-between gap-2">
        <TeamPicker teams={teams} value={teamId} onChange={setTeamOverride} disabled={creating} />
        <div className="ml-auto flex items-center gap-2">
          <Button type="button" variant="ghost" disabled={creating} onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={creating || teamsLoading || teamId === null || !rangeValid}
            className="gap-1.5"
          >
            <Plus aria-hidden="true" className="size-4" />
            {creating ? 'Creating…' : `Create ${cycleNoun}`}
          </Button>
        </div>
      </div>
    </form>
  );
}
