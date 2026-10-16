import { template } from '@docket/db';
import type { WorkTemplateCreate } from '@docket/work/work-template-contract';
import type { WorkTemplateOrigin } from '@docket/work/work-template-blueprint';
import { ValidationError } from '../../error';
import { loadCreationActor } from '../work-creation/context';
import {
  requireAssignableScope,
  requireTemplateAuthor,
  mayManageTemplateOfferings,
  type TemplateActor,
} from './authorization';
import { appendPublication, replaceOfferings, type TemplateTransaction } from './persistence';
import type { TemplateRow } from './model';
import { reconcileTemplateImages } from './images';
import type { TemplateCopyReservation } from './copy-reservation-proof';
import { claimReservedTemplateIdentity } from './copy-reservation-claim';

/** Committed template image projection work returned to the enclosing transaction owner. */
export interface TemplateCreationEffect {
  readonly organizationId: string;
  readonly templateId: string;
  readonly operation: 'upsert';
}
/** One canonical definition plus effects that must run only after its enclosing commit succeeds. */
export interface TemplateCreationResult {
  readonly row: TemplateRow;
  readonly effects: readonly TemplateCreationEffect[];
}
/** Server-only canonical creation controls; client JSON cannot publish, seed or set copy provenance. */
export interface TemplateCreationOptions {
  readonly identityReservation?: TemplateCopyReservation;
  readonly publish?: boolean;
  readonly isSeed?: boolean;
  readonly origin?: WorkTemplateOrigin | null;
}

async function creationOwnership(
  tx: TemplateTransaction,
  actor: TemplateActor,
  body: WorkTemplateCreate,
  publish: boolean | undefined,
) {
  const ownerActorId = body.ownerActorId ?? actor.actorId;
  const teamId = body.scope === 'team' ? (body.teamId ?? null) : null;
  await requireAssignableScope(actor, body.scope, ownerActorId, teamId, tx);
  if (body.scope === 'organization' && !publish)
    await requireAssignableScope(actor, 'personal', ownerActorId, null, tx);
  return { ownerActorId, teamId };
}

/**
 * Create through the sole canonical draft writer on an existing transaction, deferring image work.
 * The actor carries verified capabilities; foreground adapters refresh them before calling.
 * @throws When workspace authoring, ownership, offering or publication validation fails.
 */
export async function createWorkTemplateInTransaction(
  tx: TemplateTransaction,
  actor: TemplateActor,
  body: WorkTemplateCreate,
  options: TemplateCreationOptions = {},
): Promise<TemplateCreationResult> {
  await requireTemplateAuthor(actor, tx);
  const canManageOfferings = await mayManageTemplateOfferings(actor, tx);
  const ownership = await creationOwnership(tx, actor, body, options.publish);
  const reservedId = options.identityReservation
    ? await claimReservedTemplateIdentity(tx, options.identityReservation, actor, body)
    : null;
  const [created] = await tx
    .insert(template)
    .values({
      ...(reservedId ? { id: reservedId } : {}),
      organizationId: actor.orgId,
      targetType: body.targetType,
      scope: body.scope,
      isSeed: options.isSeed ?? false,
      ...ownership,
      createdBy: actor.actorId,
      draftDefinition: body.definition,
      name: body.definition.name,
      description: body.definition.description,
      icon: body.definition.icon,
      payload: body.definition.payload,
      originWorkTypeId: options.origin?.workTypeId ?? null,
      originWorkTypeVersionId: options.origin?.workTypeVersionId ?? null,
    })
    .returning();
  if (!created) throw new Error('Template insert returned no row');
  await replaceOfferings(tx, actor, created, body.offeredTeamIds, canManageOfferings);
  const row = options.publish ? await appendPublication(tx, created, actor.actorId) : created;
  return {
    row,
    effects: [{ organizationId: actor.orgId, templateId: row.id, operation: 'upsert' }],
  };
}

/**
 * Publish an organization definition atomically with an existing legacy authoring transaction.
 * Recheck actual membership, role and current authoring policy rather than supplied capabilities.
 * @throws When a real active author is unavailable, scope is private, or publication is invalid.
 */
export async function createPublishedWorkTemplateInTransaction(
  tx: TemplateTransaction,
  actor: TemplateActor,
  body: WorkTemplateCreate,
): Promise<TemplateCreationResult> {
  if (body.scope !== 'organization')
    throw new ValidationError([{ path: ['scope'], message: 'Publish a workspace template.' }]);
  const live = await loadCreationActor(tx, actor.orgId, actor.actorId);
  return createWorkTemplateInTransaction(tx, live, body, { publish: true });
}

/** Drain returned template effects after the enclosing transaction has committed successfully. */
export async function reconcileTemplateCreationEffects(
  effects: readonly TemplateCreationEffect[],
): Promise<void> {
  const unique = new Map(effects.map((effect) => [JSON.stringify(effect), effect]));
  for (const effect of unique.values())
    await reconcileTemplateImages(effect.organizationId, effect.templateId, effect.operation);
}
