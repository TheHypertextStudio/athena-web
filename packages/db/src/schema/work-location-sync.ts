/** `@docket/db` — provider projection state for canonical work location. */
import type { WorkLocationProviderCapabilities } from '@docket/planning/work-location-contract';
import { sql } from 'drizzle-orm';
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import { genId } from '../id';
import { calendarConnection } from './calendar';
import { hub } from './identity';
import { workLocationAssertion, workPlace } from './work-location';

/** Account-aware provider vocabulary and native place identifiers for one saved place. */
export const workPlaceProviderMapping = pgTable(
  'work_place_provider_mapping',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    hubId: text('hub_id')
      .notNull()
      .references(() => hub.id, { onDelete: 'cascade' }),
    placeId: text('place_id').notNull(),
    connectionId: text('connection_id')
      .notNull()
      .references(() => calendarConnection.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    classification: text('classification').notNull(),
    providerPlaceId: text('provider_place_id'),
    metadata: jsonb('metadata').$type<Record<string, string>>().notNull().default({}),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex('work_place_provider_mapping_place_connection_uq').on(t.placeId, t.connectionId),
    index('work_place_provider_mapping_connection_idx').on(t.connectionId),
    foreignKey({
      columns: [t.hubId, t.placeId],
      foreignColumns: [workPlace.hubId, workPlace.id],
      name: 'work_place_provider_mapping_place_fk',
    }).onDelete('cascade'),
    check(
      'work_place_provider_mapping_classification_nonempty',
      sql`length(${t.classification}) > 0`,
    ),
  ],
);

/** Location-specific cursor, watch, capability, and health state for one linked account. */
export const workLocationSyncAccount = pgTable(
  'work_location_sync_account',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    hubId: text('hub_id')
      .notNull()
      .references(() => hub.id, { onDelete: 'cascade' }),
    connectionId: text('connection_id')
      .notNull()
      .references(() => calendarConnection.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    state: text('state').notNull().default('pending'),
    reason: text('reason'),
    capabilities: jsonb('capabilities').$type<WorkLocationProviderCapabilities>().notNull(),
    syncToken: text('sync_token'),
    watchChannelId: text('watch_channel_id'),
    watchResourceId: text('watch_resource_id'),
    watchToken: text('watch_token'),
    watchExpiresAt: timestamp('watch_expires_at'),
    bootstrapCompletedAt: timestamp('bootstrap_completed_at'),
    lastSucceededAt: timestamp('last_succeeded_at'),
    lastErrorCode: text('last_error_code'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex('work_location_sync_account_connection_uq').on(t.connectionId),
    index('work_location_sync_account_hub_state_idx').on(t.hubId, t.state),
    check(
      'work_location_sync_account_state_check',
      sql`${t.state} IN ('pending', 'healthy', 'retrying', 'unsupported', 'action_required')`,
    ),
  ],
);

/** Stable binding from one canonical series/occurrence to one provider event. */
export const workLocationExternalBinding = pgTable(
  'work_location_external_binding',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    hubId: text('hub_id')
      .notNull()
      .references(() => hub.id, { onDelete: 'cascade' }),
    assertionId: text('assertion_id')
      .notNull()
      .references(() => workLocationAssertion.id, { onDelete: 'cascade' }),
    exceptionDate: date('exception_date'),
    connectionId: text('connection_id')
      .notNull()
      .references(() => calendarConnection.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    externalEventId: text('external_event_id').notNull(),
    parentExternalEventId: text('parent_external_event_id'),
    occurrenceKey: text('occurrence_key'),
    externalEtag: text('external_etag'),
    remoteUpdatedAt: timestamp('remote_updated_at'),
    lastProjectedRevision: integer('last_projected_revision'),
    payloadHash: text('payload_hash'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex('work_location_external_binding_connection_event_uq').on(
      t.connectionId,
      t.externalEventId,
    ),
    index('work_location_external_binding_assertion_idx').on(t.assertionId),
    check(
      'work_location_external_binding_revision_positive',
      sql`${t.lastProjectedRevision} IS NULL OR ${t.lastProjectedRevision} > 0`,
    ),
  ],
);

/** Retryable local-first provider projection for one canonical assertion. */
export const workLocationWrite = pgTable(
  'work_location_write',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    hubId: text('hub_id')
      .notNull()
      .references(() => hub.id, { onDelete: 'cascade' }),
    assertionId: text('assertion_id')
      .notNull()
      .references(() => workLocationAssertion.id, { onDelete: 'cascade' }),
    exceptionDate: date('exception_date'),
    connectionId: text('connection_id')
      .notNull()
      .references(() => calendarConnection.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    operation: text('operation').notNull(),
    canonicalRevision: integer('canonical_revision').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    status: text('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at'),
    lastErrorCode: text('last_error_code'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('work_location_write_due_idx').on(t.status, t.nextAttemptAt),
    index('work_location_write_account_idx').on(t.connectionId, t.status),
    check(
      'work_location_write_operation_check',
      sql`${t.operation} IN ('create', 'update', 'delete')`,
    ),
    check(
      'work_location_write_status_check',
      sql`${t.status} IN ('pending', 'processing', 'applied', 'failed')`,
    ),
    check('work_location_write_revision_positive', sql`${t.canonicalRevision} > 0`),
    check('work_location_write_attempts_nonnegative', sql`${t.attempts} >= 0`),
  ],
);
