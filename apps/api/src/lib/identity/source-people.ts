import {
  canonicalSourcePerson,
  sourceReferences,
  writeSourceAssignment,
  reconcileSourceAssignments,
  type SourcePersonTransaction,
} from './source-person-assignment';
import { createWorkspacePerson } from './create-person';
import type { z } from 'zod';
import { actor, db, externalActor, integration, sourcePersonReference, user } from '@docket/db';
import type {
  ExternalActorResolve,
  SourcePersonReferenceOut,
} from '@docket/connections/integration-contract';
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { ConflictError, NotFoundError } from '../../error';
import { serializableTx } from '../serializable-tx';
import { enqueueSearchUpsert } from '../../search/write-through';

type IdentityTransaction = SourcePersonTransaction;

async function ensureSourceIdentity(
  tx: IdentityTransaction,
  orgId: string,
  integrationId: string,
  externalId: string,
): Promise<typeof externalActor.$inferSelect> {
  const [existing] = await tx
    .select()
    .from(externalActor)
    .where(
      and(
        eq(externalActor.integrationId, integrationId),
        eq(externalActor.externalId, externalId),
        eq(externalActor.organizationId, orgId),
      ),
    );
  if (existing) return existing;
  const [connection] = await tx
    .select({ provider: integration.provider })
    .from(integration)
    .where(and(eq(integration.id, integrationId), eq(integration.organizationId, orgId)));
  if (!connection) throw new NotFoundError('Integration not found');
  const [identity] = await tx
    .insert(externalActor)
    .values({
      organizationId: orgId,
      integrationId,
      externalId,
      displayName: `${connection.provider} user ${externalId}`,
    })
    .onConflictDoUpdate({
      target: [externalActor.integrationId, externalActor.externalId],
      set: { updatedAt: new Date() },
    })
    .returning();
  if (!identity) throw new NotFoundError('External actor not found');
  return identity;
}

