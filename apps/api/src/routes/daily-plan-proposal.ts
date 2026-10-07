/** Read-only proposal contract and route handler. */
import { type dailyPlanDay, db } from '@docket/db';
import { DailyPlanSnapshot } from '@docket/planning/daily-plan-flow';
import { proposeDailyPlan } from '@docket/planning/daily-proposal';
import { addDays, instantAt } from '@docket/planning/zoned-time';
import { z } from 'zod';
import type { AgendaOut } from '@docket/planning/agenda-contract';
import type { Interval } from '@docket/planning/intervals';
import { ConflictError } from '../error';
import { loadProposalAvailability } from '../services/daily-proposal-availability';
import {
  loadProposalCandidates,
  type VisibleProposalCandidate,
} from '../services/daily-proposal-candidates';
import { restoreLegacyTimeboxes } from '../services/daily-proposal-legacy';
import { loadSchedulingPreferences } from '../services/scheduling/repository';
import { buildAgendaPayload } from './calendar-shared';
import { loadRecordedDayWork } from './daily-plan-work';

/** Inputs for initial planning or a rebuild of a supplied editable draft. */
export const proposalInput = z.object({
  draft: DailyPlanSnapshot.optional(),
  expectedRevision: z.number().int().nonnegative().optional(),
});
/** Proposed snapshot and factual reasons without persisted changes. */
export const proposalOut = z.object({
  draft: DailyPlanSnapshot,
  revision: z.number().int().nonnegative(),
  startAt: z.iso.datetime(),
  workScheduleMissing: z.boolean(),
  availableMinutes: z.number().nonnegative(),
  bufferMinutes: z.number().nonnegative(),
  fixedIntervals: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      startsAt: z.iso.datetime(),
      endsAt: z.iso.datetime(),
      kind: z.enum(['event', 'protected']),
    }),
  ),
  tasks: z.array(
    z.object({
      taskId: z.string(),
      title: z.string(),
      organizationId: z.string(),
      projectName: z.string().nullable(),
      projectId: z.string().nullable(),
      reason: z.string(),
      durationSource: z.enum(['edited', 'estimate', 'history', 'default']),
    }),
  ),
  unplaced: z.array(
    z.object({
      taskId: z.string(),
      remainingMinutes: z.number().positive(),
      reason: z.enum(['blocked', 'no_availability', 'insufficient_time']),
    }),
  ),
  changes: z.array(
    z.object({
      type: z.enum(['added', 'moved', 'removed']),
      sessionId: z.string(),
      previousStartsAt: z.iso.datetime().nullable(),
      startsAt: z.iso.datetime().nullable(),
      taskIds: z.array(z.string()),
    }),
  ),
});

type RecordedWork = Awaited<ReturnType<typeof loadRecordedDayWork>>;

function recordedTaskMinutes(actual: RecordedWork): Map<string, number> {
  const recorded = new Map<string, number>();
  for (const entry of actual)
    if (entry.taskId)
      recorded.set(entry.taskId, (recorded.get(entry.taskId) ?? 0) + entry.recordedMinutes);
  return recorded;
}

function recordedTaskIntervals(actual: RecordedWork, now: Date): Map<string, Interval[]> {
  const intervals = new Map<string, Interval[]>();
  for (const entry of actual) {
    if (!entry.taskId) continue;
    const bounds = intervals.get(entry.taskId) ?? [];
    bounds.push({
      start: Date.parse(entry.startedAt),
      end: entry.endedAt ? Date.parse(entry.endedAt) : now.getTime(),
    });
    intervals.set(entry.taskId, bounds);
  }
  return intervals;
}

function activeTasks(actual: RecordedWork): Set<string> {
  return new Set(
    actual
      .filter((entry) => entry.endedAt === null)
      .flatMap((entry) => (entry.taskId ? [entry.taskId] : [])),
  );
}

function externalCommitments(
  agenda: z.input<typeof AgendaOut>,
  dayStart: Date,
  dayEnd: Date,
): Interval[] {
  return agenda.entries.flatMap((entry) =>
    entry.kind === 'google_calendar_event'
      ? [
          {
            start: entry.event.startsAt ? Date.parse(entry.event.startsAt) : dayStart.getTime(),
            end: entry.event.endsAt ? Date.parse(entry.event.endsAt) : dayEnd.getTime(),
          },
        ]
      : [],
  );
}

