/**
 * `@docket/api` — creating and editing templates.
 *
 * @remarks
 * The REST templates router and the MCP `define_template` tool both write through here, so the
 * scope rules hold on both surfaces. A personal template belongs to its author, a team template
 * needs a team the author is in, and a template never changes the kind of work it creates.
 */
import { db, teamMember, template } from '@docket/db';
import type { TemplateCreate, TemplateOut, TemplateUpdate } from '@docket/work/template-contract';
import { and, eq } from 'drizzle-orm';
import type { z } from 'zod';

import { getDocumentImageReferenceReconciler } from '../../content/document-image-reference-registry';
import { NotFoundError, ValidationError } from '../../error';
import { visibleTemplateWhere } from './visibility';

/** A template row. */
export type TemplateRow = typeof template.$inferSelect;

/** A template's state on both sides of an update. */
export interface TemplateUpdateResult {
  readonly before: TemplateRow;
  readonly after: TemplateRow;
}

/** Serialize a template row for `TemplateOut`. */
export function toTemplateOut(row: TemplateRow): z.input<typeof TemplateOut> {
  return {
    id: row.id,
    organizationId: row.organizationId,
    targetType: row.targetType,
    name: row.name,
    description: row.description,
    scope: row.scope,
    ownerActorId: row.ownerActorId,
    teamId: row.teamId,
    payload: row.payload,
    isSeed: row.isSeed,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Reconcile a template projection without turning a derived-state failure into a lost edit. */
export async function reconcileTemplateImages(
  organizationId: string,
  templateId: string,
  operation: 'upsert' | 'delete',
): Promise<void> {
  try {
    const reconciler = getDocumentImageReferenceReconciler();
    if (operation === 'delete') {
      await reconciler.deleteForSubject(organizationId, 'template', templateId);
    } else {
      await reconciler.reconcile(organizationId, 'template', templateId);
    }
  } catch (error) {
    console.warn('Template document-image reconciliation failed', {
      organizationId,
      templateId,
      operation,
      error,
    });
  }
}

/**
 * Refuse a scope the calling actor may not put a template in.
 *
 * @throws {ValidationError} When a personal template names another owner, or a team template
 *   names no team.
 * @throws {NotFoundError} When the caller is not a member of the named team.
 */
async function requireAssignableScope(
  orgId: string,
  actorId: string,
  scope: TemplateRow['scope'],
  ownerActorId: string | null,
  teamId: string | null,
): Promise<void> {
  if (scope === 'personal' && ownerActorId !== actorId) {
    throw new ValidationError([
      {
        message: 'A personal template must belong to the calling actor.',
        path: ['ownerActorId'],
      },
    ]);
  }
  if (scope !== 'team') return;
  if (teamId === null) {
    throw new ValidationError([{ message: 'A team template requires a team.', path: ['teamId'] }]);
  }
  const membership = await db
    .select({ actorId: teamMember.actorId })
    .from(teamMember)
    .where(
      and(
        eq(teamMember.organizationId, orgId),
        eq(teamMember.actorId, actorId),
        eq(teamMember.teamId, teamId),
      ),
    )
    .limit(1);
  if (!membership[0]) throw new NotFoundError('Team not found');
}

/**
 * Load a template the actor may see.
 *
 * @throws {NotFoundError} When the template is hidden from the actor, cross-org, or unknown.
 */
export async function requireVisibleTemplate(
  orgId: string,
  actorId: string,
  id: string,
): Promise<TemplateRow> {
  const [row] = await db
    .select()
    .from(template)
    .where(visibleTemplateWhere(orgId, actorId, { id }))
    .limit(1);
  if (!row) throw new NotFoundError('Template not found');
  return row;
}

/**
 * Create a template.
 *
 * @param orgId - The verified tenant id.
 * @param actorId - The authoring actor, who owns a personal template.
 * @param body - The validated template to create.
 * @returns The inserted row.
 * @throws {ValidationError} When the scope is not one the actor may assign.
 * @throws {NotFoundError} When a team template names a team the actor is not in.
 */
export async function createTemplate(
  orgId: string,
  actorId: string,
  body: TemplateCreate,
): Promise<TemplateRow> {
  const scope = body.scope ?? 'personal';
  const ownerActorId = body.ownerActorId ?? actorId;
  // A team id on a non-team-scoped template would be a reference nothing reads and everything
  // has to remember to ignore.
  const teamId = scope === 'team' ? (body.teamId ?? null) : null;
  await requireAssignableScope(orgId, actorId, scope, ownerActorId, teamId);
  const [row] = await db
    .insert(template)
    .values({
      organizationId: orgId,
      targetType: body.targetType,
      name: body.name,
      description: body.description,
      scope,
      ownerActorId,
      teamId,
      payload: body.payload,
      createdBy: actorId,
    })
    .returning();
  /* v8 ignore next -- @preserve defensive: insert always returns a row */
  if (!row) throw new Error('template insert returned no row');
  await reconcileTemplateImages(orgId, row.id, 'upsert');
  return row;
}

/** Build the column patch for a template update. */
function templatePatch(
  body: TemplateUpdate,
  current: TemplateRow,
  nextOwnerActorId: string | null,
): Partial<typeof template.$inferInsert> {
  const ownerChanged = body.scope === 'personal' || body.ownerActorId !== undefined;
  return {
    ...(body.name !== undefined ? { name: body.name } : {}),
    ...(body.description !== undefined ? { description: body.description } : {}),
    ...(body.scope !== undefined ? { scope: body.scope, teamId: null } : {}),
    ...(ownerChanged ? { ownerActorId: nextOwnerActorId } : {}),
    // Applied after the scope reset above so a move *to* team scope keeps its new team.
    ...(body.teamId !== undefined && (body.scope ?? current.scope) === 'team'
      ? { teamId: body.teamId }
      : {}),
    ...(body.payload !== undefined ? { payload: body.payload } : {}),
  };
}

/**
 * Update a template the actor may see.
 *
 * @param orgId - The verified tenant id.
 * @param actorId - The editing actor.
 * @param id - The template to change.
 * @param body - The validated fields to change; `payload` replaces the old one whole.
 * @returns The row before and after the update.
 * @throws {ValidationError} When the new scope is not assignable or the payload changes kind.
 * @throws {NotFoundError} When the template or team is not visible to the actor.
 */
export async function updateTemplate(
  orgId: string,
  actorId: string,
  id: string,
  body: TemplateUpdate,
): Promise<TemplateUpdateResult> {
  const before = await requireVisibleTemplate(orgId, actorId, id);
  const nextScope = body.scope ?? before.scope;
  const nextOwnerActorId =
    body.scope === 'personal'
      ? (body.ownerActorId ?? actorId)
      : (body.ownerActorId ?? before.ownerActorId);
  const nextTeamId = nextScope === 'team' ? (body.teamId ?? before.teamId) : null;
  await requireAssignableScope(orgId, actorId, nextScope, nextOwnerActorId, nextTeamId);
  if (body.payload && body.payload.targetType !== before.targetType) {
    throw new ValidationError([
      { message: 'A template cannot change the kind it creates.', path: ['payload', 'targetType'] },
    ]);
  }
  const [after] = await db
    .update(template)
    .set(templatePatch(body, before, nextOwnerActorId))
    .where(visibleTemplateWhere(orgId, actorId, { id }))
    .returning();
  /* v8 ignore next -- @preserve defensive: the select above proved the row exists */
  if (!after) throw new NotFoundError('Template not found');
  await reconcileTemplateImages(orgId, after.id, 'upsert');
  return { before, after };
}
