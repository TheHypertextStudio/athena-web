import { canActor, satisfies, type Capability } from '@docket/authz';
import { db, organization, teamMember } from '@docket/db';
import { and, eq } from 'drizzle-orm';
import { CapabilityError, NotFoundError, ValidationError } from '../../error';
import type { TemplateRow } from './model';

/** Verified workspace identity, optionally carrying the REST middleware's live capabilities. */
export interface TemplateActor {
  readonly orgId: string;
  readonly actorId: string;
  readonly capabilities?: readonly string[];
}

/** Check authoring rights against the live workspace policy, including MCP callers. */
export async function mayAuthorTemplates(actor: TemplateActor): Promise<boolean> {
  const [org] = await db
    .select({ policy: organization.workTemplateAuthoring })
    .from(organization)
    .where(eq(organization.id, actor.orgId))
    .limit(1);
  if (!org) return false;
  const required = org.policy === 'admins' ? 'manage' : 'contribute';
  return hasTemplateCapability(actor, required);
}

/** Determine current workspace authority without trusting an actor-supplied role label. */
async function hasTemplateCapability(actor: TemplateActor, required: Capability): Promise<boolean> {
  if (actor.capabilities !== undefined) {
    return actor.capabilities.some((capability) => satisfies(capability as Capability, required));
  }
  return (
    await canActor(
      actor.actorId,
      required,
      { kind: 'organization', id: actor.orgId, orgId: actor.orgId },
      db,
    )
  ).allow;
}

/** Team offering changes are reserved for workspace administrators. */
export function mayManageTemplateOfferings(actor: TemplateActor): Promise<boolean> {
  return hasTemplateCapability(actor, 'manage');
}

/** Require current contribution rights and the configured workspace authoring policy. */
export async function requireTemplateAuthor(actor: TemplateActor): Promise<void> {
  if (!(await mayAuthorTemplates(actor))) throw new CapabilityError();
}

/** Require membership in a tenant-consistent team without exposing other teams. */
export async function requireTemplateTeam(
  actor: TemplateActor,
  teamId: string,
  client: Pick<typeof db, 'select'> = db,
): Promise<void> {
  const [membership] = await client
    .select({ actorId: teamMember.actorId })
    .from(teamMember)
    .where(
      and(
        eq(teamMember.organizationId, actor.orgId),
        eq(teamMember.actorId, actor.actorId),
        eq(teamMember.teamId, teamId),
      ),
    )
    .limit(1);
  if (!membership) throw new NotFoundError('Team not found');
}

/** Validate ownership and team visibility before creating or moving a private draft. */
export async function requireAssignableScope(
  actor: TemplateActor,
  scope: TemplateRow['scope'],
  ownerActorId: string | null,
  teamId: string | null,
  client: Pick<typeof db, 'select'> = db,
): Promise<void> {
  if (scope === 'personal' && ownerActorId !== actor.actorId) {
    throw new ValidationError([
      { message: 'A personal template must belong to its author.', path: ['ownerActorId'] },
    ]);
  }
  if (scope !== 'team') return;
  if (teamId === null) {
    throw new ValidationError([{ message: 'Choose a team for this draft.', path: ['teamId'] }]);
  }
  await requireTemplateTeam(actor, teamId, client);
}
