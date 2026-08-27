/**
 * `@docket/db` — the Notion mirror island: Docket-designed databases inside a Notion workspace.
 *
 * @remarks
 * Two tables that together answer "which Notion database is each Docket entity kind projected
 * into, and which Notion page is each individual entity". They are deliberately **separate from
 * the provenance columns** already on `task` / `project` / `cycle`, for two reasons:
 *
 * 1. A single task can be linked *from* an existing Notion database (the connector in
 *    `notion-mapping.ts`) **and** projected *into* a Docket-designed one at the same time. Those
 *    are two different Notion pages, and `task.external_id` is one slot. Reusing it would make
 *    the two modes silently mutually exclusive.
 * 2. `initiative`, `program`, `team`, `milestone` and `actor` carry no provenance columns at all,
 *    and marking them `source = 'linked'` would be false — they are native Docket entities that
 *    happen to have a projection, not records that came from somewhere else.
 *
 * So projection is modelled as a side table keyed by `(integration, entity_type, entity_id)`,
 * which costs one join and keeps every existing invariant intact.
 *
 * @see `docs/engineering/specs/notion-sync.md`
 */
import type { NotionPropertyMap } from '@docket/connections/notion/mirror-contract';
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import { genId } from '../id';
import { integration } from './crosscutting';
import { auditColumns, organization } from './identity';

/**
 * The Docket entity kinds projectable into a Notion database.
 *
 * @remarks
 * Declared in this island rather than in `../enums`, following {@link
 * import('./publishing').publicationSubject}: a fresh `CREATE TYPE` in a new migration carries
 * none of the `ALTER TYPE … ADD VALUE`-then-use-in-the-same-transaction hazard (Postgres `55P04`)
 * that adding a value to a shared enum does. Must stay in agreement with `NotionMirrorEntity` in
 * `@docket/connections/notion/mirror-contract`; a boundary test enforces it.
 */
export const notionMirrorEntity = pgEnum('notion_mirror_entity', [
  'task',
  'project',
  'initiative',
  'program',
  'team',
  'cycle',
  'milestone',
  'label',
  'person',
]);

/**
 * One Docket-designed Notion database: the schema the user shaped, and where it landed.
 *
 * @remarks
 * Uses {@link auditColumns} rather than the manual columns {@link
 * import('./crosscutting').externalActor} uses, because unlike a pure sync-engine table this row
 * has a real human author — whoever shaped it in the table designer. The provisioning pass only
 * fills in the `external*` columns afterwards.
 *
 * `externalDatabaseId` being null is the honest "designed but not yet created in Notion" state.
 * A row here never implies anything exists on the Notion side; only `provisionedAt` does.
 */
export const notionMirrorDatabase = pgTable(
  'notion_mirror_database',
  {
    ...auditColumns(),
    integrationId: text('integration_id')
      .notNull()
      .references(() => integration.id, { onDelete: 'cascade' }),
    entityType: notionMirrorEntity('entity_type').notNull(),
    /** The database title in Notion. Defaults from the org vocabulary, then user-editable. */
    title: text('title').notNull(),
    /** Whether this entity is projected at all; a designed-but-off database is never created. */
    enabled: boolean('enabled').notNull().default(true),
    /** Notion's database id (null until provisioned). */
    externalDatabaseId: text('external_database_id'),
    /**
     * Notion's data source id — the collection rows actually live in (API version 2026-03-11).
     *
     * @remarks
     * Distinct from {@link notionMirrorDatabase.externalDatabaseId}: a database owns one or more
     * data sources, and queries, schemas and page parents are all data-source scoped. Every read
     * and write addresses this, never the database id.
     */
    externalDataSourceId: text('external_data_source_id'),
    externalUrl: text('external_url'),
    /**
     * The designed columns, keyed by Docket field key (see `NotionPropertyMap` in
     * `@docket/connections/notion/mirror-contract`).
     *
     * @remarks
     * Each binding addresses its Notion property by **id**, not title. Titles are user-chosen here
     * and freely renameable inside Notion; ids survive a rename. Binding by title would let a
     * rename on the Notion side silently sever the sync.
     */
    propertyMap: jsonb('property_map').$type<NotionPropertyMap>().notNull().default({}),
    /** Bumped when the designed shape changes, so the sync engine knows to re-`PATCH` the schema. */
    schemaVersion: integer('schema_version').notNull().default(1),
    /** When the database was actually created in Notion (null = designed only). */
    provisionedAt: timestamp('provisioned_at'),
    /** Set before create so a retry searches for an exact ownership marker before creating again. */
    provisioningStartedAt: timestamp('provisioning_started_at'),
    /** Last successful projection of Docket rows into this database. */
    lastPushedAt: timestamp('last_pushed_at'),
    /** Last successful read of Notion edits out of this database. */
    lastPulledAt: timestamp('last_pulled_at'),
    /** Rows currently projected, maintained by the projection pass. */
    rowCount: integer('row_count').notNull().default(0),
  },
  (t) => [
    index('notion_mirror_database_org_idx').on(t.organizationId),
    uniqueIndex('notion_mirror_database_entity_uq').on(t.integrationId, t.entityType),
  ],
);

