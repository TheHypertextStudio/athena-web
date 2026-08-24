import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import type * as DbModule from '@docket/db';

import { getDb, seedBaseOrg } from '../support/routes-harness';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
});

describe('change-set recording', () => {
  it('namespaces client command ids by organization and actor', async () => {
    const { objectCommandChangeSetId } = await import('../../src/mcp/change-set');
    const first = objectCommandChangeSetId('org_one', 'actor_one', 'shared-command');

    expect(first).toBe(objectCommandChangeSetId('org_one', 'actor_one', 'shared-command'));
    expect(first).not.toBe(objectCommandChangeSetId('org_two', 'actor_one', 'shared-command'));
    expect(first).not.toBe(objectCommandChangeSetId('org_one', 'actor_two', 'shared-command'));
    expect(first).not.toBe('shared-command');
  });

  it('chunks a large MCP-compatible relation audit below database bind limits', async () => {
    const seeded = await seedBaseOrg(db, schema);
    const { recordChangeSet } = await import('../../src/mcp/change-set');
    const changeSetId = await recordChangeSet({
      orgId: seeded.orgId,
      actorId: seeded.humanActorId,
      origin: { tool: 'chunk-test' },
      summary: 'Record a large relation audit',
      changes: Array.from({ length: 12_000 }, (_, index) => ({
        kind: 'project_has_label' as const,
        from: `project_${Math.floor(index / 20)}`,
        to: `label_${index}`,
        linked: true,
      })),
    });
    if (!changeSetId) throw new Error('change set was not recorded');
    expect(
      await db
        .select({ id: schema.changeSetEntry.entityId })
        .from(schema.changeSetEntry)
        .where(eq(schema.changeSetEntry.changeSetId, changeSetId)),
    ).toHaveLength(12_000);
  });
});
