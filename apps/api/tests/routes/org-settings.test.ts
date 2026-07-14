import { beforeAll, describe, expect, it } from 'vitest';

import type { OrgOut } from '@docket/types';
import { eq } from 'drizzle-orm';

import {
  addMember,
  appWithSession,
  fakeSession,
  getDb,
  seedOrg,
  seedUserWithHub,
} from '../support/routes-harness';

let orgsRouter: unknown;

beforeAll(async () => {
  orgsRouter = (await import('../../src/routes/orgs')).default;
});

const JSON_HEADERS = { 'content-type': 'application/json' };

/** Parse a JSON response body as the requested contract type. */
async function body<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
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
      .where(eq(schema.role.id, actorRows[0]!.roleId!));
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
      .where(eq(schema.role.id, actorRows[0]!.roleId!));
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
    const stored = await (await import('../../src/container'))
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
