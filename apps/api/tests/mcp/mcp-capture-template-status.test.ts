/** Capture uses the same published starting status and terminal timestamps as other creators. */
import type * as DbModule from '@docket/db';
import { WorkTemplateCreate } from '@docket/work/work-template-contract';
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { registerTools as RegisterTools } from '../../src/mcp/tools';
import { resetAuthMocks } from '../support/auth-mock';
import { getMigratedDb } from '../support/db';
import { body, closeCatalogClients, connectCatalog } from './mcp-catalog-harness';
import { seedMcpUpdateOrg } from './mcp-update-tool-fixtures';

let schema!: typeof DbModule;
let registerTools!: typeof RegisterTools;
beforeAll(async () => {
  schema = await getMigratedDb();
  registerTools = (await import('../../src/mcp/tools')).registerTools;
});
afterEach(async () => {
  await closeCatalogClients();
  resetAuthMocks();
});

describe('capture published starting status', () => {
  it.each(['started', 'completed', 'canceled'] as const)(
    'captures into the selected %s status with matching timestamps',
    async (category) => {
      const seed = await seedMcpUpdateOrg(schema.db, schema, ['view', 'contribute']);
      const [status] = await schema.db
        .select()
        .from(schema.workStatus)
        .where(
          and(
            eq(schema.workStatus.organizationId, seed.orgId),
            eq(schema.workStatus.entityType, 'task'),
            eq(schema.workStatus.category, category),
          ),
        )
        .limit(1);
      if (!status) throw new Error('Expected seeded task status');
      const { createWorkTemplate } = await import('../../src/lib/templates/service');
      const template = await createWorkTemplate(
        { orgId: seed.orgId, actorId: seed.actorId },
        WorkTemplateCreate.parse({
          targetType: 'task',
          scope: 'organization',
          definition: {
            name: `Start ${category}`,
            defaultStatusKey: status.key,
            payload: { targetType: 'task', description: '## Captured outline' },
          },
        }),
        { publish: true },
      );
      const client = await connectCatalog(registerTools, seed.ctx);
      const result = await client.callTool({
        name: 'capture',
        arguments: { orgId: seed.orgId, text: `Captured ${category}`, workTypeId: template.id },
      });
      expect(result.isError, JSON.stringify(result)).not.toBe(true);
      const id = body<{ items: { id: string }[] }>(result).items[0]?.id ?? '';
      const [row] = await schema.db.select().from(schema.task).where(eq(schema.task.id, id));
      expect(row).toMatchObject({
        state: status.key,
        statusId: status.id,
        workTypeId: template.id,
        workTypeVersionId: template.latestPublishedVersionId,
      });
      if (category === 'completed') expect(row?.completedAt).toBeInstanceOf(Date);
      else expect(row?.completedAt).toBeNull();
      if (category === 'canceled') expect(row?.canceledAt).toBeInstanceOf(Date);
      else expect(row?.canceledAt).toBeNull();
    },
  );
});
