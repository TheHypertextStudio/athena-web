import { cycle, db, integration, task, team } from '@docket/db';
import { and, eq, gt, inArray, isNull } from 'drizzle-orm';

import { ConflictError, NotFoundError, ValidationError } from '../error';
import { cycleWindowContaining } from '../lib/cycle-window';

type TeamRow = typeof team.$inferSelect;
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Database = Pick<typeof db, 'select'>;

/** Result metadata shown after a cadence change. */
export interface TeamCycleCadenceChange {
  readonly team: TeamRow;
  readonly effectiveAnchor: string;
  readonly removedEmptyCycles: number;
}

/** Read-only policy metadata needed to render the cadence editor safely. */
export interface TeamCycleCadencePolicy {
  readonly earliestAnchor: string;
  readonly providerOwned: boolean;
}

function nextDate(date: string): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}

async function lockTeam(tx: Transaction, orgId: string, teamId: string): Promise<TeamRow> {
  const rows = await tx
    .select()
    .from(team)
    .where(and(eq(team.id, teamId), eq(team.organizationId, orgId), isNull(team.archivedAt)))
    .limit(1)
    .for('update');
  const currentTeam = rows[0];
  if (!currentTeam) throw new NotFoundError('Team not found');
  return currentTeam;
}

async function assertNativeCadenceOwner(
  tx: Transaction,
  orgId: string,
  teamId: string,
): Promise<void> {
  const providerRows = await tx
    .select({ id: cycle.id })
    .from(cycle)
    .innerJoin(integration, eq(cycle.sourceIntegrationId, integration.id))
    .where(
      and(
        eq(cycle.organizationId, orgId),
        eq(cycle.teamId, teamId),
        eq(cycle.source, 'linked'),
        inArray(integration.status, ['connected', 'error']),
      ),
    )
    .limit(1);
  if (providerRows.length > 0) {
    throw new ConflictError('Cycle cadence is managed by its provider');
  }
}

async function preservedScheduleEnd(tx: Database, currentTeam: TeamRow, now: Date): Promise<Date> {
  const today = now.toISOString().slice(0, 10);
  const currentWindow = cycleWindowContaining(
    {
      anchorDate: currentTeam.cycleCadenceAnchor,
      cadenceDays: currentTeam.cycleCadenceDays,
    },
    today < currentTeam.cycleCadenceAnchor ? currentTeam.cycleCadenceAnchor : today,
  );
  const baselineEnd =
    today < currentTeam.cycleCadenceAnchor
      ? new Date(currentWindow.startsAt.getTime() - 1)
      : currentWindow.endsAt;
  const occupied = await tx
    .select({ endsAt: cycle.endsAt })
    .from(cycle)
    .innerJoin(task, eq(task.cycleId, cycle.id))
    .where(
      and(
        eq(cycle.organizationId, currentTeam.organizationId),
        eq(cycle.teamId, currentTeam.id),
        eq(cycle.source, 'native'),
        gt(cycle.endsAt, baselineEnd),
      ),
    );
  return occupied.reduce(
    (latest, row) => (row.endsAt.getTime() > latest.getTime() ? row.endsAt : latest),
    baselineEnd,
  );
}

/** Return the authoritative safe boundary and ownership state for one team's cadence editor. */
export async function readTeamCycleCadencePolicy(
  currentTeam: TeamRow,
  now: Date,
): Promise<TeamCycleCadencePolicy> {
  const providerRows = await db
    .select({ id: cycle.id })
    .from(cycle)
    .innerJoin(integration, eq(cycle.sourceIntegrationId, integration.id))
    .where(
      and(
        eq(cycle.organizationId, currentTeam.organizationId),
        eq(cycle.teamId, currentTeam.id),
        eq(cycle.source, 'linked'),
        inArray(integration.status, ['connected', 'error']),
      ),
    )
    .limit(1);
  const preservedThrough = await preservedScheduleEnd(db, currentTeam, now);
  return {
    earliestAnchor: nextDate(preservedThrough.toISOString().slice(0, 10)),
    providerOwned: providerRows.length > 0,
  };
}

async function deleteEmptyCyclesAfter(
  tx: Transaction,
  currentTeam: TeamRow,
  preservedThrough: Date,
): Promise<number> {
  const trailing = await tx
    .select({ id: cycle.id })
    .from(cycle)
    .where(
      and(
        eq(cycle.organizationId, currentTeam.organizationId),
        eq(cycle.teamId, currentTeam.id),
        eq(cycle.source, 'native'),
        gt(cycle.startsAt, preservedThrough),
      ),
    );
  const trailingIds = trailing.map(({ id }) => id);
  if (trailingIds.length === 0) return 0;
  const referenced = await tx
    .select({ cycleId: task.cycleId })
    .from(task)
    .where(inArray(task.cycleId, trailingIds));
  const referencedIds = new Set(referenced.flatMap(({ cycleId }) => (cycleId ? [cycleId] : [])));
  const emptyIds = trailingIds.filter((id) => !referencedIds.has(id));
  if (emptyIds.length > 0) await tx.delete(cycle).where(inArray(cycle.id, emptyIds));
  return emptyIds.length;
}

/** Change one team's native cadence without changing any task's existing cycle assignment. */
export async function changeTeamCycleCadence(input: {
  readonly orgId: string;
  readonly teamId: string;
  readonly expectedRevision: number;
  readonly cadenceDays?: number;
  readonly requestedAnchor?: string;
  readonly now: Date;
}): Promise<TeamCycleCadenceChange> {
  return db.transaction(async (tx) => {
    const currentTeam = await lockTeam(tx, input.orgId, input.teamId);
    await assertNativeCadenceOwner(tx, input.orgId, input.teamId);
    const cadenceDays = input.cadenceDays ?? currentTeam.cycleCadenceDays;
    const requestedAnchor = input.requestedAnchor ?? currentTeam.cycleCadenceAnchor;
    if (
      cadenceDays === currentTeam.cycleCadenceDays &&
      requestedAnchor === currentTeam.cycleCadenceAnchor
    ) {
      return {
        team: currentTeam,
        effectiveAnchor: currentTeam.cycleCadenceAnchor,
        removedEmptyCycles: 0,
      };
    }
    if (input.expectedRevision !== currentTeam.cycleCadenceRevision) {
      throw new ConflictError('Cycle cadence changed after it was loaded', 'cadence_changed');
    }

    const preservedThrough = await preservedScheduleEnd(tx, currentTeam, input.now);
    const earliestAnchor = nextDate(preservedThrough.toISOString().slice(0, 10));
    const effectiveAnchor = input.requestedAnchor ?? earliestAnchor;
    if (effectiveAnchor < earliestAnchor) {
      throw new ValidationError([
        {
          path: ['cycleCadenceAnchor'],
          message: `The new cadence must start on or after ${earliestAnchor}`,
        },
      ]);
    }
    const removedEmptyCycles = await deleteEmptyCyclesAfter(tx, currentTeam, preservedThrough);
    const updated = await tx
      .update(team)
      .set({
        cycleCadenceDays: cadenceDays,
        cycleCadenceAnchor: effectiveAnchor,
        cycleCadenceRevision: currentTeam.cycleCadenceRevision + 1,
      })
      .where(eq(team.id, currentTeam.id))
      .returning();
    const updatedTeam = updated[0];
    /* v8 ignore next -- @preserve defensive: the locked team row still exists in this transaction */
    if (!updatedTeam) throw new Error('team cadence update returned no row');
    return { team: updatedTeam, effectiveAnchor, removedEmptyCycles };
  });
}
