import type { Database } from '../../src/client';
import { expect, it, vi } from 'vitest';
import { migrateWithWorkTemplateCheckpoint } from '../../src/migrate-work-templates';
const mocks = vi.hoisted(() => ({
  archive: vi.fn(),
  identity: vi.fn(),
  blueprint: vi.fn(),
  dates: vi.fn(),
  sql: vi.fn(),
}));
vi.mock('node:fs', () => ({
  readFileSync: () =>
    JSON.stringify({
      entries: [
        { tag: '0152_work_template_identity_enforce', when: 1 },
        { tag: '0155_work_template_blueprints_enforce', when: 2 },
        { tag: '0160_schedule_invocation_heads_expand', when: 3 },
      ],
    }),
}));
vi.mock('../../src/migration-prefix', () => ({ withMigrationPrefix: async () => undefined }));
vi.mock('../../src/work-schedule-archive', () => ({ backfillWorkScheduleArchives: mocks.archive }));
vi.mock('../../src/work-template-backfill', () => ({
  backfillWorkTemplateIdentity: mocks.identity,
}));
vi.mock('../../src/work-template-blueprint-backfill', () => ({
  backfillWorkTemplateBlueprints: mocks.blueprint,
}));
vi.mock('../../src/retained-date-ownership-backfill', () => ({
  backfillRetainedDateOwnership: mocks.dates,
}));
it('runs resumable archival integrity at ordinary upgrade, reserving strict source equality for retirement', async () => {
  const query = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([{ createdAt: 3 }]),
  };
  const database = { select: vi.fn(() => query) } as unknown as Database;
  const options = { migrationsFolder: 'migrations', applySqlMigrations: mocks.sql };
  mocks.archive.mockResolvedValue({ revisions: 0, instances: 0, deferredRevisions: 0 });
  await migrateWithWorkTemplateCheckpoint(database, options);
  expect(mocks.archive).toHaveBeenCalledWith(database, { ...options, verification: 'checkpoint' });
});
