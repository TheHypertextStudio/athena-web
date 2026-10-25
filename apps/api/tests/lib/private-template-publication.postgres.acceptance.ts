import { afterAll, beforeAll, expect, it } from 'vitest';
import * as schema from '@docket/db';
import { eq, inArray, sql } from 'drizzle-orm';
import { assertDefined } from '@docket/test-utils';
import { WorkTemplateCreate } from '@docket/work/work-template-contract';
import { createWorkTemplateInTransaction } from '../../src/lib/templates/creation';
import { appendPublication } from '../../src/lib/templates/persistence';
import { loadCreationActor } from '../../src/lib/work-creation/context';
import { rawResultRows } from '../../src/lib/raw-result';
import { seedPrivatePublicationActor } from '../support/private-publication-fixture';
import {
  initializePrivateRuntimePostgres,
  withSourceDeniedPrivateActor,
  type PrivateRuntimeActor,
} from '../support/private-definition-postgres-fixture';

beforeAll(initializePrivateRuntimePostgres);
afterAll(async () => {
  await schema.closeDb();
});
it('publishes the current authors own authorized first structural version without needing an existing published pointer', async () => {
  const f = await seedPrivatePublicationActor(schema.db, schema);
  await withSourceDeniedPrivateActor(f, (database) =>
    database.transaction(async (tx) => {
      const caller = await loadCreationActor(tx, f.orgId, f.humanActorId);
      const draft = await createWorkTemplateInTransaction(
        tx,
        caller,
        WorkTemplateCreate.parse({
          targetType: 'project',
          scope: 'organization',
          offeredTeamIds: [f.teamId],
          definition: {
            name: 'Actual structural draft',
            payload: { targetType: 'project', name: 'Project' },
            blueprint: {
              steps: [
                {
                  key: 'child',
                  kind: 'task',
                  parentStepKey: null,
                  sort: 0,
                  template: null,
                  fields: { title: 'Actual reusable child' },
                  teamRule: 'creation_team',
                  actorRule: 'unassigned',
                  cycleRule: 'none',
                  dates: {},
                  optional: { enabled: false, selectedByDefault: true },
                },
              ],
              dependencies: [],
            },
          },
        }),
      );
      expect(
        rawResultRows(
          await tx.execute(
            sql`select docket_template_author(${f.orgId},${f.humanActorId}) as author,docket_copy_definition_view(${f.orgId},${draft.row.id},${f.humanActorId}) as own_draft_view,docket_template_publication_visible(${f.orgId},${draft.row.id}) as public_publication`,
          ),
        ),
      ).toEqual([{ author: true, own_draft_view: true, public_publication: false }]);
      const published = await appendPublication(tx, draft.row, f.humanActorId);
      expect(published.latestPublishedVersionId).not.toBeNull();
      expect(
        await tx
          .select()
          .from(schema.blueprintStep)
          .where(
            eq(schema.blueprintStep.versionId, assertDefined(published.latestPublishedVersionId)),
          ),
      ).toHaveLength(1);
      expect(
        await tx
          .select()
          .from(schema.workTypeTeam)
          .where(eq(schema.workTypeTeam.workTypeId, published.id)),
      ).toMatchObject([{ teamId: f.teamId }]);
    }),
  );
});

async function reader(
  f: PrivateRuntimeActor,
  capability: 'view' | 'contribute',
): Promise<PrivateRuntimeActor> {
  const actor = assertDefined(
    (
      await schema.db
        .insert(schema.actor)
        .values({ organizationId: f.orgId, kind: 'human', displayName: 'Publication reader' })
        .returning()
    )[0],
  );
  await schema.db.insert(schema.grant).values({
    organizationId: f.orgId,
    subjectKind: 'actor',
    subjectId: actor.id,
    resourceKind: 'organization',
    resourceId: f.orgId,
    capabilities: [capability],
    effect: 'allow',
    cascades: true,
  });
  return { ...f, humanActorId: actor.id };
}
async function stagedVersion(
  f: PrivateRuntimeActor,
  scope: 'personal' | 'team' | 'organization',
): Promise<string> {
  const draft = await withSourceDeniedPrivateActor(f, (database) =>
    database.transaction(async (tx) =>
      createWorkTemplateInTransaction(
        tx,
        await loadCreationActor(tx, f.orgId, f.humanActorId),
        WorkTemplateCreate.parse({
          targetType: 'project',
          scope,
          ...(scope === 'team' ? { teamId: f.teamId } : {}),
          definition: {
            name: 'Private staged version',
            payload: { targetType: 'project', name: 'Private Project' },
          },
        }),
      ),
    ),
  );
  const version = assertDefined(
    (
      await schema.db
        .insert(schema.workTypeVersion)
        .values({
          organizationId: f.orgId,
          workTypeId: draft.row.id,
          number: 1,
          definition: draft.row.draftDefinition,
          publishedByActorId: f.humanActorId,
        })
        .returning()
    )[0],
  );
  return version.id;
}
async function readableVersions(f: PrivateRuntimeActor, ids: readonly string[]): Promise<string[]> {
  return withSourceDeniedPrivateActor(f, async (database) => {
    const rows = await database
      .select({ id: schema.workTypeVersion.id })
      .from(schema.workTypeVersion)
      .where(inArray(schema.workTypeVersion.id, ids));
    return rows.map((row) => row.id).filter((id) => ids.includes(id));
  });
}
it('keeps staged personal/draft/team versions scoped to their current authorized author or team member and preserves foreign-tenant denial', async () => {
  const f = await seedPrivatePublicationActor(schema.db, schema),
    member = await reader(f, 'contribute'),
    nonmember = await reader(f, 'contribute');
  await schema.db.insert(schema.teamMember).values([
    { organizationId: f.orgId, teamId: f.teamId, actorId: f.humanActorId },
    { organizationId: f.orgId, teamId: f.teamId, actorId: member.humanActorId },
  ]);
  const personal = await stagedVersion(f, 'personal'),
    team = await stagedVersion(f, 'team'),
    draft = await stagedVersion(f, 'organization');
  expect((await readableVersions(f, [personal, team, draft])).sort()).toEqual(
    [personal, team, draft].sort(),
  );
  expect(await readableVersions(member, [personal, team, draft])).toEqual([team]);
  expect(await readableVersions(nonmember, [personal, team, draft])).toEqual([]);
  const foreign = await seedPrivatePublicationActor(schema.db, schema),
    foreignPrivate = await stagedVersion(foreign, 'personal');
  expect(await readableVersions(f, [foreignPrivate])).toEqual([]);
});
it('still allows a current ordinary viewer to read an actual published workspace version', async () => {
  const f = await seedPrivatePublicationActor(schema.db, schema),
    viewer = await reader(f, 'view');
  const published = await withSourceDeniedPrivateActor(f, (database) =>
    database.transaction(async (tx) =>
      createWorkTemplateInTransaction(
        tx,
        await loadCreationActor(tx, f.orgId, f.humanActorId),
        WorkTemplateCreate.parse({
          targetType: 'project',
          scope: 'organization',
          definition: {
            name: 'Public reusable version',
            payload: { targetType: 'project', name: 'Reusable Project' },
          },
        }),
        { publish: true },
      ),
    ),
  );
  const id = assertDefined(published.row.latestPublishedVersionId);
  expect(await readableVersions(viewer, [id])).toEqual([id]);
});
