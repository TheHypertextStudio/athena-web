import { setTaskState } from '../task-state';
import { actor, db, externalActor, sourcePersonReference, teamMember, user } from '@docket/db';
import type { MirrorValue, MirrorSourceValue } from '@docket/connections/notion/mirror-values';
import { personCompanionKey } from '@docket/connections/notion/mirror-schema';
import { and, eq, isNull, sql, type SQL } from 'drizzle-orm';
import type { SourcePersonTransaction } from './source-person-assignment';
import { preserveSourcePeople } from './source-people';

/** Preserve native Notion person IDs during an accepted pull without guessing from text names. */
export async function applyNotionSourcePeople(
  input: {
    orgId: string;
    integrationId: string;
    subjectType: string;
    subjectId: string;
    values: Readonly<Record<string, MirrorValue>>;
  },
  transaction?: SourcePersonTransaction,
): Promise<void> {
  const field =
    input.subjectType === 'task' ? 'assignee' : input.subjectType === 'project' ? 'lead' : null;
  if (!field) return;
  const direct = input.values[field];
  const companion = input.values[personCompanionKey(field)];
  const people = direct?.kind === 'people' ? direct : companion;
  if (people?.kind !== 'people') return;
  await preserveSourcePeople({ ...input, field, externalIds: people.externalIds }, transaction);
}

/** Load source IDs once for an entity projection and retain them in person-valued fields. */
export async function notionPersonFields(
  orgId: string,
  integrationId: string,
  entity: string,
  names: ReadonlyMap<string, string>,
): Promise<
  (field: string, id: string | null, entityId: string) => Record<string, MirrorSourceValue>
> {
  const sourceRows = await db
    .select({
      subjectId: sourcePersonReference.subjectId,
      field: sourcePersonReference.field,
      externalId: externalActor.externalId,
    })
    .from(sourcePersonReference)
    .innerJoin(externalActor, eq(externalActor.id, sourcePersonReference.externalActorId))
    .where(
      and(
        eq(sourcePersonReference.organizationId, orgId),
        eq(sourcePersonReference.subjectType, entity),
        eq(externalActor.integrationId, integrationId),
        isNull(sourcePersonReference.detachedAt),
      ),
    );
  const sourcePeople = new Map<string, string[]>();
  for (const row of sourceRows) {
    const key = `${row.subjectId}:${row.field}`;
    sourcePeople.set(key, [...(sourcePeople.get(key) ?? []), row.externalId]);
  }
  return (field, id, entityId) => {
    const actorRef: MirrorSourceValue = {
      kind: 'actor',
      actorId: id,
      sourceExternalIds: sourcePeople.get(`${entityId}:${field}`) ?? [],
      displayName: id === null ? null : (names.get(id) ?? null),
    };
    return { [field]: actorRef, [personCompanionKey(field)]: actorRef };
  };
}

/** Reject a provider write if the local entity changed since its conflict decision. */
export function notionSourceRevision(
  column: Parameters<typeof eq>[0],
  context?: { expectedUpdatedAt?: Date },
): SQL | undefined {
  return context?.expectedUpdatedAt ? eq(column, context.expectedUpdatedAt) : undefined;
}

/** Commit provider fields and their source people together after the same row revision check. */
export async function applyNotionSourcePatch(
  input: {
    orgId: string;
    subjectType: string;
    subjectId: string;
    values: Readonly<Record<string, MirrorValue>>;
    integrationId?: string;
  },
  write: (tx: SourcePersonTransaction) => Promise<{ id: string }[]>,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`people:${input.orgId}`}, 0))`,
    );
    const rows = await write(tx);
    if (rows.length && input.integrationId)
      await applyNotionSourcePeople({ ...input, integrationId: input.integrationId }, tx);
    return rows.length > 0;
  });
}

/** Insert imported work and its person attribution atomically before publishing either. */
export async function insertNotionSourceEntity(
  input: {
    orgId: string;
    integrationId: string;
    subjectType: string;
    values: Readonly<Record<string, MirrorValue>>;
  },
  insert: (tx: SourcePersonTransaction) => Promise<{ id: string }[]>,
): Promise<{ id: string } | undefined> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`people:${input.orgId}`}, 0))`,
    );
    const [row] = await insert(tx);
    if (row) await applyNotionSourcePeople({ ...input, subjectId: row.id }, tx);
    return row;
  });
}

/** Apply a recognized provider state while leaving unknown workspace status names unchanged. */
export async function applyNotionTaskState(
  orgId: string,
  actorId: string,
  taskId: string,
  exists: boolean,
  values: Readonly<Record<string, MirrorValue>>,
): Promise<void> {
  const state = values['state'];
  if (!exists || state?.kind !== 'option' || !state.value) return;
  try {
    await setTaskState({ organizationId: orgId, taskId, state: state.value, actorId });
  } catch {
    // Unknown provider status names remain unapplied, matching other unrecognized enum values.
  }
}

/** Load active human records and their team links for the Notion People projection. */
export async function loadNotionRoster(orgId: string): Promise<
  [
    (Pick<typeof actor.$inferSelect, 'id' | 'displayName' | 'title' | 'userId'> & {
      email: string | null;
    })[],
    { ownerId: string; relatedId: string }[],
  ]
> {
  return Promise.all([
    db
      .select({
        id: actor.id,
        displayName: actor.displayName,
        title: actor.title,
        userId: actor.userId,
        email: user.email,
      })
      .from(actor)
      .leftJoin(user, eq(actor.userId, user.id))
      .where(
        and(eq(actor.organizationId, orgId), eq(actor.kind, 'human'), isNull(actor.archivedAt)),
      ),
    db
      .select({ ownerId: teamMember.actorId, relatedId: teamMember.teamId })
      .from(teamMember)
      .where(eq(teamMember.organizationId, orgId)),
  ]);
}
