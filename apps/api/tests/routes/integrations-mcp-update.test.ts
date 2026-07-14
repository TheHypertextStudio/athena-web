import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';
import type { McpIntegrationOut } from '@docket/types';

import { appWithActor, getDb, seedOrg } from '../support/routes-harness';

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
});
