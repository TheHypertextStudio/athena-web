import { resolve } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { WorkTemplateDefinition } from '@docket/work/work-template-contract';
import { assertDefined } from '@docket/test-utils';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { fullSchema, type Database } from '../../src/client';
import {
  actor,
  initiative,
  organization,
  program,
  project,
  task,
  team,
  template,
  workTypeTeam,
  workTypeVersion,
} from '../../src/schema';
import {
  seedWorkspaceStatuses,
  statusLookupKey,
  type SeededStatuses,
} from '../../src/seed-statuses';

let client: PGlite;
let database: Database;
let orgId: string;
let otherOrgId: string;
let teamId: string;
let statuses: SeededStatuses;
type Kind = 'initiative' | 'program' | 'project' | 'task';

beforeAll(async () => {
  client = new PGlite('memory://');
  const connection = drizzle(client, { schema: fullSchema });
  await migrate(connection, { migrationsFolder: resolve(import.meta.dirname, '../../drizzle') });
  database = connection;
  orgId = assertDefined(
    (
      await database
        .insert(organization)
        .values({ name: 'Templates', slug: 'templates' })
        .returning()
    )[0],
  ).id;
  otherOrgId = assertDefined(
    (
      await database
        .insert(organization)
        .values({ name: 'Other', slug: 'other-templates' })
        .returning()
    )[0],
  ).id;
  teamId = assertDefined(
    (
      await database
        .insert(team)
        .values({ organizationId: orgId, name: 'Core', key: 'CORE' })
        .returning()
    )[0],
  ).id;
  statuses = await seedWorkspaceStatuses(database, orgId);
  await seedWorkspaceStatuses(database, otherOrgId);
});

afterAll(async () => {
  await client.close();
});

/** Insert through the same database boundary indirect creators use, omitting template identity. */
async function createWork(
  kind: Kind,
  identity: { workTypeId?: string; workTypeVersionId?: string } = {},
) {
  const values = { organizationId: orgId, ...identity };
  const status = (key: string): string => assertDefined(statuses.get(statusLookupKey(kind, key)));
  switch (kind) {
    case 'initiative':
      return assertDefined(
        (
          await database
            .insert(initiative)
            .values({ ...values, name: 'Community', statusId: status('active') })
            .returning()
        )[0],
      );
    case 'program':
      return assertDefined(
        (
          await database
            .insert(program)
            .values({ ...values, name: 'Dinners', statusId: status('active') })
            .returning()
        )[0],
      );
    case 'project':
      return assertDefined(
        (
          await database
            .insert(project)
            .values({ ...values, name: 'October dinner', statusId: status('planned') })
            .returning()
        )[0],
      );
    case 'task':
      return assertDefined(
        (
          await database
            .insert(task)
            .values({
              ...values,
              title: 'Book the venue',
              teamId,
              state: 'backlog',
              statusId: status('backlog'),
            })
            .returning()
        )[0],
      );
  }
}

/** Publish a non-base definition for direct-storage constraint tests. */
async function publishedTemplate(
  workspaceId: string,
  kind: Kind = 'project',
  publishedByActorId?: string,
) {
  return database.transaction(async (tx) => {
    const definition = WorkTemplateDefinition.parse({
      name: 'Event',
      payload: { targetType: kind },
    });
    const created = assertDefined(
      (
        await tx
          .insert(template)
          .values({
            organizationId: workspaceId,
            targetType: kind,
            name: definition.name,
            payload: definition.payload,
            scope: 'organization',
            publicationState: 'draft',
            draftDefinition: definition,
          })
          .returning()
      )[0],
    );
    const version = assertDefined(
      (
        await tx
          .insert(workTypeVersion)
          .values({
            organizationId: workspaceId,
            workTypeId: created.id,
            number: 1,
            definition,
            publishedByActorId,
          })
          .returning()
      )[0],
    );
    await tx
      .update(template)
      .set({ publicationState: 'published', latestPublishedVersionId: version.id })
      .where(eq(template.id, created.id));
    return { template: created, version };
  });
}

