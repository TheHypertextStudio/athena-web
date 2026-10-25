import {
  preparePrivateIdentityNamespace,
  type PrivateIdentityNamespaceOptions,
} from './work-template-identity-namespace';
import {
  preparePrivateAliasReferences,
  type PrivateAliasReferenceOptions,
} from './work-template-alias-reference-checkpoint';
import {
  backfillScheduleHistoryImports,
  type ScheduleHistoryImportOptions,
} from './work-schedule-history-import';
import {
  backfillScheduleConversions,
  type ScheduleConversionOptions,
} from './work-schedule-conversion-prepare';
import {
  backfillInvocationRevisionAliases,
  type InvocationRevisionBackfillOptions,
} from './invocation-revision-backfill';
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
    ScheduleArchiveOptions,
    InvocationRevisionBackfillOptions,
    ScheduleHistoryImportOptions,
    ScheduleConversionOptions,
    PrivateIdentityNamespaceOptions,
    PrivateAliasReferenceOptions {
  readonly migrationsFolder: string;
  readonly applySqlMigrations: (folder: string) => Promise<void>;
}

async function prepareFinalCheckpoints(
  database: Database,
  options: WorkTemplateMigrationOptions,
  entries: readonly { readonly tag: string }[],
): Promise<void> {
  await backfillRetainedDateOwnership(database, options);
  const identityNamespace = entries.some(
    (entry) => entry.tag === '0179_private_definition_identity_namespace',
  );
  if (identityNamespace) {
    const namespace = await preparePrivateIdentityNamespace(database, options);
    if (!namespace.ready) {
      console.warn(
        `Private identity namespace deferred for ${namespace.deferred} source identities; canonical preparation remains closed until actual reservations resolve.`,
      );
      return;
    }
    if (namespace.deferred)
      console.warn(
        `Private identity classification deferred for ${namespace.deferred} heads; namespace readiness does not authorize those heads.`,
      );
  }
  if (entries.some((entry) => entry.tag === '0160_schedule_invocation_heads_expand')) {
    const progress = await backfillWorkScheduleArchives(database, {
      ...options,
      verification: 'checkpoint',
    });
    if (progress.deferredRevisions)
      console.warn(
        `Schedule source proof deferred for ${progress.deferredRevisions} revisions; legacy sources remain retained until explicit retirement verification.`,
      );
  }
  if (entries.some((entry) => entry.tag === '0165_invocation_revision_aliases'))
    await backfillInvocationRevisionAliases(database, options);
  if (entries.some((entry) => entry.tag === '0171_schedule_history_import_receipts'))
    await backfillScheduleHistoryImports(database, options);
  if (entries.some((entry) => entry.tag === '0175_schedule_conversion_preparation'))
    await backfillScheduleConversions(database, options);
  if (entries.some((entry) => entry.tag === '0180_private_definition_alias_references')) {
    const aliases = await preparePrivateAliasReferences(database, options);
    if (!aliases.enforced)
      console.warn(
        `Private alias references deferred: ${aliases.reason}; ${aliases.unresolvedHeads} heads, ${aliases.unresolvedRevisions} revisions, ${aliases.unresolvedSeries} series and ${aliases.unresolvedCalendars} calendar bindings remain explicitly source-dependent.`,
      );
  }
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
  await prepareFinalCheckpoints(database, options, journal.entries);
}
