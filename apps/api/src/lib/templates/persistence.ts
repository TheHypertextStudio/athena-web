import { isDeepStrictEqual } from 'node:util';
import {
  db,
  task,
  team,
  template,
  workTypeTeam,
  workTypeVersion,
  persistBlueprintProjection,
} from '@docket/db';
import { WorkTemplateDefinition } from '@docket/work/work-template-contract';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { CapabilityError, ConflictError, NotFoundError, ValidationError } from '../../error';
import { type TemplateActor } from './authorization';
import type { TemplateRow, TemplateVersionRow } from './model';
import { visibleTemplateWhere } from './visibility';
import { resolveBlueprintClosure } from '../work-template-blueprints/resolve';
import {
  lockPublicationClosure,
  publicationDefinitionIds,
} from '../work-template-blueprints/publication';
import { loadTemplateRestoration } from './restoration';

/** The existing database transaction type; definitions have no parallel data-access layer. */
export type TemplateTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Lock an already authorized tenant definition to serialize draft edits and publication. */
export async function lockTemplate(
  tx: TemplateTransaction,
  orgId: string,
  id: string,
  actorId: string,
): Promise<TemplateRow> {
  const [row] = await tx
    .select()
    .from(template)
    .where(visibleTemplateWhere(orgId, actorId, { id, includeArchived: true, includeBase: true }))
    .for('update');
  if (!row) throw new NotFoundError('Template not found');
  return row;
}

/** Refuse stale clients and edits to archived definitions. */
export function requireRevision(row: TemplateRow, expectedRevision: number): void {
  if (row.draftRevision !== expectedRevision) throw new ConflictError('Template draft changed');
  if (row.publicationState === 'archived') throw new ConflictError('Template is archived');
}

/** Validate that a starting draft cannot change the immutable work kind. */
export function requireDefinitionKind(row: TemplateRow, definition: WorkTemplateDefinition): void {
  if (row.targetType !== definition.payload.targetType) {
    throw new ValidationError([
      { message: 'A template cannot change kind.', path: ['definition', 'payload'] },
    ]);
  }
}

/** Replace creation offerings only for administrators, while accepting unchanged contributor saves. */
export async function replaceOfferings(
  tx: TemplateTransaction,
  actor: TemplateActor,
  row: TemplateRow,
  teamIds: readonly string[],
  canManageOfferings: boolean,
): Promise<void> {
  if (row.isBase && teamIds.length > 0)
    throw new ConflictError('Base templates cannot be narrowed');
  const existing = await tx
    .select({ id: workTypeTeam.teamId })
    .from(workTypeTeam)
    .where(and(eq(workTypeTeam.organizationId, actor.orgId), eq(workTypeTeam.workTypeId, row.id)));
  if (isDeepStrictEqual(existing.map((entry) => entry.id).sort(), [...teamIds].sort())) return;
  if (!canManageOfferings) throw new CapabilityError();

  if (teamIds.length > 0) {
    const teams = await tx
      .select({ id: team.id })
      .from(team)
      .where(and(eq(team.organizationId, actor.orgId), inArray(team.id, [...teamIds])));
    if (teams.length !== teamIds.length) throw new NotFoundError('Team not found');
  }
  await tx
    .delete(workTypeTeam)
    .where(and(eq(workTypeTeam.organizationId, actor.orgId), eq(workTypeTeam.workTypeId, row.id)));
  if (teamIds.length > 0)
    await tx.insert(workTypeTeam).values(
      teamIds.map((teamId) => ({
        organizationId: actor.orgId,
        workTypeId: row.id,
        teamId,
      })),
    );
}

/** Read the last public snapshot for a legacy edit, keeping unreviewed draft content private. */
export async function legacyTemplateDefinition(
  tx: TemplateTransaction,
  row: TemplateRow,
): Promise<WorkTemplateDefinition> {
  if (!row.latestPublishedVersionId) return row.draftDefinition;
  const [version] = await tx
    .select()
    .from(workTypeVersion)
    .where(
      and(
        eq(workTypeVersion.organizationId, row.organizationId),
        eq(workTypeVersion.workTypeId, row.id),
        eq(workTypeVersion.id, row.latestPublishedVersionId),
      ),
    )
    .limit(1);
  if (!version) throw new NotFoundError('Template version not found');
  // New read-time defaults must not turn an unchanged historical snapshot into a pending draft.
  const published = WorkTemplateDefinition.parse(version.definition);
  if (!isDeepStrictEqual(WorkTemplateDefinition.parse(row.draftDefinition), published)) {
    throw new ConflictError(
      'Publish or resolve the pending template draft before editing this starting point',
    );
  }
  return published;
}

