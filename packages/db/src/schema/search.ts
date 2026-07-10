/**
 * `@docket/db` — workspace-wide semantic search read model.
 *
 * @remarks
 * These tables are projections, not sources of truth. Domain objects and the canonical
 * event log enqueue `search_index_job` rows; projectors materialize them into
 * `search_document` rows that preserve entity kind, family, route, facets, source
 * attribution, and visibility metadata for query-time permission filtering.
 */
import { sql } from 'drizzle-orm';
import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

import {
  searchDocumentFamily,
  searchDocumentKind,
  searchIndexJobOperation,
  searchIndexJobReason,
  searchIndexJobStatus,
  sourceSystem,
} from '../enums';
import { genId } from '../id';
import { user } from './auth';
import { organization } from './identity';

/** Opaque route metadata persisted with a search document. */
export type SearchRouteShape = Record<string, unknown>;
/** Opaque facet metadata persisted with a search document. */
export type SearchFacetShape = Record<string, unknown>;
/** Opaque visibility metadata persisted with a search document. */
export type SearchVisibilityShape = Record<string, unknown>;

/** Durable semantic search document, projected from source rows and query-filtered later. */
export const searchDocument = pgTable(
  'search_document',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').references(() => organization.id, {
      onDelete: 'cascade',
    }),
    userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }),
    kind: searchDocumentKind('kind').notNull(),
    family: searchDocumentFamily('family').notNull(),
    sourceTable: text('source_table').notNull(),
    entityId: text('entity_id').notNull(),
    subjectKind: text('subject_kind'),
    subjectId: text('subject_id'),
    sourceSystem: sourceSystem('source_system'),
    externalUrl: text('external_url'),
    title: text('title').notNull(),
    summary: text('summary'),
    body: text('body'),
    facet: jsonb('facet').$type<SearchFacetShape>().notNull().default({}),
    route: jsonb('route').$type<SearchRouteShape>().notNull(),
    visibility: jsonb('visibility').$type<SearchVisibilityShape>().notNull(),
    baseRank: integer('base_rank').notNull().default(0),
    occurredAt: timestamp('occurred_at'),
    sourceUpdatedAt: timestamp('source_updated_at'),
    indexedAt: timestamp('indexed_at').notNull().defaultNow(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    archivedAt: timestamp('archived_at'),
  },
  (t) => [
    index('search_document_org_family_rank_idx').on(
      t.organizationId,
      t.family,
      t.baseRank,
      t.updatedAt,
    ),
    index('search_document_org_kind_rank_idx').on(
      t.organizationId,
      t.kind,
      t.baseRank,
      t.updatedAt,
    ),
    index('search_document_user_family_idx').on(t.userId, t.family, t.updatedAt),
    uniqueIndex('search_document_source_uq').on(t.sourceTable, t.entityId),
    index('search_document_subject_idx').on(t.subjectKind, t.subjectId),
    index('search_document_facet_gin').using('gin', t.facet),
    index('search_document_text_gin').using(
      'gin',
      sql`(
        setweight(to_tsvector('simple', coalesce(${t.title}, '')), 'A') ||
        setweight(to_tsvector('simple', coalesce(${t.summary}, '')), 'B') ||
        setweight(to_tsvector('simple', coalesce(${t.body}, '')), 'C')
      )`,
    ),
  ],
);

/** Durable outbox for search indexing, repair, and event-log projection. */
export const searchIndexJob = pgTable(
  'search_index_job',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    organizationId: text('organization_id').references(() => organization.id, {
      onDelete: 'cascade',
    }),
    userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }),
    sourceTable: text('source_table').notNull(),
    entityId: text('entity_id').notNull(),
    operation: searchIndexJobOperation('operation').notNull(),
    reason: searchIndexJobReason('reason').notNull(),
    sourceEventId: text('source_event_id'),
    dedupeKey: text('dedupe_key').notNull(),
    status: searchIndexJobStatus('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    runAfter: timestamp('run_after').notNull().defaultNow(),
    lockedAt: timestamp('locked_at'),
    lastError: text('last_error'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    processedAt: timestamp('processed_at'),
  },
  (t) => [
    uniqueIndex('search_index_job_active_dedupe_uq')
      .on(t.dedupeKey)
      .where(sql`${t.status} in ('pending', 'processing')`),
    index('search_index_job_status_run_idx').on(t.status, t.runAfter, t.createdAt),
    index('search_index_job_source_idx').on(t.sourceTable, t.entityId),
  ],
);
