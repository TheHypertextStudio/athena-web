/** Confirmation projection keeps legacy Today reads and morning release in the same transaction. */
import { type db, dailyPlanItem, dayDirective, genId } from '@docket/db';
import type { DailyPlanSnapshot } from '@docket/planning/daily-plan-flow';
import { and, eq, sql } from 'drizzle-orm';
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
/** Update the legacy task projection and stamp the first daily acceptance release signal. */
export async function projectAcceptedDailyPlan(
  tx: Transaction,
  input: {
    hubId: string;
    date: string;
    snapshot: DailyPlanSnapshot;
    acceptedAt: string;
    timezone: string;
  },
): Promise<void> {
  const { hubId, date, snapshot, acceptedAt, timezone } = input;
  await tx
    .insert(dayDirective)
    .values({
      hubId,
      date,
      timezone,
      directiveId: genId(),
      agendaAcknowledgedAt: new Date(acceptedAt),
    })
    .onConflictDoUpdate({
      target: [dayDirective.hubId, dayDirective.date],
      set: {
        agendaAcknowledgedAt: sql`coalesce(${dayDirective.agendaAcknowledgedAt}, ${acceptedAt})`,
      },
    });

  // Legacy daily-plan clients still read one item per task. The accepted snapshot retains
  // every session while this projection keeps those clients consistent with confirmation.
  const legacy = await tx
    .select()
    .from(dailyPlanItem)
    .where(and(eq(dailyPlanItem.hubId, hubId), eq(dailyPlanItem.date, date)));
  const selected = new Set(snapshot.tasks.map((entry) => entry.taskId));
  for (const item of legacy) {
    if (item.status !== 'done' && !selected.has(item.refTaskId)) {
      await tx.delete(dailyPlanItem).where(eq(dailyPlanItem.id, item.id));
    }
  }
  for (const entry of snapshot.tasks) {
    const firstSession = snapshot.sessions.find((session) =>
      session.allocations.some((allocation) => allocation.taskId === entry.taskId),
    );
    const current = legacy.find((item) => item.refTaskId === entry.taskId);
    const values = {
      sort: entry.sort,
      timeboxStartsAt: firstSession ? new Date(firstSession.startsAt) : null,
      timeboxEndsAt: firstSession ? new Date(firstSession.endsAt) : null,
    };
    if (current) {
      await tx.update(dailyPlanItem).set(values).where(eq(dailyPlanItem.id, current.id));
    } else {
      await tx.insert(dailyPlanItem).values({
        hubId,
        date,
        refOrganizationId: entry.organizationId,
        refTaskId: entry.taskId,
        ...values,
      });
    }
  }
}
