import { canActor } from '@docket/authz';
import { invocationHead, processDefinition, type Database } from '@docket/db';
import { and, eq, sql } from 'drizzle-orm';
import { CapabilityError, NotFoundError } from '../../error';
import { loadCreationActor } from '../work-creation/context';
import { rawResultRows } from '../raw-result';

/** A legacy ID identifies private workspace authoring, independently of an owned Program schedule. */
export interface LegacyDefinitionAccessRequest {
  readonly organizationId: string;
  readonly actorId?: string | undefined;
  readonly definitionId: string;
}
/**
 * Refuse missing foreground identity rather than treating nullable attribution as authorization.
 * @throws {NotFoundError} When no current foreground identity was supplied.
 */
export function requireLegacyActor(actorId: string | undefined): string {
  if (!actorId) throw new NotFoundError('Process definition not found');
  return actorId;
}
async function definitionOwner(
  database: Database,
  input: LegacyDefinitionAccessRequest,
): Promise<string | null> {
  const [head] = await database
    .select({
      id: invocationHead.id,
      ownerActorId: invocationHead.ownerActorId,
      canonicalAuthoringAt: invocationHead.canonicalAuthoringAt,
      status: invocationHead.status,
      archivedAt: invocationHead.archivedAt,
    })
    .from(invocationHead)
    .where(
      and(
        eq(invocationHead.organizationId, input.organizationId),
        eq(invocationHead.id, input.definitionId),
      ),
    )
    .limit(1);
  if (head) return head.ownerActorId;
  // RLS can make an existing private head invisible. Never reinterpret that as an
  // unconverted legacy definition and restore access through stale creator metadata.
  const security = await database.execute(
    sql`select row_security_active('work_template_invocation_head') as active`,
  );
  if (rawResultRows<{ active: boolean }>(security)[0]?.active !== false)
    throw new NotFoundError('Process definition not found');
  const [legacy] = await database
    .select({ id: processDefinition.id, createdBy: processDefinition.createdBy })
    .from(processDefinition)
    .where(
      and(
        eq(processDefinition.organizationId, input.organizationId),
        eq(processDefinition.id, input.definitionId),
      ),
    )
    .limit(1);
  if (!legacy) throw new NotFoundError('Process definition not found');
  return legacy.createdBy;
}
/**
 * Require live workspace visibility plus ownership or actual workspace Manage before reading private bodies.
 * @throws {NotFoundError} For missing, inactive, foreign or hidden authoring identities.
 * @throws {CapabilityError} When a visible owner lacks current editing permission.
 */
export async function requireLegacyDefinitionAccess(
  database: Database,
  input: LegacyDefinitionAccessRequest,
  access: 'view' | 'manage' = 'view',
): Promise<{ readonly canEdit: boolean }> {
  const actorId = requireLegacyActor(input.actorId);
  await loadCreationActor(database, input.organizationId, actorId);
  const ownerActorId = await definitionOwner(database, input);
  const scope = {
    kind: 'organization' as const,
    id: input.organizationId,
    orgId: input.organizationId,
  };
  const [visible, manager, contributor] = await Promise.all([
    canActor(actorId, 'view', scope, database),
    canActor(actorId, 'manage', scope, database),
    canActor(actorId, 'contribute', scope, database),
  ]);
  if (!visible.allow || (!manager.allow && ownerActorId !== actorId))
    throw new NotFoundError('Process definition not found');
  const canEdit = manager.allow || (ownerActorId === actorId && contributor.allow);
  if (access === 'manage' && !canEdit) throw new CapabilityError();
  return { canEdit };
}
