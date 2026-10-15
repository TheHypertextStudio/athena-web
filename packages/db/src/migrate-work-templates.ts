import { backfillWorkScheduleArchives, type ScheduleArchiveOptions } from './work-schedule-archive';
import {
  backfillRetainedDateOwnership,
  type RetainedDateBackfillOptions,
} from './retained-date-ownership-backfill';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { gte } from 'drizzle-orm';
import { bigint, pgSchema } from 'drizzle-orm/pg-core';

import type { Database } from './client';
import {
  backfillWorkTemplateBlueprints,
  type BlueprintBackfillOptions,
} from './work-template-blueprint-backfill';
import { withMigrationPrefix } from './migration-prefix';
import {
  backfillWorkTemplateIdentity,
  type WorkTemplateBackfillOptions,
} from './work-template-backfill';

const migrationJournal = pgSchema('drizzle').table('__drizzle_migrations', {
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
});

/** SQL migration boundary around the resumable work-template data checkpoint. */
export interface WorkTemplateMigrationOptions
  extends
    WorkTemplateBackfillOptions,
    BlueprintBackfillOptions,
    RetainedDateBackfillOptions,
    ScheduleArchiveOptions {
  readonly migrationsFolder: string;
  readonly applySqlMigrations: (folder: string) => Promise<void>;
}

/** Apply expansion, committed data batches, and enforcement through the standard SQL migrator. */
export async function migrateWithWorkTemplateCheckpoint(
  database: Database,
  options: WorkTemplateMigrationOptions,
): Promise<void> {
  await withMigrationPrefix(
    options.migrationsFolder,
    '0151_work_template_identity_expand',
    options.applySqlMigrations,
  );
  const journal = JSON.parse(
    readFileSync(join(options.migrationsFolder, 'meta/_journal.json'), 'utf8'),
  ) as {
    entries: { tag: string; when: number }[];
  };
  const enforcement = journal.entries.find(
    (entry) => entry.tag === '0152_work_template_identity_enforce',
  );
  if (!enforcement) throw new Error('Work-template enforcement checkpoint is missing.');
  // The normal migrator has ensured its journal exists. Its committed timestamp is authoritative.
  const applied = await database
    .select({ createdAt: migrationJournal.createdAt })
    .from(migrationJournal)
    .where(gte(migrationJournal.createdAt, enforcement.when))
    .limit(1);
  if (applied.length === 0) await backfillWorkTemplateIdentity(database, options);
  await withMigrationPrefix(
    options.migrationsFolder,
    '0153_process_task_template_identity',
    options.applySqlMigrations,
  );
  await withMigrationPrefix(
    options.migrationsFolder,
    '0154_work_template_blueprints_expand',
    options.applySqlMigrations,
  );
  const blueprintEnforcement = journal.entries.find(
    (entry) => entry.tag === '0155_work_template_blueprints_enforce',
  );
  if (!blueprintEnforcement) throw new Error('Blueprint enforcement checkpoint is missing.');
  const blueprintApplied = await database
    .select({ createdAt: migrationJournal.createdAt })
    .from(migrationJournal)
    .where(gte(migrationJournal.createdAt, blueprintEnforcement.when))
    .limit(1);
  if (blueprintApplied.length === 0) await backfillWorkTemplateBlueprints(database, options);
  await options.applySqlMigrations(options.migrationsFolder);
  await backfillRetainedDateOwnership(database, options);
  if (journal.entries.some((entry) => entry.tag === '0160_schedule_invocation_heads_expand')) {
    const progress = await backfillWorkScheduleArchives(database, {
      ...options,
      verification: 'checkpoint',
    });
    if (progress.deferredRevisions)
      console.warn(
        `Schedule source proof deferred for ${progress.deferredRevisions} revisions; legacy sources remain retained until explicit retirement verification.`,
      );
  }
}
