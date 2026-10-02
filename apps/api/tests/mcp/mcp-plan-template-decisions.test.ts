/** Template decisions on MCP plan confirmation. */
import type * as DbModule from '@docket/db';
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { assertDefined } from '@docket/test-utils';
import type { registerTools as RegisterTools } from '../../src/mcp/tools';
import { getMigratedDb } from '../support/db';
import { resetAuthMocks } from '../support/auth-mock';
import { body, closeCatalogClients, connectCatalog } from './mcp-catalog-harness';
import { seedMcpUpdateOrg } from './mcp-update-tool-fixtures';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let registerTools!: typeof RegisterTools;
beforeAll(async () => {
  schema = await getMigratedDb();
  db = schema.db;
  registerTools = (await import('../../src/mcp/tools')).registerTools;
});
afterEach(async () => {
  await closeCatalogClients();
  resetAuthMocks();
});

describe('plan template decisions', () => {
  it('requires template decisions on plan confirmation and refuses attribution without application', async () => {
    const seed = await seedMcpUpdateOrg(db, schema, ['view', 'contribute']);
    const [savedTemplate] = await db
      .insert(schema.template)
      .values({
        organizationId: seed.orgId,
        ownerActorId: seed.actorId,
        name: 'Event',
        targetType: 'project',
        scope: 'personal',
        payload: { targetType: 'project', description: '## Venue\n\n## Guests' },
      })
      .returning();
    const templateId = assertDefined(savedTemplate).id;
    const client = await connectCatalog(registerTools, seed.ctx);
    const started = body<{ planId: string }>(
      await client.callTool({ name: 'plan_start', arguments: { orgId: seed.orgId } }),
    );
    const ops = [
      {
        op: 'upsert_node',
        node: { ref: 'i', kind: 'initiative', fields: { title: 'Event strategy' } },
      },
      {
        op: 'upsert_node',
        node: { ref: 'p', kind: 'project', parentRef: 'i', fields: { title: 'Planned event' } },
      },
    ];
    expect(
      (
        await client.callTool({
          name: 'plan_draft',
          arguments: { planId: started.planId, revision: 0, ops },
        })
      ).isError,
    ).not.toBe(true);
    const commit = { planId: started.planId, refs: ['p'] };
    expect(body(await client.callTool({ name: 'plan_commit', arguments: commit }))).toMatchObject({
      code: 'template_selection_required',
    });
    expect(
      (
        await client.callTool({
          name: 'plan_draft',
          arguments: {
            planId: started.planId,
            revision: 1,
            ops: [
              {
                op: 'upsert_node',
                node: {
                  ref: 'p',
                  kind: 'project',
                  parentRef: 'i',
                  templateId,
                  fields: { title: 'Planned event' },
                },
              },
            ],
          },
        })
      ).isError,
    ).not.toBe(true);
    expect(body(await client.callTool({ name: 'plan_commit', arguments: commit }))).toMatchObject({
      code: 'template_application_required',
      body: '## Venue\n\n## Guests',
    });
    expect(
      (
        await client.callTool({
          name: 'plan_draft',
          arguments: {
            planId: started.planId,
            revision: 2,
            ops: [{ op: 'apply_template', ref: 'p', templateId }],
          },
        })
      ).isError,
    ).not.toBe(true);
    expect((await client.callTool({ name: 'plan_commit', arguments: commit })).isError).not.toBe(
      true,
    );
    const [saved] = await db
      .select()
      .from(schema.project)
      .where(eq(schema.project.name, 'Planned event'));
    expect(saved?.description).toBe('## Venue\n\n## Guests');
  });
});
