import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';
import type { McpIntegrationOut } from '@docket/connections/integration-contract';

import { appWithActor, getDb, seedOrg } from '../support/routes-harness';
import { assertDefined } from '@docket/test-utils';

let schema!: typeof DbModule;
let router: unknown;

beforeAll(async () => {
  schema = await getDb();
  router = (await import('../../src/routes/integrations-mcp')).default;
});

const JSON_HEADERS = { 'content-type': 'application/json' };

/** Parse one JSON response body. */
async function body<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

describe('remote MCP connector editing', () => {
  it('updates the user-facing name and tool prefix', async () => {
    const orgId = await seedOrg(schema.db, schema);
    const inserted = await schema.db
      .insert(schema.integration)
      .values({
        organizationId: orgId,
        provider: 'mcp',
        pattern: 'connector',
        roles: ['work'],
        status: 'connected',
        config: {
          url: 'https://example.com/mcp',
          label: 'Example',
          alias: 'example',
          authMode: 'none',
        },
      })
      .returning({ id: schema.integration.id });
    const id = inserted[0]?.id;
    if (!id) throw new Error('failed to seed MCP connector');
    const app = appWithActor(router, orgId, ['manage']);

    const response = await app.request(`/${id}`, {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({ label: 'Planning', alias: 'planning' }),
    });

    expect(response.status).toBe(200);
    expect(await body<McpIntegrationOut>(response)).toMatchObject({
      label: 'Planning',
      alias: 'planning',
    });
  });

  it('requires workspace management access', async () => {
    const orgId = await seedOrg(schema.db, schema);
    const app = appWithActor(router, orgId, ['view']);
    expect(
      (
        await app.request('/01ARZ3NDEKTSV4RRFFQ69G5FAV', {
          method: 'PATCH',
          headers: JSON_HEADERS,
          body: JSON.stringify({ label: 'Nope' }),
        })
      ).status,
    ).toBe(403);
  });

  it('is a no-op on the alias-uniqueness check when the PATCH does not touch alias', async () => {
    const orgId = await seedOrg(schema.db, schema);
    const inserted = await schema.db
      .insert(schema.integration)
      .values({
        organizationId: orgId,
        provider: 'mcp',
        pattern: 'connector',
        roles: ['work'],
        status: 'connected',
        config: {
          url: 'https://example.com/mcp',
          label: 'Example',
          alias: 'unchanged_alias',
          authMode: 'none',
        },
      })
      .returning({ id: schema.integration.id });
    const id = inserted[0]?.id;
    if (!id) throw new Error('failed to seed MCP connector');
    const app = appWithActor(router, orgId, ['manage']);

    const response = await app.request(`/${id}`, {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({ label: 'Renamed only' }),
    });

    expect(response.status).toBe(200);
    const out = await body<McpIntegrationOut>(response);
    expect(out.label).toBe('Renamed only');
    expect(out.alias).toBe('unchanged_alias');
  });

  it('rejects a PATCH alias that collides with a sibling connector in the same workspace', async () => {
    const orgId = await seedOrg(schema.db, schema);
    const seedRow = async (alias: string) =>
      assertDefined(
        (
          await schema.db
            .insert(schema.integration)
            .values({
              organizationId: orgId,
              provider: 'mcp',
              pattern: 'connector',
              roles: ['work'],
              status: 'connected',
              config: { url: 'https://example.com/mcp', label: 'X', alias, authMode: 'none' },
            })
            .returning({ id: schema.integration.id })
        )[0],
      ).id;
    const takenId = await seedRow('taken_alias');
    const movingId = await seedRow('movable_alias');
    const app = appWithActor(router, orgId, ['manage']);

    const response = await app.request(`/${movingId}`, {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({ alias: 'taken_alias' }),
    });

    expect(response.status).toBe(409);
    // The collision was rejected atomically — the sibling's alias (and this row's own) are
    // untouched.
    const rows = await schema.db
      .select({ id: schema.integration.id, config: schema.integration.config })
      .from(schema.integration)
      .where(eq(schema.integration.organizationId, orgId));
    const taken = rows.find((r) => r.id === takenId);
    const moving = rows.find((r) => r.id === movingId);
    expect((taken?.config as { alias?: string } | undefined)?.alias).toBe('taken_alias');
    expect((moving?.config as { alias?: string } | undefined)?.alias).toBe('movable_alias');
  });
});
