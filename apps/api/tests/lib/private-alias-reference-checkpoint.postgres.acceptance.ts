import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import * as schema from '@docket/db';
import { exercisePrivateAliasReferenceCheckpoint } from '../support/private-alias-reference-checkpoint-fixture';

vi.mock('../support/db', () => ({ getMigratedDb: async () => schema }));
beforeAll(() => {
  expect(process.env['DATABASE_URL']).toMatch(/^postgres(?:ql)?:/);
});
afterAll(async () => {
  await schema.closeDb();
});
it('retries genuine retained registration and enforces complete aliases only after both source identities are proved on PostgreSQL', async () => {
  await exercisePrivateAliasReferenceCheckpoint(schema.db, async () => {
    await schema.backfillWorkScheduleArchives(schema.db, {
      verification: 'checkpoint',
      batchSize: 1,
    });
    await schema.backfillInvocationRevisionAliases(schema.db, { batchSize: 1 });
  });
});