/** Append a publication while the caller holds the definition row lock. */
export async function appendPublication(
  tx: TemplateTransaction,
  row: TemplateRow,
  actorId: string | null,
  retainedVersionId: string | null = row.latestPublishedVersionId,
): Promise<TemplateRow> {
  await lockPublicationClosure(tx, row, row.draftDefinition, retainedVersionId);
  if (row.scope !== 'organization') {
    await tx
      .update(template)
      .set({ scope: 'organization', teamId: null })
      .where(and(eq(template.organizationId, row.organizationId), eq(template.id, row.id)));
  }
  const [latest] = await tx
    .select({ number: workTypeVersion.number })
    .from(workTypeVersion)
    .where(
      and(
        eq(workTypeVersion.organizationId, row.organizationId),
        eq(workTypeVersion.workTypeId, row.id),
      ),
    )
    .orderBy(desc(workTypeVersion.number))
    .limit(1);
  const [version] = await tx
    .insert(workTypeVersion)
    .values({
      organizationId: row.organizationId,
      workTypeId: row.id,
      number: (latest?.number ?? 0) + 1,
      definition: WorkTemplateDefinition.parse(row.draftDefinition),
      publishedByActorId: actorId,
    })
    .returning();
  if (!version) throw new Error('Template publication returned no row');
  await persistBlueprintProjection(tx, {
    organizationId: row.organizationId,
    versionId: version.id,
    blueprint: version.definition.blueprint,
  });
  await resolveBlueprintClosure(
    tx,
    {
      organizationId: row.organizationId,
      kind: row.targetType,
      workTypeId: row.id,
      workTypeVersionId: version.id,
    },
    'publish',
    retainedVersionId,
  );
  const [published] = await tx
    .update(template)
    .set({
      publicationState: 'published',
      scope: 'organization',
      teamId: null,
      draftRevision: row.draftRevision + 1,
      latestPublishedVersionId: version.id,
      name: version.definition.name,
      description: version.definition.description,
      icon: version.definition.icon,
      payload: version.definition.payload,
    })
    .where(eq(template.id, row.id))
    .returning();
  if (!published) throw new NotFoundError('Template not found');
  return published;
}

/** Read immutable versions belonging to one tenant definition in publication order. */
export async function versionsFor(orgId: string, id: string): Promise<TemplateVersionRow[]> {
  return db
    .select()
    .from(workTypeVersion)
    .where(and(eq(workTypeVersion.organizationId, orgId), eq(workTypeVersion.workTypeId, id)))
    .orderBy(asc(workTypeVersion.number));
}

/** Hydrate creation offerings for a bounded list of authorized definitions. */
export async function offeringsFor(
  orgId: string,
  ids: readonly string[],
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  if (ids.length === 0) return result;
  const offerings = await db
    .select()
    .from(workTypeTeam)
    .where(and(eq(workTypeTeam.organizationId, orgId), inArray(workTypeTeam.workTypeId, [...ids])));
  for (const offering of offerings) {
    const teams = result.get(offering.workTypeId) ?? [];
    teams.push(offering.teamId);
    result.set(offering.workTypeId, teams);
  }
  return result;
}

/** Whether a private starting draft still supplies provenance for an existing Task. */
export async function templateDraftInUse(
  tx: TemplateTransaction,
  orgId: string,
  id: string,
): Promise<boolean> {
  const [work] = await tx
    .select({ id: task.id })
    .from(task)
    .where(and(eq(task.organizationId, orgId), eq(task.templateId, id)))
    .limit(1);
  return work !== undefined;
}

