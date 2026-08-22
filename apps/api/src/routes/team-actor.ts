/**
 * `@docket/api` — the team↔actor shadow, kept 1:1 in one place.
 *
 * @remarks
 * Every Team has exactly one `actor{kind:'team'}`, which is what lets a work object name a team as
 * its assignee, lead, or owner: `task.assignee_id`, `project.lead_id`, `initiative.owner_id` and
 * `program.owner_id` all reference `actor`, so a team becomes ownable with no new column on any
 * work table. `actor_team_kind_check` in the database makes the malformed shapes unrepresentable,
 * but a constraint only says the shape is legal — keeping the *lifecycle* aligned is this module's
 * job, and it exists so the three call sites cannot drift.
 *
 * The link is always `actor.team_id`. Migration `0068` happens to reuse each team's id for its
 * backfilled actor, because SQL there had no way to mint a ULID — that is a mechanism, not a
 * contract, and no caller may assume the two ids are equal.
 *
 * Every function takes an explicit transaction. A team row and its actor have to land or fail
 * together: a team with no actor cannot be assigned work, which is a silent, confusing failure
 * rather than a loud one.
 */
import type { db } from '@docket/db';
import { actor } from '@docket/db';
import { and, eq } from 'drizzle-orm';

/** The transaction handle every write here runs inside (the repo-wide convention). */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** What a new team's shadow actor needs to exist. */
export interface TeamActorInput {
  /** The tenant, copied from the team. */
  readonly organizationId: string;
  /** The team this actor *is* — not a team it belongs to. */
  readonly teamId: string;
  /** The team's display name, mirrored so pickers can render the actor without a join. */
  readonly name: string;
}

/**
 * Create the 1:1 shadow actor for a newly created team.
 *
 * @param tx - The transaction the team row was inserted in.
 * @param input - The new team's tenant, id, and display name.
 * @returns The new actor's id.
 *
 * @example
 * ```ts
 * await db.transaction(async (tx) => {
 *   const [row] = await tx.insert(team).values({ ... }).returning();
 *   await createTeamActor(tx, { organizationId: orgId, teamId: row.id, name: row.name });
 * });
 * ```
 */
export async function createTeamActor(tx: Tx, input: TeamActorInput): Promise<string> {
  const inserted = await tx
    .insert(actor)
    .values({
      organizationId: input.organizationId,
      kind: 'team',
      displayName: input.name,
      teamId: input.teamId,
    })
    .returning({ id: actor.id });
  const row = inserted[0];
  /* v8 ignore next -- @preserve defensive: insert always returns a row */
  if (!row) throw new Error('team actor insert returned no row');
  return row.id;
}

/**
 * Mirror a team's new name onto its shadow actor.
 *
 * @remarks
 * The actor carries its own `display_name` so an assignee chip can render without joining `team`.
 * That copy is why a rename has to be pushed here — otherwise the pickers keep offering the old
 * name and the two drift with no error to notice.
 *
 * @param tx - The transaction the team was renamed in.
 * @param teamId - The renamed team.
 * @param name - The team's new display name.
 */
export async function renameTeamActor(tx: Tx, teamId: string, name: string): Promise<void> {
  await tx.update(actor).set({ displayName: name }).where(eq(actor.teamId, teamId));
}

/**
 * Archive a team's shadow actor alongside the team itself.
 *
 * @remarks
 * Archiving a team is a soft delete, so its actor is soft-deleted too rather than removed: the
 * work it already owns keeps a resolvable owner, while the team stops being offered for new
 * assignments. Deleting the row instead would null out every `owner_id` pointing at it and quietly
 * erase who was accountable for past work.
 *
 * @param tx - The transaction the team was archived in.
 * @param teamId - The archived team.
 * @param archivedAt - The same timestamp stamped on the team, so the two agree exactly.
 */
export async function archiveTeamActor(tx: Tx, teamId: string, archivedAt: Date): Promise<void> {
  await tx.update(actor).set({ archivedAt }).where(eq(actor.teamId, teamId));
}

/**
 * Resolve a team's shadow actor id.
 *
 * @param tx - The transaction or database handle to read through.
 * @param organizationId - The tenant, so a team id from another org resolves to null.
 * @param teamId - The team whose actor is wanted.
 * @returns The actor id, or null when the team has none (a pre-`0068` row that never got one).
 */
export async function findTeamActorId(
  tx: Pick<Tx, 'select'>,
  organizationId: string,
  teamId: string,
): Promise<string | null> {
  const rows = await tx
    .select({ id: actor.id })
    .from(actor)
    .where(and(eq(actor.teamId, teamId), eq(actor.organizationId, organizationId)))
    .limit(1);
  return rows[0]?.id ?? null;
}
