import { createHash } from 'node:crypto';
import {
  actor,
  actorAlias,
  agent,
  processProjectSpec,
  processTaskSpec,
  savedView,
  template,
  db,
  externalActor,
  initiative,
  invitation,
  program,
  project,
  projectMember,
  sourcePersonReference,
  task,
  teamMember,
} from '@docket/db';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { ActorId } from '@docket/identity-access/ids';
import { reconcileSourceAssignments } from '../lib/identity/source-person-assignment';
import { enqueueSearchUpsert } from '../search/write-through';
import { ConflictError, NotFoundError } from '../error';

/** Explicit survivor selection for a workspace person consolidation. */
export const PersonConsolidation = z.object({ survivorActorId: ActorId });
/** Confirmation carries the identity state the manager reviewed. */
export const PersonConsolidationConfirm = PersonConsolidation.extend({
  previewRevision: z.string().min(1),
});
/** Preview includes identity evidence and current work counts before confirmation. */
export const PersonConsolidationPreview = z.object({
  previewRevision: z.string(),
  sourceActorId: ActorId,
  survivorActorId: ActorId,
  sourceName: z.string(),
  survivorName: z.string(),
  assignments: z.number(),
  projects: z.number(),
  initiatives: z.number(),
  programs: z.number(),
  linkedIdentities: z.array(
    z.object({
      id: z.string(),
      actorId: z.string().nullable(),
      integrationId: z.string(),
      externalId: z.string(),
      displayName: z.string().nullable(),
      updatedAt: z.string(),
    }),
  ),
});

function consolidationRevision(
  source: typeof actor.$inferSelect,
  survivor: typeof actor.$inferSelect,
  identities: readonly (typeof externalActor.$inferSelect)[],
): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        people: [source, survivor].map((person) => ({
          id: person.id,
          updatedAt: person.updatedAt,
          displayName: person.displayName,
          userId: person.userId,
          status: person.status,
        })),
        identities: [...identities]
          .sort((left, right) => left.id.localeCompare(right.id))
          .map((identity) => ({
            id: identity.id,
            actorId: identity.actorId,
            integrationId: identity.integrationId,
            externalId: identity.externalId,
            displayName: identity.displayName,
            email: identity.email,
            avatarUrl: identity.avatarUrl,
            matchedBy: identity.matchedBy,
            ignoredAt: identity.ignoredAt,
            updatedAt: identity.updatedAt,
          })),
      }),
    )
    .digest('hex');
}

async function loadPeople(orgId: string, sourceId: string, survivorId: string) {
  if (sourceId === survivorId) throw new ConflictError('Choose two different people');
  const rows = await db
    .select()
    .from(actor)
    .where(
      and(
        eq(actor.organizationId, orgId),
        eq(actor.kind, 'human'),
        isNull(actor.archivedAt),
        inArray(actor.id, [sourceId, survivorId]),
      ),
    );
  const source = rows.find((person) => person.id === sourceId);
  const survivor = rows.find((person) => person.id === survivorId);
  if (!source || survivor?.status !== 'active') throw new NotFoundError('Person not found');
  if (source.userId)
    throw new ConflictError('The account-backed person must survive consolidation');
  return { source, survivor };
}

/** Preview the affected work without applying identity changes. */
export async function previewPersonConsolidation(
  orgId: string,
  sourceId: string,
  survivorId: string,
): Promise<z.infer<typeof PersonConsolidationPreview>> {
  const { source, survivor } = await loadPeople(orgId, sourceId, survivorId);
  const [counts, identities, projects, initiatives, programs] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(task)
      .where(and(eq(task.organizationId, orgId), eq(task.assigneeId, sourceId))),
    db
      .select()
      .from(externalActor)
      .where(
        and(
          eq(externalActor.organizationId, orgId),
          inArray(externalActor.actorId, [sourceId, survivorId]),
        ),
      ),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(project)
      .where(and(eq(project.organizationId, orgId), eq(project.leadId, sourceId))),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(initiative)
      .where(and(eq(initiative.organizationId, orgId), eq(initiative.ownerId, sourceId))),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(program)
      .where(and(eq(program.organizationId, orgId), eq(program.ownerId, sourceId))),
  ]);
  return {
    previewRevision: consolidationRevision(source, survivor, identities),
    sourceActorId: ActorId.parse(source.id),
    survivorActorId: ActorId.parse(survivor.id),
    sourceName: source.displayName,
    survivorName: survivor.displayName,
    assignments: counts[0]?.count ?? 0,
    linkedIdentities: identities.map((identity) => ({
      id: identity.id,
      actorId: identity.actorId,
      integrationId: identity.integrationId,
      externalId: identity.externalId,
      displayName: identity.displayName,
      updatedAt: identity.updatedAt.toISOString(),
    })),
    projects: projects[0]?.count ?? 0,
    initiatives: initiatives[0]?.count ?? 0,
    programs: programs[0]?.count ?? 0,
  };
}