describe('required work-template storage identity', () => {
  it('provisions four bases and assigns their published version to indirect creation', async () => {
    const bases = await database.select().from(template).where(eq(template.organizationId, orgId));
    expect(bases.filter((row) => row.isBase)).toHaveLength(4);
    for (const kind of ['initiative', 'program', 'project', 'task'] as const) {
      const row = await createWork(kind);
      const base = assertDefined(bases.find((entry) => entry.isBase && entry.targetType === kind));
      expect(row.workTypeId).toBe(base.id);
      expect(row.workTypeVersionId).toBe(base.latestPublishedVersionId);
      expect(row.workTypeAssignmentSource).toBe('created');
    }
  });

  it('refuses foreign workspace, wrong-kind, and mismatched version assignments', async () => {
    const foreign = await publishedTemplate(otherOrgId);
    const wrongKind = await publishedTemplate(orgId, 'task');
    const event = await publishedTemplate(orgId);
    for (const identity of [
      { workTypeId: foreign.template.id, workTypeVersionId: foreign.version.id },
      { workTypeId: wrongKind.template.id, workTypeVersionId: wrongKind.version.id },
      { workTypeId: event.template.id, workTypeVersionId: wrongKind.version.id },
    ]) {
      await expect(createWork('project', identity)).rejects.toMatchObject({
        cause: { constraint: 'work_template_identity' },
      });
    }
  });

  it('refuses changes to a published snapshot', async () => {
    const event = await publishedTemplate(orgId);
    await expect(
      database
        .update(workTypeVersion)
        .set({ definition: { ...event.version.definition, name: 'Rewritten history' } })
        .where(eq(workTypeVersion.id, event.version.id)),
    ).rejects.toMatchObject({ cause: { constraint: 'work_template_version_immutable' } });
  });

  it('cannot delete published history by deleting its unused definition', async () => {
    const event = await publishedTemplate(orgId);
    await expect(
      database.delete(template).where(eq(template.id, event.template.id)),
    ).rejects.toMatchObject({ cause: { constraint: 'work_template_version_immutable' } });
    expect(
      await database.select().from(workTypeVersion).where(eq(workTypeVersion.id, event.version.id)),
    ).toHaveLength(1);
  });

  it('retains immutable content when actor deletion anonymizes publication credit', async () => {
    const publisher = assertDefined(
      (
        await database
          .insert(actor)
          .values({
            organizationId: orgId,
            kind: 'human',
            displayName: 'Publisher',
          })
          .returning()
      )[0],
    );
    const event = await publishedTemplate(orgId, 'project', publisher.id);
    await database.delete(actor).where(eq(actor.id, publisher.id));
    const retained = assertDefined(
      (
        await database
          .select()
          .from(workTypeVersion)
          .where(eq(workTypeVersion.id, event.version.id))
      )[0],
    );
    expect(retained.publishedByActorId).toBeNull();
    expect(retained.definition).toEqual(event.version.definition);
    expect(retained.publishedAt).toEqual(event.version.publishedAt);
  });

  it('preserves archived-template work while refusing new assignments to it', async () => {
    const event = await publishedTemplate(orgId);
    const identity = { workTypeId: event.template.id, workTypeVersionId: event.version.id };
    const existing = await createWork('project', identity);
    await database
      .update(template)
      .set({ publicationState: 'archived', archivedAt: new Date() })
      .where(eq(template.id, event.template.id));
    await expect(
      database.update(project).set({ name: 'Retained dinner' }).where(eq(project.id, existing.id)),
    ).resolves.toBeDefined();
    await expect(createWork('project', identity)).rejects.toMatchObject({
      cause: { constraint: 'work_template_identity' },
    });
  });

  it('cannot archive or delete a base template', async () => {
    const bases = await database.select().from(template).where(eq(template.organizationId, orgId));
    const base = assertDefined(bases.find((row) => row.isBase));
    await expect(
      database
        .update(template)
        .set({ publicationState: 'archived' })
        .where(eq(template.id, base.id)),
    ).rejects.toMatchObject({ cause: { constraint: 'work_template_base_required' } });
    await expect(database.delete(template).where(eq(template.id, base.id))).rejects.toMatchObject({
      cause: { constraint: 'work_template_base_required' },
    });
  });

  it('uses the destination base when existing work moves across workspace boundaries', async () => {
    const event = await publishedTemplate(orgId);
    const existing = await createWork('project', {
      workTypeId: event.template.id,
      workTypeVersionId: event.version.id,
    });
    const otherStatuses = await seedWorkspaceStatuses(database, otherOrgId);
    const moved = assertDefined(
      (
        await database
          .update(project)
          .set({
            organizationId: otherOrgId,
            statusId: assertDefined(otherStatuses.get(statusLookupKey('project', 'planned'))),
          })
          .where(eq(project.id, existing.id))
          .returning()
      )[0],
    );
    const destination = assertDefined(
      (await database.select().from(template).where(eq(template.id, moved.workTypeId)))[0],
    );
    expect(destination.organizationId).toBe(otherOrgId);
    expect(destination.isBase).toBe(true);
    expect(moved.workTypeAssignmentSource).toBe('changed');
  });

  it('cannot narrow a template to a team in another workspace', async () => {
    const event = await publishedTemplate(orgId);
    const foreignTeam = assertDefined(
      (
        await database
          .insert(team)
          .values({ organizationId: otherOrgId, name: 'Elsewhere', key: 'ELSE' })
          .returning()
      )[0],
    );
    await expect(
      database
        .insert(workTypeTeam)
        .values({ organizationId: orgId, workTypeId: event.template.id, teamId: foreignTeam.id }),
    ).rejects.toMatchObject({ cause: { constraint: 'work_type_team_tenant_fk' } });
  });

  it('allows authorized workspace purging to remove its bases and published history', async () => {
    const disposable = assertDefined(
      (
        await database
          .insert(organization)
          .values({ name: 'Disposable', slug: 'disposable-templates' })
          .returning()
      )[0],
    );
    await seedWorkspaceStatuses(database, disposable.id);
    await publishedTemplate(disposable.id);
    await expect(
      database.delete(organization).where(eq(organization.id, disposable.id)),
    ).resolves.toBeDefined();
    expect(
      await database
        .select()
        .from(workTypeVersion)
        .where(eq(workTypeVersion.organizationId, disposable.id)),
    ).toEqual([]);
  });
});