/** Undo creation without deleting published history or private starting-draft provenance. */
async function removeTemplateCreation(
  tx: TemplateTransaction,
  current: TemplateRow,
): Promise<'restored' | 'in_use'> {
  if (current.latestPublishedVersionId) {
    await tx
      .update(template)
      .set({ publicationState: 'archived', archivedAt: new Date() })
      .where(eq(template.id, current.id));
  } else {
    if (await templateDraftInUse(tx, current.organizationId, current.id)) return 'in_use';
    await tx.delete(template).where(eq(template.id, current.id));
  }
  return 'restored';
}

/** Lock the complete union of trusted undo publication closures before any catalog root is locked. */
export async function lockTemplateRestorations(
  tx: TemplateTransaction,
  orgId: string,
  entries: readonly {
    readonly id: string;
    readonly operation: string;
    readonly before: Record<string, unknown> | null;
  }[],
): Promise<void> {
  if (entries.length === 0) return;
  const roots = await tx
    .select()
    .from(template)
    .where(
      and(
        eq(template.organizationId, orgId),
        inArray(
          template.id,
          entries.map((entry) => entry.id),
        ),
      ),
    );
  const byId = new Map(roots.map((row) => [row.id, row]));
  const ids = new Set(roots.map((row) => row.id));
  for (const entry of entries) {
    const current = byId.get(entry.id);
    if (!current || current.isBase || entry.operation !== 'update' || !entry.before) continue;
    const prepared = await loadTemplateRestoration(tx, current, entry.before);
    if (!prepared?.changedPublication) continue;
    for (const id of await publicationDefinitionIds(
      tx,
      current,
      prepared.definition,
      prepared.retainedVersionId,
    ))
      ids.add(id);
  }
  await tx
    .select({ id: template.id })
    .from(template)
    .where(and(eq(template.organizationId, orgId), inArray(template.id, [...ids].sort())))
    .orderBy(asc(template.id))
    .for('update');
}

/** Restore a compatible undo snapshot without rewriting or removing published history. */
export async function restoreTemplateSnapshot(
  tx: TemplateTransaction,
  orgId: string,
  id: string,
  operation: string,
  before: Record<string, unknown> | null,
): Promise<'restored' | 'in_use' | 'no_prior_state'> {
  await lockTemplateRestorations(tx, orgId, [{ id, operation, before }]);
  const [current] = await tx
    .select()
    .from(template)
    .where(and(eq(template.organizationId, orgId), eq(template.id, id)))
    .for('update');
  if (!current || current.isBase) return 'in_use';
  if (operation === 'create') return removeTemplateCreation(tx, current);
  if (operation !== 'update' || before === null) return 'no_prior_state';
  return restoreTemplateEdit(tx, current, before);
}

/** Restore an active lifecycle snapshot when undo reverses an archive operation. */
function restoredTemplateLifecycle(
  current: TemplateRow,
  before: Record<string, unknown>,
): Pick<TemplateRow, 'publicationState' | 'archivedAt'> {
  const state = before['publicationState'];
  if (state === 'published' || state === 'draft') {
    return { publicationState: state, archivedAt: null };
  }
  return { publicationState: current.publicationState, archivedAt: current.archivedAt };
}

/** Restore the prior editable draft, and republish only when the undone operation published. */
async function restoreTemplateEdit(
  tx: TemplateTransaction,
  current: TemplateRow,
  before: Record<string, unknown>,
): Promise<'restored' | 'in_use'> {
  const prepared = await loadTemplateRestoration(tx, current, before);
  if (!prepared) return 'in_use';
  const { prior, priorDraft, definition, changedPublication, retainedVersionId } = prepared;
  const [draft] = await tx
    .update(template)
    .set({
      ...restoredTemplateLifecycle(current, before),
      draftDefinition: definition,
      draftRevision: current.draftRevision + 1,
      ...(current.latestPublishedVersionId
        ? {}
        : {
            ...prior,
            name: definition.name,
            description: definition.description,
            icon: definition.icon,
            payload: definition.payload,
          }),
    })
    .where(and(eq(template.organizationId, current.organizationId), eq(template.id, current.id)))
    .returning();
  if (!draft) throw new NotFoundError('Template not found');
  if (changedPublication) {
    await appendPublication(tx, draft, null, retainedVersionId);
    await tx
      .update(template)
      .set({ draftDefinition: priorDraft })
      .where(eq(template.id, current.id));
  }
  return 'restored';
}
