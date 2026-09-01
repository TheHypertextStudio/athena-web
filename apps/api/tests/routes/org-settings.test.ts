import { Hono } from 'hono';
import { beforeAll, describe, expect, it } from 'vitest';

import type { OrgOut } from '../../src/contracts/organization';
import { eq } from 'drizzle-orm';

import type { AppEnv, AuthSession } from '../../src/context';
import {
  addMember,
  appWithSession,
  clearDocketPro,
  fakeSession,
  getDb,
  grantDocketPro,
  one,
  seedOrg,
  seedUserWithHub,
} from '../support/routes-harness';
import { assertDefined } from '@docket/test-utils';

let orgsRouter: unknown;

beforeAll(async () => {
  orgsRouter = (await import('../../src/routes/orgs')).default;
});

const JSON_HEADERS = { 'content-type': 'application/json' };

/** Parse a JSON response body as the requested contract type. */
async function body<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

/** Mount the organization router at its production API path. */
function orgsApiApp(session: AuthSession) {
  const router = new Hono<AppEnv>().route('/v1/orgs', orgsRouter as never);
  return appWithSession(router, session);
}

describe('workspace general settings', () => {
  it('lets a manager edit basic workspace attributes and clear optional values', async () => {
    const schema = await getDb();
    const userId = await seedUserWithHub(schema.db, schema, 'WorkspaceManager');
    const orgId = await seedOrg(schema.db, schema);
    const actorId = await addMember(schema.db, schema, orgId, userId, 'owner');
    const actorRows = await schema.db
      .select({ roleId: schema.actor.roleId })
      .from(schema.actor)
      .where(eq(schema.actor.id, actorId));
    await schema.db
      .update(schema.role)
      .set({ capabilities: ['manage'] })
      .where(eq(schema.role.id, assertDefined(assertDefined(actorRows[0]).roleId)));
    const app = appWithSession(orgsRouter, fakeSession(userId));

    const updatedResponse = await app.request(`/${orgId}`, {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        name: 'Operations',
        purpose: 'Keep every workstream moving.',
        slug: `operations-${Math.random().toString(36).slice(2, 8)}`,
        avatar: 'https://example.com/logo.png',
        vocabulary: 'agency',
      }),
    });
    expect(updatedResponse.status).toBe(200);
    expect(await body<OrgOut>(updatedResponse)).toMatchObject({
      name: 'Operations',
      purpose: 'Keep every workstream moving.',
      avatar: 'https://example.com/logo.png',
      vocabulary: { preset: 'agency' },
    });

    const clearedResponse = await app.request(`/${orgId}`, {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({ purpose: null, avatar: null }),
    });
    expect(clearedResponse.status).toBe(200);
    expect(await body<OrgOut>(clearedResponse)).toMatchObject({ purpose: null, avatar: null });
  });

  it('moves a selected logo into managed storage and rejects an empty update', async () => {
    const schema = await getDb();
    const userId = await seedUserWithHub(schema.db, schema, 'WorkspaceLogoManager');
    const orgId = await seedOrg(schema.db, schema);
    const actorId = await addMember(schema.db, schema, orgId, userId, 'owner');
    const actorRows = await schema.db
      .select({ roleId: schema.actor.roleId })
      .from(schema.actor)
      .where(eq(schema.actor.id, actorId));
    await schema.db
      .update(schema.role)
      .set({ capabilities: ['manage'] })
      .where(eq(schema.role.id, assertDefined(assertDefined(actorRows[0]).roleId)));
    const app = appWithSession(orgsRouter, fakeSession(userId));

    const empty = await app.request(`/${orgId}`, {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({}),
    });
    expect(empty.status).toBe(422);

    const selected = 'data:image/png;base64,aGVsbG8=';
    const response = await app.request(`/${orgId}`, {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({ avatar: selected }),
    });
    expect(response.status).toBe(200);
    const stored = await (
      await import('../../src/container')
    )
      .getContainer()
      .blob.get(`settings/workspace/${orgId}`);
    expect(new TextDecoder().decode(stored ?? new Uint8Array())).toBe('hello');
  });

  it('rejects edits without workspace management access', async () => {
    const schema = await getDb();
    const userId = await seedUserWithHub(schema.db, schema, 'WorkspaceViewer');
    const orgId = await seedOrg(schema.db, schema);
    await addMember(schema.db, schema, orgId, userId, 'member');
    const app = appWithSession(orgsRouter, fakeSession(userId));

    expect(
      (
        await app.request(`/${orgId}`, {
          method: 'PATCH',
          headers: JSON_HEADERS,
          body: JSON.stringify({ name: 'Unauthorized rename' }),
        })
      ).status,
    ).toBe(403);
  });
});

describe('separately mounted paid integration routes', () => {
  it('keeps the Notion mirror behind Docket Pro and reaches its database handler', async () => {
    const schema = await getDb();
    const userId = await seedUserWithHub(schema.db, schema, 'NotionProductBoundary');
    const app = orgsApiApp(fakeSession(userId));
    const created = await app.request('/v1/orgs', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ name: 'Paid Notion surface' }),
    });
    expect(created.status).toBe(201);
    const { organization, ownerActorId } = await body<{
      organization: { id: string };
      ownerActorId: string;
    }>(created);
    await clearDocketPro(schema.db, schema, organization.id);
    const notion = one(
      await schema.db
        .insert(schema.integration)
        .values({
          organizationId: organization.id,
          provider: 'notion',
          pattern: 'connector',
          status: 'connected',
          createdBy: ownerActorId,
        })
        .returning({ id: schema.integration.id }),
    );
    const path = `/v1/orgs/${organization.id}/integrations/${notion.id}/notion/databases`;

    expect((await app.request(path)).status).toBe(402);

    await grantDocketPro(schema.db, schema, organization.id);
    const databases = await app.request(path);
    expect(databases.status).toBe(200);
    expect(await body<{ items: unknown[] }>(databases)).toMatchObject({
      items: expect.any(Array),
    });
  });

  it('keeps the Linear Agent installer behind Docket Pro and reaches its handler', async () => {
    const schema = await getDb();
    const userId = await seedUserWithHub(schema.db, schema, 'LinearAgentProductBoundary');
    const app = orgsApiApp(fakeSession(userId));
    const created = await app.request('/v1/orgs', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ name: 'Paid Linear Agent surface' }),
    });
    expect(created.status).toBe(201);
    const { organization } = await body<{ organization: { id: string } }>(created);
    await clearDocketPro(schema.db, schema, organization.id);
    const path = `/v1/orgs/${organization.id}/integrations/linear-agent/install`;

    expect((await app.request(path)).status).toBe(402);

    await grantDocketPro(schema.db, schema, organization.id);
    expect((await app.request(path)).status).toBe(409);
  });
});
