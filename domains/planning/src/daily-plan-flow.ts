/** Durable daily commitments, separate from the time ledger's actual work. */
import { z } from 'zod';

/** One selected task and its planned duration for the day. */
export const DailyPlanTask = z.object({
  taskId: z.string().min(1),
  organizationId: z.string().min(1),
  plannedMinutes: z.number().int().positive(),
  sort: z.number().int().nonnegative(),
});
/** Validated selected task. */
export type DailyPlanTask = z.infer<typeof DailyPlanTask>;

/** Planned minutes assigned to one task within a timed block. */
export const DailyPlanAllocation = z.object({
  taskId: z.string().min(1),
  plannedMinutes: z.number().int().positive(),
});
/** Validated task allocation. */
export type DailyPlanAllocation = z.infer<typeof DailyPlanAllocation>;

/** One timed block that can contain several tasks. A task can occur in several blocks. */
export const DailyPlanSession = z
  .object({
    id: z.string().min(1),
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime(),
    allocations: z.array(DailyPlanAllocation).min(1),
    pinned: z.boolean(),
  })
  .superRefine((session, context) => {
    const length = (Date.parse(session.endsAt) - Date.parse(session.startsAt)) / 60_000;
    if (length <= 0 || !Number.isInteger(length)) {
      context.addIssue({
        code: 'custom',
        message: 'Session end must follow its start in whole minutes',
      });
    }
    if (
      session.allocations.reduce((sum, allocation) => sum + allocation.plannedMinutes, 0) > length
    ) {
      context.addIssue({ code: 'custom', message: 'Task allocations exceed session duration' });
    }
    if (
      new Set(session.allocations.map((allocation) => allocation.taskId)).size !==
      session.allocations.length
    ) {
      context.addIssue({ code: 'custom', message: 'A task can appear only once within a session' });
    }
  });
/** Validated planned session. */
export type DailyPlanSession = z.infer<typeof DailyPlanSession>;

/** The complete planned state at one point in time. Actual work is not stored here. */
export const DailyPlanSnapshot = z
  .object({
    date: z.iso.date(),
    finishAt: z.iso.datetime(),
    mainTaskId: z.string().nullable(),
    tasks: z.array(DailyPlanTask),
    sessions: z.array(DailyPlanSession),
  })
  .superRefine((snapshot, context) => {
    const taskIds = new Set(snapshot.tasks.map((entry) => entry.taskId));
    if (taskIds.size !== snapshot.tasks.length) {
      context.addIssue({ code: 'custom', message: 'Selected tasks must be unique' });
    }
    if (snapshot.mainTaskId !== null && !taskIds.has(snapshot.mainTaskId)) {
      context.addIssue({ code: 'custom', message: 'Main task must be selected' });
    }
    if (new Set(snapshot.sessions.map((session) => session.id)).size !== snapshot.sessions.length) {
      context.addIssue({ code: 'custom', message: 'Session identifiers must be unique' });
    }
    const allocated = new Map<string, number>();
    for (const session of snapshot.sessions) {
      for (const allocation of session.allocations) {
        if (!taskIds.has(allocation.taskId)) {
          context.addIssue({ code: 'custom', message: 'A session task must be selected' });
        }
        allocated.set(
          allocation.taskId,
          (allocated.get(allocation.taskId) ?? 0) + allocation.plannedMinutes,
        );
      }
    }
    for (const entry of snapshot.tasks) {
      if ((allocated.get(entry.taskId) ?? 0) > entry.plannedMinutes) {
        context.addIssue({ code: 'custom', message: 'Scheduled time exceeds task planned time' });
      }
    }
  });
/** Validated planned state. */
export type DailyPlanSnapshot = z.infer<typeof DailyPlanSnapshot>;

/** One immutable accepted version of a day. */
export const DailyPlanVersion = z.object({
  acceptedAt: z.iso.datetime(),
  snapshot: DailyPlanSnapshot,
});
/** Validated immutable accepted version of a day. */
export type DailyPlanVersion = z.infer<typeof DailyPlanVersion>;

/** Original commitment, current revision, and every accepted version in order. */
export const AcceptedDailyPlan = z.object({
  original: DailyPlanVersion,
  current: DailyPlanVersion,
  history: z.array(DailyPlanVersion).min(1),
});
/** Original commitment, current revision, and accepted history. */
export type AcceptedDailyPlan = z.infer<typeof AcceptedDailyPlan>;

/** Accept an initial draft while retaining an independent original snapshot. */
export function acceptDailyDraft(draft: DailyPlanSnapshot, acceptedAt: string): AcceptedDailyPlan {
  const version = { acceptedAt, snapshot: DailyPlanSnapshot.parse(draft) };
  return { original: version, current: version, history: [version] };
}

/** Accept a revised schedule without rewriting the original commitment. */
export function reviseDailyPlan(
  accepted: AcceptedDailyPlan,
  draft: DailyPlanSnapshot,
  acceptedAt: string,
): AcceptedDailyPlan {
  const snapshot = DailyPlanSnapshot.parse(draft);
  if (snapshot.date !== accepted.original.snapshot.date) {
    throw new Error('A daily plan revision must remain on the original date');
  }
  const current = { acceptedAt, snapshot };
  return {
    original: accepted.original,
    current,
    history: [...accepted.history, current],
  };
}