/**
 * One durable wake-up and retry state for a Docket-designed Notion mirror.
 *
 * @remarks
 * Signals collapse into monotonically increasing generations. A worker captures the desired
 * generation before reconciling and advances only that value after a complete pass, so a write
 * arriving during the pass remains pending. The existing `sync_run` lease still serializes work;
 * this row records demand and health rather than introducing a second job system.
 */
export const notionMirrorState = pgTable(
  'notion_mirror_state',
  {
    integrationId: text('integration_id')
      .primaryKey()
      .references(() => integration.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    desiredGeneration: bigint('desired_generation', { mode: 'number' }).notNull().default(0),
    appliedGeneration: bigint('applied_generation', { mode: 'number' }).notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at'),
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
    lastAttemptAt: timestamp('last_attempt_at'),
    lastSuccessAt: timestamp('last_success_at'),
    lastErrorKind: text('last_error_kind'),
    lastError: text('last_error'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('notion_mirror_state_org_idx').on(t.organizationId),
    index('notion_mirror_state_due_idx').on(t.nextAttemptAt),
  ],
);

/**
 * One projected entity: the Notion page a single Docket record is mirrored to.
 *
 * @remarks
 * Written entirely by the sync engine, so it carries manual id/timestamp columns rather than
 * {@link auditColumns} — same rationale as {@link import('./crosscutting').externalActor}, whose
 * `createdBy` would presume a human author that does not exist.
 *
 * `entityId` is polymorphic and deliberately carries **no** foreign key: it addresses nine
 * different tables, and Postgres has no way to express that. Cleanup rides on
 * `organization_id`/`integration_id` cascades plus the projection pass, which tombstones a row
 * (`deletedAt`) once its Docket entity is archived.
 *
 * `externalUpdatedAt` versus `lastPushedAt` is the whole two-way protocol: a Notion edit is real
 * only when the page's `last_edited_time` is newer than `lastPushedAt`, which is what stops
 * Docket's own write from reading back as a remote change.
 */
export const notionMirrorRow = pgTable(
  'notion_mirror_row',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    integrationId: text('integration_id')
      .notNull()
      .references(() => integration.id, { onDelete: 'cascade' }),
    entityType: notionMirrorEntity('entity_type').notNull(),
    /** The Docket record's id. Polymorphic across nine tables, so no FK — see the remarks. */
    entityId: text('entity_id').notNull(),
    /** The Notion page this record is mirrored to; null is a durable pre-create intent. */
    externalPageId: text('external_page_id'),
    /** The page's `last_edited_time` as of the last sync — the remote-change anchor. */
    externalUpdatedAt: timestamp('external_updated_at'),
    /** When Docket last wrote this page — the echo guard. */
    lastPushedAt: timestamp('last_pushed_at'),
    /** Hash of the projected field values, so an unchanged record costs no Notion write. */
    contentHash: text('content_hash'),
    /** Per-field anchors make independent Docket and Notion edits merge without a record overwrite. */
    propertyAnchors: jsonb('property_anchors')
      .$type<Record<string, string>>()
      .notNull()
      .default({}),
    /** Hash of the full Notion Markdown body, separate from property projection. */
    bodyHash: text('body_hash'),
    /** A missing content capability or truncated response must never read as an empty body. */
    bodyState: text('body_state').notNull().default('complete'),
    /** Provider block ids Notion omitted from a truncated body response. */
    bodyUnknownBlockIds: jsonb('body_unknown_block_ids').$type<string[]>().notNull().default([]),
    /** Set when the Docket record is archived and its Notion page moved to the trash. */
    deletedAt: timestamp('deleted_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex('notion_mirror_row_entity_uq').on(t.integrationId, t.entityType, t.entityId),
    uniqueIndex('notion_mirror_row_page_uq').on(t.integrationId, t.externalPageId),
    index('notion_mirror_row_lookup_idx').on(t.organizationId, t.entityType, t.entityId),
  ],
);

/**
 * Per-page content and field anchors for a task linked from an existing Notion database.
 *
 * Linked tasks keep provider provenance on `task`; this table holds the richer Notion-specific
 * reconciliation state so generic connector columns do not become an untyped provider blob.
 */
export const notionLinkedPageState = pgTable(
  'notion_linked_page_state',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    integrationId: text('integration_id')
      .notNull()
      .references(() => integration.id, { onDelete: 'cascade' }),
    /** The linked task id. Kept polymorphism-free but without a circular schema dependency. */
    taskId: text('task_id').notNull(),
    externalPageId: text('external_page_id').notNull(),
    propertyAnchors: jsonb('property_anchors')
      .$type<Record<string, string>>()
      .notNull()
      .default({}),
    bodyHash: text('body_hash'),
    bodyState: text('body_state').notNull().default('complete'),
    bodyUnknownBlockIds: jsonb('body_unknown_block_ids').$type<string[]>().notNull().default([]),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex('notion_linked_page_state_page_uq').on(t.integrationId, t.externalPageId),
    uniqueIndex('notion_linked_page_state_task_uq').on(t.integrationId, t.taskId),
    index('notion_linked_page_state_org_idx').on(t.organizationId),
  ],
);