/** Preserve all imported people while retaining the native field's single-person cardinality. */
export async function preserveSourcePeople(
  input: {
    orgId: string;
    integrationId: string;
    subjectType: string;
    subjectId: string;
    field: string;
    externalIds: readonly string[];
  },
  transaction?: SourcePersonTransaction,
): Promise<(string | null)[]> {
  const preserve = async (tx: SourcePersonTransaction) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`people:${input.orgId}`}, 0))`,
    );
    await tx
      .update(sourcePersonReference)
      .set({ detachedAt: new Date() })
      .where(
        and(
          eq(sourcePersonReference.organizationId, input.orgId),
          eq(sourcePersonReference.subjectType, input.subjectType),
          eq(sourcePersonReference.subjectId, input.subjectId),
          eq(sourcePersonReference.field, input.field),
          inArray(
            sourcePersonReference.externalActorId,
            tx
              .select({ id: externalActor.id })
              .from(externalActor)
              .where(eq(externalActor.integrationId, input.integrationId)),
          ),
        ),
      );
    const actorIds: (string | null)[] = [];
    for (const externalId of new Set(input.externalIds)) {
      const identity = await ensureSourceIdentity(tx, input.orgId, input.integrationId, externalId);
      await tx
        .insert(sourcePersonReference)
        .values({
          organizationId: input.orgId,
          externalActorId: identity.id,
          subjectType: input.subjectType,
          subjectId: input.subjectId,
          field: input.field,
          actorId: identity.actorId,
          sourceDisplayName: identity.displayName,
        })
        .onConflictDoUpdate({
          target: [
            sourcePersonReference.subjectType,
            sourcePersonReference.subjectId,
            sourcePersonReference.field,
            sourcePersonReference.externalActorId,
          ],
          set: { actorId: identity.actorId, detachedAt: null, updatedAt: new Date() },
        });
      actorIds.push(identity.actorId);
    }
    const active = await sourceReferences(tx, input);
    await writeSourceAssignment(tx, input, canonicalSourcePerson(active));
    return actorIds;
  };
  return transaction ? preserve(transaction) : serializableTx(preserve);
}

/** Preserve a work-graph task's imported assignee even before identity resolution. */
export async function preserveSourceAssignee(
  orgId: string,
  integrationId: string,
  taskId: string,
  externalId: string | null,
  transaction?: SourcePersonTransaction,
): Promise<void> {
  await preserveSourcePeople(
    {
      orgId,
      integrationId,
      subjectType: 'task',
      subjectId: taskId,
      field: 'assignee',
      externalIds: externalId ? [externalId] : [],
    },
    transaction,
  );
}

/** Record a user's explicit field edit so later identity linking cannot undo it. */
export async function detachSourcePeople(
  orgId: string,
  subjectType: string,
  subjectId: string,
  field: string,
  database: Pick<IdentityTransaction, 'update'> = db,
): Promise<void> {
  await database
    .update(sourcePersonReference)
    .set({ detachedAt: new Date() })
    .where(
      and(
        eq(sourcePersonReference.organizationId, orgId),
        eq(sourcePersonReference.subjectType, subjectType),
        eq(sourcePersonReference.subjectId, subjectId),
        eq(sourcePersonReference.field, field),
      ),
    );
}

/** Read active source references scoped to a workspace and an entity. */
export async function sourcePeopleForSubject(
  orgId: string,
  subjectType: string,
  subjectId: string,
): Promise<z.input<typeof SourcePersonReferenceOut>[]> {
  return (await sourcePeopleForSubjects(orgId, subjectType, [subjectId])).get(subjectId) ?? [];
}

/** Batch source attribution for visible entities without a query per list row. */
export async function sourcePeopleForSubjects(
  orgId: string,
  subjectType: string,
  subjectIds: readonly string[],
): Promise<Map<string, z.input<typeof SourcePersonReferenceOut>[]>> {
  const result = new Map<string, z.input<typeof SourcePersonReferenceOut>[]>();
  if (subjectIds.length === 0) return result;
  const rows = await db
    .select({
      subjectId: sourcePersonReference.subjectId,
      id: sourcePersonReference.id,
      externalActorId: externalActor.id,
      integrationId: integration.id,
      provider: integration.provider,
      externalId: externalActor.externalId,
      displayName: externalActor.displayName,
      avatarUrl: externalActor.avatarUrl,
      actorId: externalActor.actorId,
      field: sourcePersonReference.field,
      canonicalDisplayName: actor.displayName,
      canonicalAvatarUrl: actor.avatar,
      updatedAt: externalActor.updatedAt,
    })
    .from(sourcePersonReference)
    .innerJoin(externalActor, eq(sourcePersonReference.externalActorId, externalActor.id))
    .innerJoin(
      integration,
      and(eq(externalActor.integrationId, integration.id), eq(integration.organizationId, orgId)),
    )
    .leftJoin(actor, and(eq(actor.id, externalActor.actorId), eq(actor.organizationId, orgId)))
    .where(
      and(
        eq(sourcePersonReference.organizationId, orgId),
        eq(sourcePersonReference.subjectType, subjectType),
        inArray(sourcePersonReference.subjectId, [...subjectIds]),
        isNull(sourcePersonReference.detachedAt),
      ),
    );
  for (const { subjectId, ...row } of rows)
    result.set(subjectId, [
      ...(result.get(subjectId) ?? []),
      { ...row, updatedAt: row.updatedAt.toISOString() },
    ]);
  return result;
}

interface PersonCandidate {
  actorId: string;
  displayName: string;
  avatarUrl: string | null;
  reason: 'name' | 'email' | 'linked';
}

async function loadSourceIdentity(
  orgId: string,
  integrationId: string,
  identityId: string,
): Promise<typeof externalActor.$inferSelect> {
  const [identity] = await db
    .select()
    .from(externalActor)
    .where(
      and(
        eq(externalActor.organizationId, orgId),
        eq(externalActor.integrationId, integrationId),
        eq(externalActor.id, identityId),
      ),
    );
  if (!identity) throw new NotFoundError('External actor not found');
  return identity;
}

function candidateReason(
  identity: typeof externalActor.$inferSelect,
  actorId: string,
  email: string | null,
): PersonCandidate['reason'] {
  if (actorId === identity.actorId) return 'linked';
  if (identity.email && email?.toLowerCase() === identity.email.toLowerCase()) return 'email';
  return 'name';
}

/** Suggest workspace people using observable evidence without automatically linking them. */
export async function externalPersonCandidates(
  orgId: string,
  integrationId: string,
  identityId: string,
): Promise<PersonCandidate[]> {
  const identity = await loadSourceIdentity(orgId, integrationId, identityId);
  const rows = await db
    .select({
      actorId: actor.id,
      displayName: actor.displayName,
      avatarUrl: actor.avatar,
      email: user.email,
    })
    .from(actor)
    .leftJoin(user, eq(actor.userId, user.id))
    .where(
      and(
        eq(actor.organizationId, orgId),
        eq(actor.kind, 'human'),
        eq(actor.status, 'active'),
        isNull(actor.archivedAt),
        or(
          eq(sql`lower(${actor.displayName})`, identity.displayName.toLowerCase()),
          ...(identity.email ? [eq(sql`lower(${user.email})`, identity.email.toLowerCase())] : []),
          ...(identity.actorId ? [eq(actor.id, identity.actorId)] : []),
        ),
      ),
    )
    .limit(20);
  return rows.map(({ email, ...row }) => ({
    ...row,
    reason: candidateReason(identity, row.actorId, email),
  }));
}

/** Apply a human decision atomically and update only assignments still derived from this source. */
export async function resolveSourcePerson(
  orgId: string,
  integrationId: string,
  identityId: string,
  decision: z.input<typeof ExternalActorResolve>,
): Promise<typeof externalActor.$inferSelect> {
  const result = await serializableTx(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`people:${orgId}`}, 0))`);
    const [identity] = await tx
      .select()
      .from(externalActor)
      .where(
        and(
          eq(externalActor.organizationId, orgId),
          eq(externalActor.integrationId, integrationId),
          eq(externalActor.id, identityId),
        ),
      )
      .for('update');
    if (!identity) throw new NotFoundError('External actor not found');
    if (
      decision.expectedUpdatedAt &&
      identity.updatedAt.toISOString() !== decision.expectedUpdatedAt
    )
      throw new ConflictError('This identity changed. Refresh before choosing a person.');
    if (
      decision.action === 'create_actor' &&
      !decision.expectedUpdatedAt &&
      identity.actorId &&
      identity.matchedBy === 'manual'
    )
      return identity;
    const actorId = await personForDecision(tx, orgId, identity, decision);
    await reconcileSourceAssignments(tx, orgId, identity.id, actorId);
    const [updated] = await tx
      .update(externalActor)
      .set({
        actorId,
        matchedBy: decision.action === 'unignore' || decision.action === 'skip' ? null : 'manual',
        ignoredAt: decision.action === 'skip' ? new Date() : null,
      })
      .where(eq(externalActor.id, identity.id))
      .returning();
    if (!updated) throw new NotFoundError('External actor not found');
    return updated;
  });
  if (result.actorId) await enqueueSearchUpsert(orgId, 'actor', result.actorId);
  const references = await db
    .select({
      subjectType: sourcePersonReference.subjectType,
      subjectId: sourcePersonReference.subjectId,
    })
    .from(sourcePersonReference)
    .where(
      and(
        eq(sourcePersonReference.organizationId, orgId),
        eq(sourcePersonReference.externalActorId, identityId),
        isNull(sourcePersonReference.detachedAt),
      ),
    );
  for (const reference of references)
    await enqueueSearchUpsert(orgId, reference.subjectType, reference.subjectId);

  return result;
}

