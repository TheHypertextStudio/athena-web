import { satisfies } from '@docket/authz';
import {
  actor,
  initiative,
  program,
  project,
  role,
  task,
  template,
  workTypeTeam,
  workTypeVersion,
} from '@docket/db';
import type { TemplateTargetType } from '@docket/work/template-contract';
import type { WorkTemplateChangeRequest } from '@docket/work/work-template-reference';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { ActorCtx } from '../context';
import { CapabilityError, NotFoundError, ValidationError } from '../error';
import { resourceAccessKey, resolveResourceAccessForActors } from '../permissions/resource-access';
import { assertSharedWorkWritable } from '../product-capability';
import type { TemplateTransaction } from './templates/persistence';
import { WorkTemplateDefinition } from '@docket/work/work-template-contract';

/** An existing row whose authored content can be compared with published starting values. */
export type TemplateWorkRow =
  | typeof task.$inferSelect
  | typeof project.$inferSelect
  | typeof program.$inferSelect
  | typeof initiative.$inferSelect;

/** Existing work tables, shared by identity preview and assignment. */
export const workTables = { task, project, initiative, program };

/** Require live edit rights before resolving a selected publication or returning work prose. */
export async function requireWorkAccess(
  tx: TemplateTransaction,
  caller: ActorCtx,
  kind: TemplateTargetType,
  id: string,
): Promise<void> {
  const [current] = await tx
    .select({
      id: actor.id,
      roleId: actor.roleId,
      roleKey: role.key,
      visibility: role.defaultVisibility,
    })
    .from(actor)
    .leftJoin(role, and(eq(role.id, actor.roleId), eq(role.organizationId, actor.organizationId)))
    .where(
      and(
        eq(actor.id, caller.actorId),
        eq(actor.organizationId, caller.orgId),
        eq(actor.status, 'active'),
        isNull(actor.archivedAt),
      ),
    )
    .limit(1);
  if (!current) throw new NotFoundError('Work not found');
  const ref = { organizationId: caller.orgId, kind, id };
  const access = (
    await resolveResourceAccessForActors(
      [
        {
          organizationId: caller.orgId,
          actorId: current.id,
          roleId: current.roleId,
          isGuest: current.roleKey === 'guest' || current.visibility === 'private',
        },
      ],
      [ref],
      tx,
    )
  ).get(resourceAccessKey(ref));
  if (!access?.canView) throw new NotFoundError('Work not found');
  if (
    !access.effectiveCapability ||
    !satisfies(access.effectiveCapability, kind === 'program' ? 'manage' : 'contribute')
  )
    throw new CapabilityError();
  await assertSharedWorkWritable(caller.orgId, undefined, tx);
}

/** Lock one active work record together with the team that controls template offerings. */
export async function lockTemplateWork(
  tx: TemplateTransaction,
  orgId: string,
  kind: TemplateTargetType,
  id: string,
): Promise<{ row: TemplateWorkRow; teamId: string | null }> {
  const table = workTables[kind];
  const teamId =
    kind === 'task'
      ? task.teamId
      : kind === 'project'
        ? project.teamId
        : kind === 'initiative'
          ? initiative.leadTeamId
          : sql<null>`NULL`;
  const [row] = await tx
    .select({ row: table, teamId })
    .from(table)
    .where(and(eq(table.organizationId, orgId), eq(table.id, id), isNull(table.archivedAt)))
    .for('update');
  if (!row) throw new NotFoundError('Work not found');
  return row;
}

/** Resolve exactly one offered, workspace-consistent immutable publication under its definition lock. */
export async function selectedVersion(
  tx: TemplateTransaction,
  orgId: string,
  kind: TemplateTargetType,
  selection: WorkTemplateChangeRequest,
  teamId: string | null,
): Promise<{ id: string; definition: WorkTemplateDefinition }> {
  // Definition edits, archive and offering changes acquire this same row lock.
  const [definition] = await tx
    .select({ latestVersionId: template.latestPublishedVersionId })
    .from(template)
    .where(
      and(
        eq(template.id, selection.workTypeId),
        eq(template.organizationId, orgId),
        eq(template.targetType, kind),
        eq(template.scope, 'organization'),
        eq(template.publicationState, 'published'),
        isNull(template.archivedAt),
      ),
    )
    .for('update');
  if (!definition?.latestVersionId) throw new NotFoundError('Template not found');
  const [version] = await tx
    .select({ id: workTypeVersion.id, definition: workTypeVersion.definition })
    .from(workTypeVersion)
    .where(
      and(
        eq(workTypeVersion.organizationId, orgId),
        eq(workTypeVersion.workTypeId, selection.workTypeId),
        eq(workTypeVersion.id, selection.workTypeVersionId ?? definition.latestVersionId),
      ),
    )
    .limit(1);
  if (!version) throw new NotFoundError('Template version not found');
  const offerings = await tx
    .select({ teamId: workTypeTeam.teamId })
    .from(workTypeTeam)
    .where(
      and(
        eq(workTypeTeam.organizationId, orgId),
        eq(workTypeTeam.workTypeId, selection.workTypeId),
      ),
    );
  if (offerings.length > 0 && !offerings.some((offering) => offering.teamId === teamId))
    throw new ValidationError([
      { path: ['workTypeId'], message: 'Choose a template offered for this team.' },
    ]);
  return { id: version.id, definition: WorkTemplateDefinition.parse(version.definition) };
}
