import { actor as actorTable, changeSet, changeSetEntry, db, template } from '@docket/db';
import type {
  WorkTemplateCreate,
  WorkTemplateDraftUpdate,
  WorkTemplateListQuery,
} from '@docket/work/work-template-contract';
import { and, asc, eq } from 'drizzle-orm';
import { ConflictError, NotFoundError } from '../../error';
import {
  requireAssignableScope,
  requireTemplateAuthor,
  mayManageTemplateOfferings,
  type TemplateActor,
} from './authorization';
import { reconcileTemplateImages } from './images';
import { seedDefaultTemplates } from './defaults';
import { draftOf, type TemplateRow, type TemplateVersionRow } from './model';
import {
  appendPublication,
  lockTemplate,
  offeringsFor,
  replaceOfferings,
  requireDefinitionKind,
  requireRevision,
  versionsFor,
} from './persistence';
import { visibleTemplateWhere } from './visibility';

/** Load a tenant definition after applying private/team visibility, including retained archives. */
export async function getWorkTemplate(actor: TemplateActor, id: string): Promise<TemplateRow> {
  const [row] = await db
    .select()
    .from(template)
    .where(
      visibleTemplateWhere(actor.orgId, actor.actorId, {
        id,
        includeArchived: true,
        includeBase: true,
      }),
    )
    .limit(1);
  if (!row) throw new NotFoundError('Template not found');
  return row;
}

/** Discover visible definitions; read-only creation checks may opt out of catalog seeding. */
export async function listWorkTemplates(
  actor: TemplateActor,
  query: WorkTemplateListQuery,
  options: { readonly seedDefaults?: boolean } = {},
): Promise<TemplateRow[]> {
  if (options.seedDefaults !== false) await seedDefaultTemplates(actor.orgId, actor.actorId);
  const rows = await db
    .select()
    .from(template)
    .where(
      and(
        visibleTemplateWhere(actor.orgId, actor.actorId, {
          targetType: query.targetType,
          includeArchived: query.includeArchived === 'true',
          includeBase: true,
        }),
        query.includeDrafts === 'true' ? undefined : eq(template.scope, 'organization'),
        query.includeDrafts === 'true'
          ? undefined
          : query.includeArchived === 'true'
            ? undefined
            : eq(template.publicationState, 'published'),
      ),
    )
    .orderBy(asc(template.id));
  const offerings = await offeringsFor(
    actor.orgId,
    rows.map((row) => row.id),
  );
  return rows.filter((row) => {
    if (query.includeDrafts !== 'true' && row.publicationState === 'draft') return false;
    const teams = offerings.get(row.id) ?? [];
    return query.teamId === undefined || teams.length === 0 || teams.includes(query.teamId);
  });
}

/** Create an unpublished definition; callers must explicitly publish before sharing its identity. */
export async function createWorkTemplate(
  actor: TemplateActor,
  body: WorkTemplateCreate,
  options: { readonly publish?: boolean; readonly isSeed?: boolean } = {},
): Promise<TemplateRow> {
  await requireTemplateAuthor(actor);
  const canManageOfferings = await mayManageTemplateOfferings(actor);
  const ownerActorId = body.ownerActorId ?? actor.actorId;
  const teamId = body.scope === 'team' ? (body.teamId ?? null) : null;
  await requireAssignableScope(actor, body.scope, ownerActorId, teamId);
  if (body.scope === 'organization' && !options.publish) {
    await requireAssignableScope(actor, 'personal', ownerActorId, null);
  }
  const row = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(template)
      .values({
        organizationId: actor.orgId,
        targetType: body.targetType,
        scope: body.scope,
        isSeed: options.isSeed ?? false,
        ownerActorId,
        teamId,
        createdBy: actor.actorId,
        draftDefinition: body.definition,
        name: body.definition.name,
        description: body.definition.description,
        icon: body.definition.icon,
        payload: body.definition.payload,
      })
      .returning();
    if (!created) throw new Error('Template insert returned no row');
    await replaceOfferings(tx, actor, created, body.offeredTeamIds, canManageOfferings);
    return options.publish ? appendPublication(tx, created, actor.actorId) : created;
  });
  await reconcileTemplateImages(actor.orgId, row.id, 'upsert');
  return row;
}