function activeCommitments(
  actual: RecordedWork,
  candidates: readonly VisibleProposalCandidate[],
  now: Date,
): Interval[] {
  return actual
    .filter((entry) => entry.endedAt === null)
    .map((entry) => {
      const candidate = candidates.find((value) => value.taskId === entry.taskId);
      const remaining = candidate
        ? candidate.plannedMinutes - (candidate.recordedMinutes ?? 0)
        : 15;
      return {
        start: Date.parse(entry.startedAt),
        end: now.getTime() + Math.max(15, remaining) * 60_000,
      };
    });
}

function recordedCommitments(actual: RecordedWork): Interval[] {
  return actual
    .filter((entry) => entry.endedAt !== null)
    .map((entry) => ({
      start: Date.parse(entry.startedAt),
      end: Date.parse(entry.endedAt ?? entry.startedAt),
    }));
}

function candidateMetadata(
  candidate: VisibleProposalCandidate,
): z.input<typeof proposalOut>['tasks'][number] {
  const { taskId, title, organizationId, projectName, projectId, reason, durationSource } =
    candidate;
  return { taskId, title, organizationId, projectName, projectId, reason, durationSource };
}

interface BuildProposalInput {
  readonly userId: string;
  readonly hubId: string;
  readonly date: string;
  readonly row: typeof dailyPlanDay.$inferSelect | undefined;
  readonly draft?: DailyPlanSnapshot | undefined;
  readonly expectedRevision?: number | undefined;
}

function existingSnapshot(input: BuildProposalInput): DailyPlanSnapshot | null {
  return input.draft ?? input.row?.draft ?? input.row?.accepted?.current.snapshot ?? null;
}

/** Build a proposal from visibility-filtered work, canonical windows and actual ledger facts. */
export async function buildDailyProposal(
  input: BuildProposalInput,
): Promise<z.input<typeof proposalOut>> {
  const revision = input.row?.revision ?? 0;
  if (input.expectedRevision !== undefined && input.expectedRevision !== revision)
    throw new ConflictError('The planning draft changed before proposing');
  const now = new Date(Math.ceil(Date.now() / 60_000) * 60_000);
  const preferences = await loadSchedulingPreferences(db, input.hubId);
  const timezone = preferences.timezone;
  const dayStart = instantAt(input.date, 0, timezone);
  const dayEnd = instantAt(addDays(input.date, 1), 0, timezone);
  const existing = existingSnapshot(input);
  const [availability, actual, agenda] = await Promise.all([
    loadProposalAvailability({ ...input, timezone, draft: existing, now }),
    loadRecordedDayWork(input.hubId, dayStart, dayEnd),
    buildAgendaPayload(input.userId, { date: input.date, dayStart, dayEnd }),
  ]);
  let draft: DailyPlanSnapshot = existing ?? {
    date: input.date,
    finishAt: availability.finishAt,
    mainTaskId: null,
    tasks: [],
    sessions: [],
    settings: { startAt: availability.startAt },
  };
  const recorded = recordedTaskMinutes(actual);
  const activeTaskIds = activeTasks(actual);
  let candidates = await loadProposalCandidates({
    ...input,
    draft,
    dayEnd,
    recorded,
    recordedIntervals: recordedTaskIntervals(actual, now),
    activeTaskIds,
    now,
  });
  if (!existing)
    ({ draft, candidates } = await restoreLegacyTimeboxes({
      hubId: input.hubId,
      date: input.date,
      draft,
      candidates,
      recorded,
    }));
  const external = externalCommitments(agenda, dayStart, dayEnd);
  const activeBusy = activeCommitments(actual, candidates, now);
  const result = proposeDailyPlan({
    draft,
    candidates: candidates.filter(
      (candidate) =>
        candidate.plannedMinutes > 0 &&
        (!candidate.active || draft.tasks.some((entry) => entry.taskId === candidate.taskId)),
    ),
    now: Math.max(
      dayStart.getTime(),
      now.getTime() < dayEnd.getTime() ? now.getTime() : dayEnd.getTime(),
    ),
    windows: availability.windows,
    busy: [...availability.busy, ...external, ...activeBusy, ...recordedCommitments(actual)],
  });
  return {
    ...result,
    unplaced: result.unplaced.map((entry) => ({ ...entry })),
    changes: result.changes.map((entry) => ({ ...entry, taskIds: [...entry.taskIds] })),
    revision,
    startAt: availability.startAt,
    workScheduleMissing: availability.workScheduleMissing,
    fixedIntervals: [...availability.fixedIntervals],
    tasks: candidates.map(candidateMetadata),
  };
}
