/** Project snapshot retries retain one private publication through response and image-work failures. */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type * as DbModule from '@docket/db';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { AppEnv } from '../../src/context';
import type { ProcessDefinitionDetailOut } from '../../src/contracts/recurrence';
import * as receipts from '../../src/lib/idempotency';
import * as templates from '../../src/lib/templates/service';
import processDefinitions from '../../src/routes/process-definitions';
import {
  appWithAuthenticatedActor,
  getDb,
  seedProject,
  seedTask,
  seedTaskAccessOrg,
} from '../support/routes-harness';

let schema: typeof DbModule;
beforeAll(async () => {
  schema = await getDb();
});
afterEach(() => {
  vi.restoreAllMocks();
});

async function fixture() {
  const org = await seedTaskAccessOrg(schema.db, schema);
  const bases = await schema.seedBaseWorkTemplates(schema.db, org.orgId, org.humanActorId);
  const projectType = bases.get('project');
  const taskType = bases.get('task');
  if (!projectType || !taskType) throw new Error('Missing base work types');
  const project = await seedProject(schema.db, schema, org.statusId, {
    organizationId: org.orgId,
    teamId: org.teamId,
    name: 'Weekly report',
    ...projectType,
    createdBy: org.humanActorId,
  });
  await seedTask(schema.db, schema, org.statusId, {
    organizationId: org.orgId,
    teamId: org.teamId,
    projectId: project.id,
    title: 'Write report',
    ...taskType,
    state: 'todo',
    createdBy: org.humanActorId,
  });
  const base = `/v1/orgs/${org.orgId}/process-definitions`;
  const router = new Hono<AppEnv>();
  router.use('*', receipts.idempotency);
  router.route(base, processDefinitions);
  const app = await appWithAuthenticatedActor(
    schema.db,
    schema,
    router,
    org.orgId,
    ['contribute'],
    org.humanActorId,
  );
  const input = { projectId: project.id, name: 'Reports', creationMode: 'all_at_once' };
  const request = (key: string, data: unknown = input) =>
    app.request(`${base}/from-project`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
      body: JSON.stringify(data),
    });
  return { org, project, base, app, router, input, request };
}

async function definitions(organizationId: string) {
  return schema.db
    .select()
    .from(schema.processDefinition)
    .where(eq(schema.processDefinition.organizationId, organizationId));
}

describe('project snapshot creation receipts', () => {
  it('replays a lost response without capturing changed source or duplicating the publication', async () => {
    const f = await fixture();
    const first = await f.request('lost-snapshot-response');
    expect(first.status).toBe(200);
    const result = (await first.json()) as ProcessDefinitionDetailOut;
    await schema.db
      .update(schema.project)
      .set({ name: 'Changed after the first snapshot' })
      .where(eq(schema.project.id, f.project.id));
    const retry = await f.request('lost-snapshot-response');
    expect(retry.status).toBe(200);
    expect(retry.headers.get('Idempotency-Replayed')).toBe('true');
    expect(await retry.json()).toEqual(result);
    expect(await definitions(f.org.orgId)).toHaveLength(1);
    const changed = await f.request('lost-snapshot-response', {
      ...f.input,
      creationMode: 'when_ready',
    });
    expect(changed.status).toBe(422);
  });

  it('retains the publication after post-commit image reconciliation fails', async () => {
    const f = await fixture();
    const reconcile = vi
      .spyOn(templates, 'reconcileTemplateCreationEffects')
      .mockRejectedValueOnce(new Error('Images unavailable after publication committed'));
    expect((await f.request('recover-snapshot-images')).status).toBe(500);
    const stored = await definitions(f.org.orgId);
    expect(stored).toHaveLength(1);
    const retry = await f.request('recover-snapshot-images');
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({ id: stored[0]?.id });
    expect(await definitions(f.org.orgId)).toHaveLength(1);
    expect(reconcile).toHaveBeenCalledTimes(2);
    expect(reconcile.mock.calls[1]?.[0]).toEqual(
      expect.arrayContaining([...(reconcile.mock.calls[0]?.[0] ?? [])]),
    );
  });

  it('rolls back publication when its receipt cannot commit', async () => {
    const f = await fixture();
    vi.spyOn(receipts, 'completeIdempotencyInTransaction').mockRejectedValueOnce(
      new Error('Receipt persistence failed'),
    );
    expect((await f.request('atomic-snapshot')).status).toBe(500);
    expect(await definitions(f.org.orgId)).toHaveLength(0);
    expect((await f.request('atomic-snapshot')).status).toBe(200);
    expect(await definitions(f.org.orgId)).toHaveLength(1);
  });

  it('rechecks the complete source tree before replaying a saved snapshot', async () => {
    const f = await fixture();
    expect((await f.request('source-revoked')).status).toBe(200);
    await schema.db
      .update(schema.project)
      .set({ archivedAt: new Date() })
      .where(eq(schema.project.id, f.project.id));
    const retry = await f.request('source-revoked');
    expect(retry.status).toBe(404);
    expect(retry.headers.get('Idempotency-Replayed')).toBeNull();
  });

  it('rechecks the resulting private definition before returning its receipt', async () => {
    const f = await fixture();
    const first = await f.request('definition-revoked');
    expect(first.status).toBe(200);
    const result = (await first.json()) as ProcessDefinitionDetailOut;
    await schema.db
      .update(schema.processDefinition)
      .set({ archivedAt: new Date() })
      .where(eq(schema.processDefinition.id, result.id));
    expect((await f.request('definition-revoked')).status).toBe(404);
  });

  it('keeps simultaneous snapshot retries on one publication', async () => {
    const f = await fixture();
    const responses = await Promise.all([
      f.request('concurrent-snapshot'),
      f.request('concurrent-snapshot'),
    ]);
    expect(responses.some((response) => response.status === 200)).toBe(true);
    expect(responses.every((response) => response.status === 200 || response.status === 409)).toBe(
      true,
    );
    expect((await f.request('concurrent-snapshot')).status).toBe(200);
    expect(await definitions(f.org.orgId)).toHaveLength(1);
  });
});