/** Edit a revision using a row lock; published legacy projections stay on their last snapshot. */
export async function editWorkTemplateDraft(
  actor: TemplateActor,
  id: string,
  body: WorkTemplateDraftUpdate,
): Promise<TemplateRow> {
  await getWorkTemplate(actor, id);
  await requireTemplateAuthor(actor);
  const canManageOfferings = await mayManageTemplateOfferings(actor);
  const row = await db.transaction(async (tx) => {
    const current = await lockTemplate(tx, actor.orgId, id, actor.actorId);
    requireRevision(current, body.expectedRevision);
    const previous = draftOf(current);
    const definition =
      body.definition === undefined
        ? previous
        : {
            ...body.definition,
            ...(current.isBase ? { name: previous.name, icon: previous.icon } : {}),
          };
    requireDefinitionKind(current, definition);
    if (body.offeredTeamIds !== undefined)
      await replaceOfferings(tx, actor, current, body.offeredTeamIds, canManageOfferings);
    const projection =
      current.publicationState === 'draft'
        ? {
            name: definition.name,
            description: definition.description,
            icon: definition.icon,
            payload: definition.payload,
          }
        : {};
    const [updated] = await tx
      .update(template)
      .set({
        ...projection,
        draftDefinition: definition,
        draftRevision: current.draftRevision + 1,
      })
      .where(and(eq(template.organizationId, actor.orgId), eq(template.id, id)))
      .returning();
    if (!updated) throw new NotFoundError('Template not found');
    return updated;
  });
  await reconcileTemplateImages(actor.orgId, row.id, 'upsert');
  return row;
}

/** Publish one reviewed revision, appending an immutable version in the same transaction. */
export async function publishWorkTemplate(
  actor: TemplateActor,
  id: string,
  expectedRevision: number,
): Promise<TemplateRow> {
  await getWorkTemplate(actor, id);
  await requireTemplateAuthor(actor);
  const row = await db.transaction(async (tx) => {
    const current = await lockTemplate(tx, actor.orgId, id, actor.actorId);
    requireRevision(current, expectedRevision);
    return appendPublication(tx, current, actor.actorId);
  });
  await reconcileTemplateImages(actor.orgId, row.id, 'upsert');
  return row;
}

/** Archive a definition while preserving all publications and references from existing work. */
export async function archiveWorkTemplate(actor: TemplateActor, id: string): Promise<TemplateRow> {
  await getWorkTemplate(actor, id);
  await requireTemplateAuthor(actor);
  return db.transaction(async (tx) => {
    const current = await lockTemplate(tx, actor.orgId, id, actor.actorId);
    if (current.isBase) throw new ConflictError('Base templates cannot be archived');
    const [archived] = await tx
      .update(template)
      .set({
        publicationState: 'archived',
        archivedAt: new Date(),
      })
      .where(and(eq(template.organizationId, actor.orgId), eq(template.id, id)))
      .returning();
    if (!archived) throw new NotFoundError('Template not found');
    return archived;
  });
}

/** Return only a visible definition's immutable publications. */
export async function listWorkTemplateVersions(
  actor: TemplateActor,
  id: string,
): Promise<TemplateVersionRow[]> {
  await getWorkTemplate(actor, id);
  return versionsFor(actor.orgId, id);
}

/** Recheck visibility and current authoring policy before undo can mutate a template definition. */
export async function requireTemplateUndoAuthor(
  caller: TemplateActor | { readonly orgId: string; readonly userId: string },
  changeSetId: string,
): Promise<void> {
  const entries = await db
    .select({ id: changeSetEntry.entityId })
    .from(changeSetEntry)
    .innerJoin(changeSet, eq(changeSet.id, changeSetEntry.changeSetId))
    .where(
      and(
        eq(changeSet.organizationId, caller.orgId),
        eq(changeSet.id, changeSetId),
        eq(changeSetEntry.entityKind, 'template'),
      ),
    );
  if (entries.length === 0) return;
  let actor: TemplateActor;
  if ('actorId' in caller) actor = caller;
  else {
    const [member] = await db
      .select({ id: actorTable.id })
      .from(actorTable)
      .where(and(eq(actorTable.organizationId, caller.orgId), eq(actorTable.userId, caller.userId)))
      .limit(1);
    if (!member) throw new NotFoundError('Workspace not found');
    actor = { orgId: caller.orgId, actorId: member.id };
  }
  for (const entry of entries) await getWorkTemplate(actor, entry.id);
  await requireTemplateAuthor(actor);
}
