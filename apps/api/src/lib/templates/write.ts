import { templateReferenceWriteError } from './copy-reference-errors';
import { db, template } from '@docket/db';
import type { TemplateCreate, TemplateUpdate } from '@docket/work/template-contract';
import { WorkTemplateDefinition } from '@docket/work/work-template-contract';
import { and, eq } from 'drizzle-orm';
import { ConflictError, NotFoundError, ValidationError } from '../../error';
import { requireAssignableScope, requireTemplateAuthor, type TemplateActor } from './authorization';
import { reconcileTemplateImages } from './images';
import { type TemplateRow, type TemplateUpdateResult } from './model';
import {
  appendPublication,
  lockTemplate,
  requireDefinitionKind,
  templateDraftInUse,
  legacyTemplateDefinition,
  type TemplateTransaction,
} from './persistence';
import { archiveWorkTemplate, createWorkTemplate } from './service';
import { visibleTemplateWhere } from './visibility';
import { prepareTemplateCopyScopePublication } from './copy-publication';
import { templateCopyPendingSelection } from './copy-reference-integrity';
import { serializableTx } from '../serializable-tx';
import {
  readPublicationDraft,
  lockPublicationClosure,
} from '../work-template-blueprints/publication';

export { reconcileTemplateImages } from './images';
export { toTemplateOut, type TemplateRow, type TemplateUpdateResult } from './model';

/** Load an active legacy starting draft only after enforcing its scope visibility. */
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

/** Create through canonical persistence, publishing legacy workspace writes atomically. */
export async function createTemplate(
  orgId: string,
  actorId: string,
  body: TemplateCreate,
  capabilities?: readonly string[],
): Promise<TemplateRow> {
  const actor: TemplateActor = { orgId, actorId, ...(capabilities ? { capabilities } : {}) };
  return createWorkTemplate(
    actor,
    {
      targetType: body.targetType,
      scope: body.scope ?? 'personal',
      ...(body.ownerActorId ? { ownerActorId: body.ownerActorId } : {}),
      ...(body.scope === 'team' && body.teamId ? { teamId: body.teamId } : {}),
      offeredTeamIds: [],
      definition: WorkTemplateDefinition.parse({
        name: body.name,
        description: body.description,
        payload: body.payload,
      }),
    },
    { publish: body.scope === 'organization' },
  );
}

/** Validate the compatible scope transition without allowing published bodies to become private. */
async function nextScope(
  actor: TemplateActor,
  before: TemplateRow,
  body: TemplateUpdate,
  tx: TemplateTransaction,
) {
  const scope = body.scope ?? before.scope;
  const ownerActorId =
    body.scope === 'personal'
      ? (body.ownerActorId ?? actor.actorId)
      : (body.ownerActorId ?? before.ownerActorId);
  const teamId = scope === 'team' ? (body.teamId ?? before.teamId) : null;
  if (before.latestPublishedVersionId && scope !== 'organization') {
    throw new ConflictError('A published template cannot become private');
  }
  await requireAssignableScope(actor, scope, ownerActorId, teamId, tx);
  return { scope, ownerActorId, teamId };
}

/** Apply a legacy edit to the canonical draft and immediately publish workspace changes. */
export async function updateTemplate(
  orgId: string,
  actorId: string,
  id: string,
  body: TemplateUpdate,
  capabilities?: readonly string[],
): Promise<TemplateUpdateResult> {
  const actor: TemplateActor = { orgId, actorId, ...(capabilities ? { capabilities } : {}) };
  await requireVisibleTemplate(orgId, actorId, id);
  await requireTemplateAuthor(actor);
  const result = await serializableTx(async (tx) => {
    const before = await readPublicationDraft(tx, orgId, id, actorId);
    const scope = await nextScope(actor, before, body, tx);
    const previous = await legacyTemplateDefinition(tx, before);
    const definition = WorkTemplateDefinition.parse({
      ...previous,
      name: body.name ?? previous.name,
      description: Object.hasOwn(body, 'description')
        ? (body.description ?? null)
        : previous.description,
      payload: body.payload ?? previous.payload,
    });
    if (body.payload && body.payload.targetType !== before.targetType) {
      throw new ValidationError([
        { message: 'A template cannot change kind.', path: ['payload', 'targetType'] },
      ]);
    }
    requireDefinitionKind(before, definition);
    const locked =
      scope.scope === 'organization'
        ? await lockPublicationClosure(tx, before, definition)
        : await lockTemplate(tx, orgId, id, actorId);
    if (locked.draftRevision !== before.draftRevision)
      throw new ConflictError('Template draft changed');
    await prepareTemplateCopyScopePublication(tx, locked, actorId, scope.scope);
    const [draft] = await tx
      .update(template)
      .set({
        ...scope,
        draftDefinition: definition,
        draftRevision: before.draftRevision + 1,
        ...(before.latestPublishedVersionId
          ? {}
          : {
              name: definition.name,
              description: definition.description,
              payload: definition.payload,
            }),
      })
      .where(and(eq(template.organizationId, orgId), eq(template.id, id)))
      .returning();
    if (!draft) throw new NotFoundError('Template not found');
    const after =
      scope.scope === 'organization' ? await appendPublication(tx, draft, actorId) : draft;
    return { before, after };
  }).catch(templateReferenceWriteError);
  await reconcileTemplateImages(orgId, id, 'upsert');
  return result;
}

/** Preserve referenced publications on legacy delete; unused unpublished drafts may be removed. */
export async function deleteTemplate(
  orgId: string,
  actorId: string,
  id: string,
  capabilities?: readonly string[],
): Promise<TemplateRow> {
  const actor: TemplateActor = { orgId, actorId, ...(capabilities ? { capabilities } : {}) };
  const current = await requireVisibleTemplate(orgId, actorId, id);
  await requireTemplateAuthor(actor);
  if (current.latestPublishedVersionId) return archiveWorkTemplate(actor, id);
  const pending = await db.transaction((tx) => templateCopyPendingSelection(tx, actor, id));
  if (pending) return archiveWorkTemplate(actor, id);
  const row = await serializableTx(async (tx) => {
    const locked = await lockTemplate(tx, orgId, id, actorId);
    if (await templateDraftInUse(tx, orgId, id)) throw new ConflictError('Template is in use');
    if (locked.isBase || locked.latestPublishedVersionId)
      throw new ConflictError('Template has been published');
    const [deleted] = await tx
      .delete(template)
      .where(and(eq(template.organizationId, orgId), eq(template.id, id)))
      .returning();
    if (!deleted) throw new NotFoundError('Template not found');
    return deleted;
  }).catch(templateReferenceWriteError);
  await reconcileTemplateImages(orgId, id, 'delete');
  return row;
}
