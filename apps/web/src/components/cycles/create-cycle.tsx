'use client';

/**
 * The "New {cycle}" create dialog for the Cycles list.
 *
 * @remarks
 * A Cycle is a *team-scoped* time-box, so creating one needs a team and a date range, and the
 * API requires an explicit, team-local sequence `number` (cycles are "{Cycle} 3", "Sprint 12",
 * …). This dialog collects the minimal fields — team (defaulting to the org's default team,
 * shown only when the org has more than one), a date range (pre-filled to a sensible upcoming
 * two-week window), and an optional name override — and derives the next `number` from the
 * existing cycles on the chosen team via {@link CreateCycleDialogProps.nextNumberForTeam}.
 *
 * Following the Linear pattern, it renders a focused, dismissable modal {@link Dialog}: a
 * centered surface panel with focused inputs and Create / Cancel actions. The dialog is
 * *controlled* by the host page so the page's header "New {cycle}" button and its empty-state
 * "Create your first {cycle}" CTA both open the *same* dialog — the page owns `open` and passes
 * it in via {@link CreateCycleDialogProps.open} / {@link CreateCycleDialogProps.onOpenChange}.
 * This component owns only the form's transient field state (reset whenever the dialog closes).
 * The parent owns the roster and is handed the created {@link CycleOut} via
 * {@link CreateCycleDialogProps.onCreated} so it can optimistically prepend the new row and
 * route to its detail; on a successful create this component closes the dialog itself.
 *
 * @see {@link useActiveOrg} for the `teams` + `defaultTeamId` the team picker is driven from.
 */
import { type CycleOut, TeamId, type TeamOut } from '@docket/types';
import { Plus } from '@docket/ui/icons';
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from '@docket/ui/primitives';
import { type JSX, useCallback, useMemo, useState } from 'react';

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
 * The focused modal dialog for creating a new cycle.
 *
 * @param props - The {@link CreateCycleDialogProps}.
 * @returns the rendered create dialog.
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
  const [startsAt, setStartsAt] = useState(today);
  const [endsAt, setEndsAt] = useState(() => addDaysISO(today, DEFAULT_CYCLE_DAYS));
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const teamId = teamOverride ?? defaultTeamId;

  // The team-local sequence number this cycle will take (shown in the placeholder).
  const nextNumber = teamId ? nextNumberForTeam(teamId) : 1;

  /** Whether the chosen date range is valid (end strictly after start). */
  const rangeValid = startsAt.length > 0 && endsAt.length > 0 && endsAt > startsAt;

  /** Reset transient form state whenever the dialog closes (next range re-derives from today). */
  const handleOpenChange = useCallback(
    (next: boolean): void => {
      if (creating) return;
      if (!next) {
        const freshStart = todayISODate();
        setName('');
        setTeamOverride(null);
        setStartsAt(freshStart);
        setEndsAt(addDaysISO(freshStart, DEFAULT_CYCLE_DAYS));
        setError(null);
      }
      onOpenChange(next);
    },
    [creating, onOpenChange],
  );

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
      onOpenChange(false);
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
    onOpenChange,
    onCreated,
  ]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New {cycleNoun}</DialogTitle>
          <DialogDescription>
            Pick a team and a date range to time-box your work. Name it, or leave it as {cycleNoun}{' '}
            {String(nextNumber)}.
          </DialogDescription>
        </DialogHeader>
        <form
          id="create-cycle-form"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
          className="flex flex-col gap-3"
        >
          <Input
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
              <span className="text-on-surface-variant text-xs font-medium">Starts</span>
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
              <span className="text-on-surface-variant text-xs font-medium">Ends</span>
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
          <TeamPicker teams={teams} value={teamId} onChange={setTeamOverride} disabled={creating} />
          {error ? (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          ) : null}
        </form>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="ghost" disabled={creating}>
              Cancel
            </Button>
          </DialogClose>
          <Button
            type="submit"
            form="create-cycle-form"
            disabled={creating || teamsLoading || teamId === null || !rangeValid}
            className="gap-1.5"
          >
            <Plus aria-hidden="true" className="size-4" />
            {creating ? 'Creating…' : `Create ${cycleNoun}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
