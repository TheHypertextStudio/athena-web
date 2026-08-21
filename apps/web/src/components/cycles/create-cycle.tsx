'use client';

/**
 * The robust "New {cycle}" create composer for the Cycles list.
 *
 * @remarks
 * A Cycle is a *team-scoped* time-box, so creating one needs a team, a date range, and an
 * explicit team-local sequence `number`. The composer collects an optional name (the title —
 * unnamed cycles are named by their window, e.g. "Aug 3 – Aug 16"), the required start → end
 * timeline (pre-filled to a sensible upcoming two-week window), and an inline strip of compact
 * pickers — the team it belongs to and its lifecycle status (upcoming / active / completed). The
 * `number` is derived from the chosen team's existing cycles via
 * {@link CreateCycleDialogProps.nextNumberForTeam} and is submitted but never shown: it is the
 * uniqueness key of the auto-roll, not a label. Built on the shared {@link ComposerShell}.
 *
 * The dialog is *controlled* by the host page so its header "New {cycle}" button and empty-state
 * CTA open the *same* dialog. This component owns only the form's transient field state, which
 * {@link withComposerReset} scopes to a single open — so a reopened composer re-derives its default
 * date range from today rather than from whenever it was last closed. The parent is handed the
 * created {@link CycleOut} through
 * {@link CreateCycleDialogProps.onCreated} so it can optimistically prepend the new row + route.
 *
 * @see {@link useActiveOrg} for the `teams` + `defaultTeamId` the {@link TeamPicker} is driven from.
 */
import {
  type CycleOut,
  type CycleStatus,
  defaultCycleName,
  TeamId,
  type TeamOut,
} from '@docket/types';
import { DateRangePicker, EnumPicker } from '@docket/ui/components';
import { type JSX, useCallback, useMemo, useRef, useState } from 'react';

import { api } from '@/lib/api';
import { ComposerShell } from '@/components/composer/composer-shell';
import { useComposerContinuation } from '@/components/composer/use-composer-continuation';
import { runConfirmedCreateCallback } from '@/components/create-object/create-object-completion';
import { withComposerReset } from '@/components/composer/reset-on-open';
import { enumOptions } from '@/components/pickers/options';
import { TeamPicker } from '@/components/teams/team-picker';
import { formatCalendarDate } from '@/lib/format-date';
import { userErrorMessage, readProblemError } from '@/lib/problem';
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

