import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import type * as ResolveModule from '../../../src/lib/identity/resolve-external-entity';
import { getDb, seedBaseOrg } from '../../support/routes-harness';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let externalEntityKey!: typeof ResolveModule.externalEntityKey;
let isAssociableKind!: typeof ResolveModule.isAssociableKind;
let resolveExternalEntities!: typeof ResolveModule.resolveExternalEntities;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  const mod = await import('../../../src/lib/identity/resolve-external-entity');
  externalEntityKey = mod.externalEntityKey;
  isAssociableKind = mod.isAssociableKind;
  resolveExternalEntities = mod.resolveExternalEntities;
});

/** Insert a bare `linear` connector integration for the org; returns its id. */
async function seedIntegration(orgId: string, actorId: string): Promise<string> {
  const [row] = await db
    .insert(schema.integration)
    .values({
      organizationId: orgId,
      provider: 'linear',
      pattern: 'connector',
      roles: ['work'],
      createdBy: actorId,
    })
    .returning({ id: schema.integration.id });
  return row!.id;
}

/** Insert a task mirrored from an integration, the shape association actually matches on. */
async function seedLinkedTask(
  orgId: string,
  teamId: string,
  integrationId: string,
  externalId: string,
): Promise<string> {
  const [row] = await db
    .insert(schema.task)
    .values({
      organizationId: orgId,
      teamId,
      title: `Mirrored ${externalId}`,
      state: 'todo',
      visibility: 'public',
      source: 'linked',
      sourceIntegrationId: integrationId,
      externalId,
    })
    .returning({ id: schema.task.id });
  return row!.id;
}

describe('resolveExternalEntities', () => {
  it('resolves a mirrored task by its external id', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const integrationId = await seedIntegration(orgId, humanActorId);
    const taskId = await seedLinkedTask(orgId, teamId, integrationId, 'LIN-1');

    const resolved = await resolveExternalEntities({ organizationId: orgId, integrationId }, [
      { kind: 'work_item', externalId: 'LIN-1' },
    ]);

    expect(resolved.get(externalEntityKey('work_item', 'LIN-1'))).toBe(taskId);
  });

  it('will not resolve a mirror belonging to a different integration', async () => {
    // Two integrations in one org can carry colliding external ids (two Linear workspaces both
    // numbering issues from 1). Matching on external id alone would cross-wire them.
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const mine = await seedIntegration(orgId, humanActorId);
    const theirs = await seedIntegration(orgId, humanActorId);
    await seedLinkedTask(orgId, teamId, theirs, 'SHARED-1');

    const resolved = await resolveExternalEntities({ organizationId: orgId, integrationId: mine }, [
      { kind: 'work_item', externalId: 'SHARED-1' },
    ]);

    expect(resolved.has(externalEntityKey('work_item', 'SHARED-1'))).toBe(false);
  });

  it('will not resolve a native task that happens to carry an external id', async () => {
    // Only `source='linked'` rows are mirrors. A native task is Docket's own, and claiming a
    // provider event is "about" it would attribute foreign activity to local work.
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const integrationId = await seedIntegration(orgId, humanActorId);
    await db.insert(schema.task).values({
      organizationId: orgId,
      teamId,
      title: 'Native task',
      state: 'todo',
      visibility: 'public',
      source: 'native',
      sourceIntegrationId: integrationId,
      externalId: 'NATIVE-1',
    });

    const resolved = await resolveExternalEntities({ organizationId: orgId, integrationId }, [
      { kind: 'work_item', externalId: 'NATIVE-1' },
    ]);

    expect(resolved.has(externalEntityKey('work_item', 'NATIVE-1'))).toBe(false);
  });

  it('resolves several kinds in one call', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const integrationId = await seedIntegration(orgId, humanActorId);
    const taskId = await seedLinkedTask(orgId, teamId, integrationId, 'LIN-7');
    const [projectRow] = await db
      .insert(schema.project)
      .values({
        organizationId: orgId,
        name: 'Mirrored project',
        source: 'linked',
        sourceIntegrationId: integrationId,
        externalId: 'PRJ-7',
      })
      .returning({ id: schema.project.id });

    const resolved = await resolveExternalEntities({ organizationId: orgId, integrationId }, [
      { kind: 'work_item', externalId: 'LIN-7' },
      { kind: 'project', externalId: 'PRJ-7' },
    ]);

    expect(resolved.get(externalEntityKey('work_item', 'LIN-7'))).toBe(taskId);
    expect(resolved.get(externalEntityKey('project', 'PRJ-7'))).toBe(projectRow!.id);
  });

  it('omits an unresolved reference rather than mapping it to an empty value', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const integrationId = await seedIntegration(orgId, humanActorId);

    const resolved = await resolveExternalEntities({ organizationId: orgId, integrationId }, [
      { kind: 'work_item', externalId: 'NEVER-MIRRORED' },
    ]);

    expect(resolved.size).toBe(0);
  });
});

describe('isAssociableKind', () => {
  it('separates kinds Docket can mirror from kinds it cannot', () => {
    // This is what bounds the re-association sweep: an associable kind that missed is worth
    // retrying, and a non-associable one can never resolve no matter how often it is re-checked.
    expect(isAssociableKind('work_item')).toBe(true);
    expect(isAssociableKind('project')).toBe(true);
    expect(isAssociableKind('cycle')).toBe(true);
    expect(isAssociableKind('thread')).toBe(false);
    expect(isAssociableKind('message')).toBe(false);
    expect(isAssociableKind('person')).toBe(false);
  });
});
