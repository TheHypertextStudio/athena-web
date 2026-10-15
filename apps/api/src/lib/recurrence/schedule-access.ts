import { canActor } from '@docket/authz';
import { recurrenceSeries, type Database } from '@docket/db';
import { and, eq, isNull } from 'drizzle-orm';
import { CapabilityError, NotFoundError } from '../../error';
import { loadCreationActor } from '../work-creation/context';

/** Tenant-qualified schedule identity; a supplied identifier alone grants no access. */
export interface ScheduleAccessRequest {
  readonly organizationId: string;
  readonly actorId: string;
  readonly seriesId: string;
}
/** A checked private schedule and the caller's current editing rights. */
export interface AuthorizedSchedule {
  readonly series: typeof recurrenceSeries.$inferSelect;
  readonly canEdit: boolean;
}
/** Authorize private schedule drafts for their live owner or a manager of their actual scope. */
export async function requireScheduleAccess(
  database: Database,
  input: ScheduleAccessRequest,
  access: 'view' | 'manage' = 'view',
): Promise<AuthorizedSchedule> {
  await loadCreationActor(database, input.organizationId, input.actorId);
  const [series] = await database
    .select()
    .from(recurrenceSeries)
    .where(
      and(
        eq(recurrenceSeries.id, input.seriesId),
        eq(recurrenceSeries.organizationId, input.organizationId),
        isNull(recurrenceSeries.archivedAt),
      ),
    )
    .limit(1);
  if (!series) throw new NotFoundError('Schedule not found');
  const scope = series.ownerProgramId
    ? { kind: 'program' as const, id: series.ownerProgramId, orgId: input.organizationId }
    : { kind: 'organization' as const, id: input.organizationId, orgId: input.organizationId };
  const [visible, manager, contributor] = await Promise.all([
    canActor(input.actorId, 'view', scope, database),
    canActor(input.actorId, 'manage', scope, database),
    canActor(
      input.actorId,
      'contribute',
      { kind: 'organization', id: input.organizationId, orgId: input.organizationId },
      database,
    ),
  ]);
  if (!visible.allow || (!manager.allow && series.createdBy !== input.actorId))
    throw new NotFoundError('Schedule not found');
  const canEdit = manager.allow || (series.createdBy === input.actorId && contributor.allow);
  if (access === 'manage' && !canEdit) throw new CapabilityError();
  return { series, canEdit };
}
