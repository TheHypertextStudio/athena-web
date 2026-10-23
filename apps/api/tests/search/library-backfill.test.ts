import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { backfillSearchIndex, repairSearchIndex } from '../../src/search/backfill';
import { processSearchIndexJobs } from '../../src/search/process-jobs';
import { getDb, one, seedBaseOrg } from '../support/routes-harness';

describe('Library search recovery', () => {
  it.each([backfillSearchIndex, repairSearchIndex])(
    'includes linked Library resources in the default source scan (%#)',
    async (scan) => {
      const schema = await getDb();
      const { db } = schema;
      const { orgId } = await seedBaseOrg(db, schema);
      const resource = one(
        await db
          .insert(schema.externalResource)
          .values({
            organizationId: orgId,
            provider: 'web',
            canonicalKey: 'web:https://example.com/default-library-scan',
            canonicalUrl: 'https://example.com/default-library-scan',
            resourceType: 'page',
          })
          .returning(),
      );
      await scan();
      await processSearchIndexJobs({ limit: 100 });
      const documents = await db
        .select()
        .from(schema.searchDocument)
        .where(eq(schema.searchDocument.entityId, resource.id));
      expect(documents).toMatchObject([{ kind: 'external_resource', organizationId: orgId }]);
    },
  );
});
