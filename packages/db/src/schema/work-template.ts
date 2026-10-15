import type { TemplateDraft } from '@docket/work/template-contract';
import type {
  WorkTemplateDefinition,
  WorkTemplateState,
} from '@docket/work/work-template-contract';
import type { EntityDisplayGlyph } from '@docket/work/entity-display-contract';
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  pgPolicy,
} from 'drizzle-orm/pg-core';

import { templateTargetType, viewScope } from '../enums';
import { genId } from '../id';
import { notBlank } from './constraints';
import { actor, auditColumns, organization, team } from './identity';

/** Canonical work-template definition, retaining the physical legacy table for compatible clients. */
export const template = pgTable(
  'template',
  {
    ...auditColumns(),
    targetType: templateTargetType('target_type').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    scope: viewScope('scope').notNull().default('personal'),
    ownerActorId: text('owner_actor_id').references(() => actor.id, { onDelete: 'set null' }),
    teamId: text('team_id').references(() => team.id, { onDelete: 'cascade' }),
    payload: jsonb('payload').$type<TemplateDraft>().notNull(),
    originWorkTypeId: text('origin_work_type_id'),
    originWorkTypeVersionId: text('origin_work_type_version_id'),
    isSeed: boolean('is_seed').notNull().default(false),
    isBase: boolean('is_base').notNull().default(false),
    publicationState: text('publication_state')
      .$type<WorkTemplateState | 'legacy_pending'>()
      .notNull()
      .default('draft'),
    icon: jsonb('icon').$type<EntityDisplayGlyph>(),
    draftRevision: integer('draft_revision').notNull().default(0),
    draftDefinition: jsonb('draft_definition')
      .$type<WorkTemplateDefinition>()
      .notNull()
      .default(sql`NULL`),
    latestPublishedVersionId: text('latest_published_version_id').references(
      (): AnyPgColumn => workTypeVersion.id,
    ),
  },
  (table) => [
    index('template_org_target_idx').on(table.organizationId, table.targetType),
    check(
      'template_copy_origin_pair',
      sql`(${table.originWorkTypeId} is null)=(${table.originWorkTypeVersionId} is null)`,
    ),
    uniqueIndex('work_type_id_org_unique').on(table.id, table.organizationId),
    uniqueIndex('work_type_base_unique')
      .on(table.organizationId, table.targetType)
      .where(sql`${table.isBase}`),
    check('work_type_revision_nonnegative', sql`${table.draftRevision} >= 0`),
    check(
      'work_type_state_valid',
      sql`${table.publicationState} in ('draft', 'published', 'archived')`,
    ),
    notBlank('template_name_not_blank', table.name),
  ],
);

/** Immutable published definition; no editable audit timestamp or archive state belongs here. */
export const workTypeVersion = pgTable(
  'work_type_version',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    workTypeId: text('work_type_id').notNull(),
    number: integer('number').notNull(),
    definition: jsonb('definition').$type<WorkTemplateDefinition>().notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }).notNull().defaultNow(),
    publishedByActorId: text('published_by_actor_id').references(() => actor.id, {
      onDelete: 'set null',
    }),
  },
  (table) => [
    uniqueIndex('work_type_version_id_org_unique').on(table.id, table.organizationId),
    uniqueIndex('work_type_version_number_unique').on(table.workTypeId, table.number),
    uniqueIndex('work_type_version_identity_unique').on(
      table.id,
      table.workTypeId,
      table.organizationId,
    ),
    foreignKey({
      name: 'work_type_version_tenant_fk',
      columns: [table.workTypeId, table.organizationId],
      foreignColumns: [template.id, template.organizationId],
    }).onDelete('cascade'),
    check('work_type_version_number_positive', sql`${table.number} > 0`),
    pgPolicy('work_type_version_tenant', {
      for: 'all',
      using: sql`${table.organizationId} = nullif(current_setting('docket.organization_id', true), '') and exists (select 1 from template definition where definition.id = ${table.workTypeId} and definition.scope = 'organization' and definition.publication_state in ('published', 'archived'))`,
      withCheck: sql`${table.organizationId} = nullif(current_setting('docket.organization_id', true), '')`,
    }),
  ],
).enableRLS();

/** Teams where a published template is offered; narrowing never makes its body private. */
export const workTypeTeam = pgTable(
  'work_type_team',
  {
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    workTypeId: text('work_type_id').notNull(),
    teamId: text('team_id').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.workTypeId, table.teamId] }),
    foreignKey({
      name: 'work_type_team_tenant_fk',
      columns: [table.teamId, table.organizationId],
      foreignColumns: [team.id, team.organizationId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'work_type_team_definition_fk',
      columns: [table.workTypeId, table.organizationId],
      foreignColumns: [template.id, template.organizationId],
    }).onDelete('cascade'),
    pgPolicy('work_type_team_tenant', {
      for: 'all',
      using: sql`${table.organizationId} = nullif(current_setting('docket.organization_id', true), '') and exists (select 1 from template definition where definition.id = ${table.workTypeId} and definition.scope = 'organization' and definition.publication_state in ('published', 'archived'))`,
      withCheck: sql`${table.organizationId} = nullif(current_setting('docket.organization_id', true), '')`,
    }),
  ],
).enableRLS();