async function personForDecision(
  tx: IdentityTransaction,
  orgId: string,
  identity: typeof externalActor.$inferSelect,
  decision: z.input<typeof ExternalActorResolve>,
): Promise<string | null> {
  let actorId: string | null = null;
  if (decision.action === 'match_existing') {
    const [person] = await tx
      .select()
      .from(actor)
      .where(
        and(
          eq(actor.id, decision.actorId),
          eq(actor.organizationId, orgId),
          eq(actor.kind, 'human'),
          eq(actor.status, 'active'),
          isNull(actor.archivedAt),
        ),
      )
      .for('update');
    if (!person) throw new NotFoundError('Actor not found');
    actorId = person.id;
  } else if (decision.action === 'create_actor') {
    const person = await createWorkspacePerson(tx, {
      orgId,
      displayName: decision.name ?? identity.displayName,
      avatar: identity.avatarUrl,
    });
    actorId = person.id;
  }
  return actorId;
}

/** Detach provenance only when an editor explicitly supplied this person field. */
export async function detachEditedSourcePeople(
  input: { orgId: string; subjectType: string; subjectId: string; field: string; value: unknown },
  database: Pick<IdentityTransaction, 'update'>,
): Promise<void> {
  if (input.value !== undefined)
    await detachSourcePeople(
      input.orgId,
      input.subjectType,
      input.subjectId,
      input.field,
      database,
    );
}