/** Count calendar-day boundaries between two ISO dates without daylight-saving drift. */
function calendarDayDistance(startISO: string, endISO: string): number {
  const [startYear, startMonth, startDay] = startISO.split('-').map(Number);
  const [endYear, endMonth, endDay] = endISO.split('-').map(Number);
  return Math.round(
    (Date.UTC(endYear ?? 0, (endMonth ?? 1) - 1, endDay ?? 1) -
      Date.UTC(startYear ?? 0, (startMonth ?? 1) - 1, startDay ?? 1)) /
      86_400_000,
  );
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
export const CreateCycleDialog = withComposerReset(function CreateCycleComposer({
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
  const sequenceFloor = useRef(new Map<string, number>());

  const today = useMemo(() => todayISODate(), []);

  const [name, setName] = useState('');
  const [teamOverride, setTeamOverride] = useState<string | null>(null);
  const [startsAt, setStartsAt] = useState<string | null>(today);
  const [endsAt, setEndsAt] = useState<string | null>(() => addDaysISO(today, DEFAULT_CYCLE_DAYS));
  const [status, setStatus] = useState<CycleStatus>('upcoming');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const continuation = useComposerContinuation({
    creating,
    successMessage: `${cycleNoun} created. Ready to create another.`,
  });

  const teamId = teamOverride ?? defaultTeamId;

  /**
   * What an unnamed cycle will be called once created: its window.
   *
   * @remarks
   * The placeholder used to preview the team-local sequence `number` this cycle would take — but
   * that number is the epoch-anchored auto-roll key, so the composer promised a title like
   * "Cycle 1000142". It now previews the real default ({@link defaultCycleName}), and falls back to
   * plain copy until a window is chosen.
   */
  const titlePlaceholder =
    startsAt !== null && endsAt !== null && startsAt.length > 0 && endsAt.length > 0
      ? `${defaultCycleName(startsAt, endsAt)} — name optional`
      : 'Name (optional)';

  /** Whether the chosen date range is valid (both set, end strictly after start). */
  const rangeValid =
    startsAt !== null &&
    endsAt !== null &&
    startsAt.length > 0 &&
    endsAt.length > 0 &&
    endsAt > startsAt;

  const canSubmit = teamId !== null && !teamsLoading && rangeValid;

  /** Create the cycle, then hand it to the parent for optimistic insertion + routing. */
  const submit = useCallback(
    async (continueCreating = false): Promise<void> => {
      if (!teamId) {
        setError(`Pick a team to create the ${cycleNounLower} in.`);
        return;
      }
      if (startsAt === null || endsAt === null || endsAt <= startsAt) {
        setError('Pick a start and end date — the end must come after the start.');
        return;
      }
      if (!continuation.beginSubmission()) return;
      setCreating(true);
      setError(null);
      try {
        const trimmed = name.trim();
        const number = Math.max(
          nextNumberForTeam(teamId),
          sequenceFloor.current.get(teamId) ?? Number.NEGATIVE_INFINITY,
        );
        const durationDays = calendarDayDistance(startsAt, endsAt);
        const res = await api.v1.orgs[':orgId'].cycles.$post({
          param: { orgId },
          json: {
            teamId: TeamId.parse(teamId),
            number,
            startsAt,
            endsAt,
            status,
            ...(trimmed.length > 0 ? { name: trimmed } : {}),
          },
        });
        if (!res.ok) {
          setError(
            userErrorMessage(
              await readProblemError(res, `Could not create the ${cycleNounLower}.`),
              `Could not create the ${cycleNounLower}.`,
            ),
          );
          return;
        }
        const created = await res.json();
        sequenceFloor.current.set(teamId, number + 1);
        runConfirmedCreateCallback(() => {
          onCreated(created);
        });
        if (continueCreating) {
          continuation.completeContinuation(() => {
            const nextStartsAt = addDaysISO(endsAt, 1);
            setName('');
            setStartsAt(nextStartsAt);
            setEndsAt(addDaysISO(nextStartsAt, durationDays));
          });
          return;
        }
        onOpenChange(false);
      } catch (caught) {
        setError(userErrorMessage(caught, `Something went wrong creating the ${cycleNounLower}.`));
      } finally {
        continuation.finishSubmission();
        setCreating(false);
      }
    },
    [
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
      continuation,
    ],
  );

  return (
    <ComposerShell
      open={open}
      onOpenChange={onOpenChange}
      heading={`New ${cycleNoun.toLowerCase()}`}
      continuation={{
        checked: continuation.createMore,
        onCheckedChange: continuation.setCreateMore,
        onSubmit: () => {
          void submit(true);
        },
      }}
      title={name}
      onTitleChange={setName}
      titleInputRef={continuation.titleInputRef}
      titlePlaceholder={titlePlaceholder}
      body=""
      onBodyChange={() => {
        /* Cycles carry no description; the body field is intentionally hidden. */
      }}
      error={error}
      statusMessage={continuation.statusMessage}
      creating={creating}
      canSubmit={canSubmit}
      onSubmit={() => void submit(continuation.createMore)}
      submitLabel={`Create ${cycleNoun}`}
    >
      <TeamPicker teams={teams} value={teamId} onChange={setTeamOverride} disabled={creating} />
      <DateRangePicker
        value={{ start: startsAt, end: endsAt }}
        onChange={({ start, end }) => {
          setStartsAt(start);
          setEndsAt(end);
        }}
        startPlaceholder="Set start date"
        endPlaceholder="Set end date"
        formatLabel={triggerDate}
        ariaLabel="Dates"
        startLabel="Starts"
        endLabel="Ends"
        disabled={creating}
      />
      <EnumPicker
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
});
