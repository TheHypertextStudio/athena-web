import { actor, grant, type Database } from '@docket/db';
import { one } from '../support/routes-harness';

/** Give a real process author the workspace contribution granted by these integration fixtures. */
export async function grantProcessAuthor(
  database: Database,
  organizationId: string,
  actorId: string,
): Promise<void> {
  await database.insert(grant).values({
    organizationId,
    subjectKind: 'actor',
    subjectId: actorId,
    resourceKind: 'organization',
    resourceId: organizationId,
    capabilities: ['contribute'],
    effect: 'allow',
    cascades: true,
  });
}

/** Register an actual author while allowing a later series to retain genuinely nullable attribution. */
export async function seedProcessAuthor(
  database: Database,
  organizationId: string,
): Promise<string> {
  const row = one(
    await database
      .insert(actor)
      .values({
        organizationId,
        kind: 'human',
        displayName: 'Process author',
      })
      .returning(),
  );
  await grantProcessAuthor(database, organizationId, row.id);
  return row.id;
}
