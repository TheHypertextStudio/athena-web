/**
 * `@docket/api` — reading an entity's recorded change history.
 *
 * @remarks
 * The write side lives in `change-set.ts`; this is the read side the provenance endpoint uses. Every
 * lookup is entity-first and rides `change_set_entry_entity_idx`, joined to its change set for the
 * organization, origin, and authorizing actor.
 */
import { actor, changeSet, changeSetEntry, type ChangeOrigin, db } from '@docket/db';
import { and, asc, count, desc, eq, isNull, type SQL } from 'drizzle-orm';

/** One recorded change set that touched an entity. */
export interface ChangeSetStamp {
  /** The change-set id. */
  readonly id: string;
  /** Where the change came from, as stored. */
  readonly origin: ChangeOrigin;
  /** When the change set was recorded. */
  readonly at: Date;
  /** The member whose permissions the change ran under. */
  readonly actorId: string;
  /** That member's display name, when the actor still exists. */
  readonly actorName: string | null;
}

/** What the recorded change sets say about one entity. */
export interface EntityChangeHistory {
  /** The change set that created the entity, whether or not it was later undone. */
  readonly created: ChangeSetStamp | null;
  /** The most recent change set that has not been undone. */
  readonly latest: ChangeSetStamp | null;
  /** How many change sets that have not been undone touched the entity. */
  readonly count: number;
}

/** The columns every stamp reads. */
const STAMP_COLUMNS = {
  id: changeSet.id,
  origin: changeSet.origin,
  at: changeSet.createdAt,
  actorId: changeSet.actorId,
  actorName: actor.displayName,
};

/** Entries for one entity in one organization. */
function entityScope(orgId: string, kind: string, id: string): SQL | undefined {
  return and(
    eq(changeSetEntry.entityKind, kind),
    eq(changeSetEntry.entityId, id),
    eq(changeSet.organizationId, orgId),
  );
}

/** Select stamps for an entity's entries, narrowed by `where`. */
function selectStamps(where: SQL | undefined) {
  return db
    .select(STAMP_COLUMNS)
    .from(changeSetEntry)
    .innerJoin(changeSet, eq(changeSetEntry.changeSetId, changeSet.id))
    .leftJoin(actor, eq(changeSet.actorId, actor.id))
    .where(where);
}

/**
 * Read the change that created an entity, its latest live change, and how many live changes
 * touched it.
 *
 * @remarks
 * A change set that was undone no longer describes the entity, so it is left out of `latest` and
 * `count`. The creating change stays in `created` either way: the entity still came from it.
 *
 * @param orgId - The organization the entity belongs to.
 * @param kind - The recorded entity kind (`task`, `project`, `program`, `initiative`).
 * @param id - The entity id.
 * @returns the creating change, the latest live change, and the live change count.
 */
export async function changeHistoryOf(
  orgId: string,
  kind: string,
  id: string,
): Promise<EntityChangeHistory> {
  const scope = entityScope(orgId, kind, id);
  const live = and(scope, isNull(changeSet.undoneAt));
  const [createdRows, latestRows, countRows] = await Promise.all([
    selectStamps(and(scope, eq(changeSetEntry.op, 'create')))
      .orderBy(asc(changeSet.createdAt), asc(changeSet.id))
      .limit(1),
    selectStamps(live).orderBy(desc(changeSet.createdAt), desc(changeSet.id)).limit(1),
    db
      .select({ n: count() })
      .from(changeSetEntry)
      .innerJoin(changeSet, eq(changeSetEntry.changeSetId, changeSet.id))
      .where(live),
  ]);
  return {
    created: createdRows[0] ?? null,
    latest: latestRows[0] ?? null,
    count: countRows[0]?.n ?? 0,
  };
}
