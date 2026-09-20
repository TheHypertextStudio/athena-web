import { cycle, team } from '@docket/db';
import type { db } from '@docket/db';
import { and, asc, eq, inArray } from 'drizzle-orm';

import { ConflictError, NotFoundError } from '../error';

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Database = typeof db | Transaction;

/** Lock the affected teams and validate one task-cycle assignment against the current cadence. */
export async function assertTaskCycleAssignment(
  database: Database,
  input: {
    readonly organizationId: string;
    readonly cycleId: string | null | undefined;
    readonly teamIds: readonly string[];
    readonly cadenceRevision?: number | undefined;
  },
): Promise<void> {
  if (!input.cycleId) return;
  const teamIds = [...new Set(input.teamIds)].sort();
  const lockedTeams = await database
    .select({ id: team.id, cadenceRevision: team.cycleCadenceRevision })
    .from(team)
    .where(and(eq(team.organizationId, input.organizationId), inArray(team.id, teamIds)))
    .orderBy(asc(team.id))
    .for('update');
  if (lockedTeams.length !== teamIds.length) throw new NotFoundError('Team not found');
  if (
    input.cadenceRevision !== undefined &&
    lockedTeams.some((row) => row.cadenceRevision !== input.cadenceRevision)
  ) {
    throw new ConflictError('Cycle cadence changed after it was loaded', 'cadence_changed');
  }

  const rows = await database
    .select({ teamId: cycle.teamId })
    .from(cycle)
    .where(and(eq(cycle.organizationId, input.organizationId), eq(cycle.id, input.cycleId)))
    .limit(1);
  const target = rows[0];
  if (!target) throw new NotFoundError('Cycle not found');
  if (teamIds.some((teamId) => teamId !== target.teamId)) {
    throw new ConflictError('Cycle belongs to another team', 'cadence_changed');
  }
}

/** Validate a cycle target for a set of task rows. */
export async function assertCycle(
  database: Database,
  organizationId: string,
  cycleId: string | null | undefined,
  taskRows: readonly { readonly teamId: string }[],
  cadenceRevision?: number,
): Promise<void> {
  await assertTaskCycleAssignment(database, {
    organizationId,
    cycleId,
    teamIds: taskRows.map((row) => row.teamId),
    cadenceRevision,
  });
}

/** Validate one team's cycle target against its locked cadence revision. */
export async function assertTeamCycle(
  database: Database,
  organizationId: string,
  cycleId: string | null | undefined,
  teamId: string,
  cadenceRevision?: number,
): Promise<void> {
  await assertCycle(database, organizationId, cycleId, [{ teamId }], cadenceRevision);
}