/** Consolidate accountless records atomically while retaining historical IDs and attribution. */
export async function consolidatePeople(
  orgId: string,
  sourceId: string,
  survivorId: string,
  confirmation: { readonly mergedBy: string; readonly previewRevision: string },
): Promise<void> {
  const affected = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`people:${orgId}`}, 0))`);
    const rows = await tx
      .select()
      .from(actor)
      .where(and(eq(actor.organizationId, orgId), inArray(actor.id, [sourceId, survivorId])))
      .orderBy(actor.id)
      .for('update');
    const source = rows.find((person) => person.id === sourceId);
    const survivor = rows.find((person) => person.id === survivorId);
    if (
      !source ||
      !survivor ||
      source.kind !== 'human' ||
      survivor.kind !== 'human' ||
      source.archivedAt ||
      survivor.archivedAt ||
      survivor.status !== 'active'
    )
      throw new NotFoundError('Person not found');
    if (sourceId === survivorId || source.userId)
      throw new ConflictError('An account-backed person cannot be replaced');
    const identities = await tx
      .select()
      .from(externalActor)
      .where(
        and(
          eq(externalActor.organizationId, orgId),
          inArray(externalActor.actorId, [sourceId, survivorId]),
        ),
      )
      .orderBy(externalActor.id)
      .for('update');
    if (confirmation.previewRevision !== consolidationRevision(source, survivor, identities))
      throw new ConflictError('The people changed; review the consolidation again');
    const sourceWork = await repointPersonIdentities(tx, orgId, sourceId, survivorId);
    const work = await repointPersonWork(tx, orgId, sourceId, survivorId);
    const memberships = await repointPersonMemberships(tx, orgId, sourceId, survivorId);
    await repointPersonPlanning(tx, orgId, sourceId, survivorId);
    await tx
      .update(actorAlias)
      .set({ canonicalActorId: survivorId })
      .where(and(eq(actorAlias.organizationId, orgId), eq(actorAlias.canonicalActorId, sourceId)));
    await tx.insert(actorAlias).values({
      actorId: sourceId,
      canonicalActorId: survivorId,
      organizationId: orgId,
      mergedBy: confirmation.mergedBy,
    });
    await tx
      .update(actor)
      .set({ archivedAt: new Date(), status: 'suspended', roleId: null })
      .where(eq(actor.id, sourceId));
    return [...work, ...sourceWork, ...memberships];
  });
  const unique = new Map(affected.map((entity) => [`${entity.sourceTable}:${entity.id}`, entity]));
  for (const entity of unique.values()) {
    await enqueueSearchUpsert(orgId, entity.sourceTable, entity.id);
  }
}

interface AffectedPersonEntity {
  readonly sourceTable: string;
  readonly id: string;
}

type PersonTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function repointPersonWork(
  tx: PersonTransaction,
  orgId: string,
  sourceId: string,
  survivorId: string,
): Promise<AffectedPersonEntity[]> {
  const assigned = await tx
    .update(task)
    .set({ assigneeId: survivorId })
    .where(and(eq(task.organizationId, orgId), eq(task.assigneeId, sourceId)))
    .returning({ id: task.id });
  const delegated = await tx
    .update(task)
    .set({ delegateId: survivorId })
    .where(and(eq(task.organizationId, orgId), eq(task.delegateId, sourceId)))
    .returning({ id: task.id });
  const projects = await tx
    .update(project)
    .set({ leadId: survivorId })
    .where(and(eq(project.organizationId, orgId), eq(project.leadId, sourceId)))
    .returning({ id: project.id });
  const initiatives = await tx
    .update(initiative)
    .set({ ownerId: survivorId })
    .where(and(eq(initiative.organizationId, orgId), eq(initiative.ownerId, sourceId)))
    .returning({ id: initiative.id });
  const programs = await tx
    .update(program)
    .set({ ownerId: survivorId })
    .where(and(eq(program.organizationId, orgId), eq(program.ownerId, sourceId)))
    .returning({ id: program.id });
  return [
    ...[...assigned, ...delegated].map((row) => ({ ...row, sourceTable: 'task' })),
    ...projects.map((row) => ({ ...row, sourceTable: 'project' })),
    ...initiatives.map((row) => ({ ...row, sourceTable: 'initiative' })),
    ...programs.map((row) => ({ ...row, sourceTable: 'program' })),
  ];
}

async function repointPersonIdentities(
  tx: PersonTransaction,
  orgId: string,
  sourceId: string,
  survivorId: string,
): Promise<AffectedPersonEntity[]> {
  const identities = await tx
    .select({ id: externalActor.id })
    .from(externalActor)
    .where(and(eq(externalActor.organizationId, orgId), eq(externalActor.actorId, sourceId)));
  const references = await tx
    .select({ sourceTable: sourcePersonReference.subjectType, id: sourcePersonReference.subjectId })
    .from(sourcePersonReference)
    .where(
      and(
        eq(sourcePersonReference.organizationId, orgId),
        eq(sourcePersonReference.actorId, sourceId),
        isNull(sourcePersonReference.detachedAt),
      ),
    );
  for (const identity of identities)
    await reconcileSourceAssignments(tx, orgId, identity.id, survivorId);
  await tx
    .update(externalActor)
    .set({ actorId: survivorId })
    .where(and(eq(externalActor.organizationId, orgId), eq(externalActor.actorId, sourceId)));
  await tx
    .update(sourcePersonReference)
    .set({ actorId: survivorId })
    .where(
      and(
        eq(sourcePersonReference.organizationId, orgId),
        eq(sourcePersonReference.actorId, sourceId),
      ),
    );
  await tx
    .update(invitation)
    .set({ personActorId: survivorId })
    .where(
      and(
        eq(invitation.organizationId, orgId),
        eq(invitation.personActorId, sourceId),
        eq(invitation.status, 'pending'),
      ),
    );
  return references;
}

async function repointPersonMemberships(
  tx: PersonTransaction,
  orgId: string,
  sourceId: string,
  survivorId: string,
): Promise<AffectedPersonEntity[]> {
  const teams = await tx
    .select()
    .from(teamMember)
    .where(and(eq(teamMember.organizationId, orgId), eq(teamMember.actorId, sourceId)));
  if (teams.length)
    await tx
      .insert(teamMember)
      .values(teams.map((row) => ({ ...row, actorId: survivorId })))
      .onConflictDoNothing();
  await tx
    .delete(teamMember)
    .where(and(eq(teamMember.organizationId, orgId), eq(teamMember.actorId, sourceId)));
  const projects = await tx
    .select()
    .from(projectMember)
    .where(and(eq(projectMember.organizationId, orgId), eq(projectMember.actorId, sourceId)));
  if (projects.length)
    await tx
      .insert(projectMember)
      .values(projects.map((row) => ({ ...row, actorId: survivorId })))
      .onConflictDoNothing();
  await tx
    .delete(projectMember)
    .where(and(eq(projectMember.organizationId, orgId), eq(projectMember.actorId, sourceId)));
  return [
    ...teams.map((row) => ({ id: row.teamId, sourceTable: 'team' })),
    ...projects.map((row) => ({ id: row.projectId, sourceTable: 'project' })),
  ];
}

async function repointPersonPlanning(
  tx: PersonTransaction,
  orgId: string,
  sourceId: string,
  survivorId: string,
): Promise<void> {
  await tx
    .update(processProjectSpec)
    .set({ leadId: survivorId })
    .where(
      and(eq(processProjectSpec.organizationId, orgId), eq(processProjectSpec.leadId, sourceId)),
    );
  await tx
    .update(processTaskSpec)
    .set({ assigneeId: survivorId })
    .where(
      and(eq(processTaskSpec.organizationId, orgId), eq(processTaskSpec.assigneeId, sourceId)),
    );
  await tx
    .update(agent)
    .set({ accountableOwnerId: survivorId })
    .where(and(eq(agent.organizationId, orgId), eq(agent.accountableOwnerId, sourceId)));
  await tx
    .update(savedView)
    .set({ ownerActorId: survivorId })
    .where(and(eq(savedView.organizationId, orgId), eq(savedView.ownerActorId, sourceId)));
  await tx
    .update(template)
    .set({ ownerActorId: survivorId })
    .where(and(eq(template.organizationId, orgId), eq(template.ownerActorId, sourceId)));
  const templates = await tx.select().from(template).where(eq(template.organizationId, orgId));
  for (const row of templates) {
    const payload = { ...row.payload };
    let changed = false;
    for (const key of ['assigneeId', 'leadId', 'ownerId'] as const) {
      if (key in payload && payload[key as keyof typeof payload] === sourceId) {
        Object.assign(payload, { [key]: survivorId });
        changed = true;
      }
    }
    if (changed) await tx.update(template).set({ payload }).where(eq(template.id, row.id));
  }
}
