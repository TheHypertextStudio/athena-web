/** Program template application requires Manage and rejects an entire unauthorized forest. */
import type * as DbModule from '@docket/db';
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { assertDefined } from '@docket/test-utils';
import type { registerTools as RegisterTools } from '../../src/mcp/tools';
import { getMigratedDb } from '../support/db';
import { resetAuthMocks } from '../support/auth-mock';
import { closeCatalogClients, connectCatalog, errorText } from './mcp-catalog-harness';
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

describe('template-backed Program creation permissions', () => {
  it.each([false, true])(
    'denies a contributor without Manage and leaves no partial work, mixed forest=%s',
    async (mixed) => {
      const { db } = schema;
      const seed = await seedMcpUpdateOrg(db, schema, ['view', 'contribute']);
      const [template] = await db
        .insert(schema.template)
        .values({
          organizationId: seed.orgId,
          ownerActorId: seed.actorId,
          name: 'Operations',
          targetType: 'program',
          scope: 'personal',
          payload: { targetType: 'program', description: '## Routine' },
        })
        .returning();
      const client = await connectCatalog(registerTools, seed.ctx);
      const result = await client.callTool({
        name: 'organize',
        arguments: {
          orgId: seed.orgId,
          items: [
            ...(mixed
              ? [
                  {
                    ref: 'p',
                    kind: 'project',
                    title: 'Unwritten project',
                    withoutTemplateReason: 'Standalone project',
                  },
                ]
              : []),
            {
              ref: 'o',
              kind: 'program',
              title: 'Unwritten Program',
              template: assertDefined(template).id,
            },
          ],
        },
      });
      expect(result.isError).toBe(true);
      expect(errorText(result)).toMatch(/^forbidden:/);
      expect(
        await db.select().from(schema.program).where(eq(schema.program.organizationId, seed.orgId)),
      ).toHaveLength(0);
      expect(
        await db
          .select()
          .from(schema.project)
          .where(
            and(
              eq(schema.project.organizationId, seed.orgId),
              eq(schema.project.name, 'Unwritten project'),
            ),
          ),
      ).toHaveLength(0);
      expect(
        await db
          .select()
          .from(schema.changeSet)
          .where(eq(schema.changeSet.organizationId, seed.orgId)),
      ).toHaveLength(0);
    },
  );
});
