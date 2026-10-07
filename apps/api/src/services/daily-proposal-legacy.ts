/** Preserve explicit legacy timeboxes when a day has no snapshot yet. */
import { dailyPlanItem, db } from '@docket/db';
import type { DailyPlanSession, DailyPlanSnapshot } from '@docket/planning/daily-plan-flow';
import { and, eq } from 'drizzle-orm';
import type { VisibleProposalCandidate } from './daily-proposal-candidates';

function legacySession(item: typeof dailyPlanItem.$inferSelect): DailyPlanSession | null {
  if (!item.timeboxStartsAt || !item.timeboxEndsAt) return null;
  const minutes = (item.timeboxEndsAt.getTime() - item.timeboxStartsAt.getTime()) / 60_000;
  if (!Number.isInteger(minutes) || minutes <= 0) return null;
  return {
    id: `legacy:${item.id}`,
    startsAt: item.timeboxStartsAt.toISOString(),
    endsAt: item.timeboxEndsAt.toISOString(),
    allocations: [{ taskId: item.refTaskId, plannedMinutes: minutes }],
    pinned: false,
    placementSource: 'manual',
  };
}

/** Restore only timeboxes whose task passed the proposal's visibility and eligibility checks. */
export async function restoreLegacyTimeboxes(input: {
  readonly hubId: string;
  readonly date: string;
  readonly draft: DailyPlanSnapshot;
  readonly candidates: readonly VisibleProposalCandidate[];
  readonly recorded: ReadonlyMap<string, number>;
}): Promise<{ draft: DailyPlanSnapshot; candidates: VisibleProposalCandidate[] }> {
  const rows = await db
    .select()
    .from(dailyPlanItem)
    .where(
      and(
        eq(dailyPlanItem.hubId, input.hubId),
        eq(dailyPlanItem.date, input.date),
        eq(dailyPlanItem.status, 'planned'),
      ),
    );
  const visible = new Set(input.candidates.map((candidate) => candidate.taskId));
  const sessions = rows
    .filter((row) => visible.has(row.refTaskId))
    .flatMap((row) => {
      const session = legacySession(row);
      return session ? [session] : [];
    });
  const durations = new Map<string, number>();
  for (const session of sessions)
    for (const allocation of session.allocations)
      durations.set(
        allocation.taskId,
        (durations.get(allocation.taskId) ?? 0) + allocation.plannedMinutes,
      );
  const candidates = input.candidates.map((candidate) =>
    durations.has(candidate.taskId)
      ? {
          ...candidate,
          plannedMinutes: durations.get(candidate.taskId) ?? candidate.plannedMinutes,
          durationSource: 'edited' as const,
          recordedMinutes: input.recorded.get(candidate.taskId) ?? 0,
        }
      : candidate,
  );
  const tasks = candidates
    .filter((candidate) => durations.has(candidate.taskId))
    .map((candidate, sort) => ({
      taskId: candidate.taskId,
      organizationId: candidate.organizationId,
      plannedMinutes: candidate.plannedMinutes,
      sort,
      selectionSource: 'explicit' as const,
      durationSource: 'edited' as const,
    }));
  return { draft: { ...input.draft, tasks, sessions }, candidates };
}
