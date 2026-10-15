/** Frozen 0151 SQL projections: historical replay must not depend on the live application schema. */
import type { EntityDisplayGlyph } from '@docket/work/entity-display-contract';
import type { TemplateDraft, TemplateTargetType } from '@docket/work/template-contract';
import type { WorkTemplateDefinition } from '@docket/work/work-template-contract';
import { boolean, integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/** Workspace identity available at the expansion checkpoint. */
export const organization = pgTable('organization', { id: text('id').notNull() });

/** Only definition columns read or inserted by the historical checkpoint; no runtime update hooks. */
export const template = pgTable('template', {
  id: text('id').notNull(),
  organizationId: text('organization_id').notNull(),
  createdBy: text('created_by'),
  archivedAt: timestamp('archived_at'),
  targetType: text('target_type').$type<TemplateTargetType>().notNull(),
  name: text('name').notNull(),
  description: text('description'),
  scope: text('scope').$type<'personal' | 'team' | 'organization'>().notNull(),
  payload: jsonb('payload').$type<TemplateDraft>().notNull(),
  isBase: boolean('is_base').notNull().default(false),
  publicationState: text('publication_state').notNull(),
  icon: jsonb('icon').$type<EntityDisplayGlyph>(),
  draftDefinition: jsonb('draft_definition').$type<WorkTemplateDefinition>(),
  latestPublishedVersionId: text('latest_published_version_id'),
});

/** Publication insert columns fixed at 0151, with IDs supplied by the application generator. */
export const workTypeVersion = pgTable('work_type_version', {
  id: text('id').notNull(),
  organizationId: text('organization_id').notNull(),
  workTypeId: text('work_type_id').notNull(),
  number: integer('number').notNull(),
  definition: jsonb('definition').$type<WorkTemplateDefinition>().notNull(),
  publishedByActorId: text('published_by_actor_id'),
});

function identityColumns() {
  return {
    id: text('id').notNull(),
    organizationId: text('organization_id').notNull(),
    workTypeId: text('work_type_id'),
    workTypeVersionId: text('work_type_version_id'),
    workTypeAssignedAt: timestamp('work_type_assigned_at', { withTimezone: true }),
    workTypeAssignmentSource: text('work_type_assignment_source'),
  };
}

/** Historical work associations omit audit fields so backfill cannot change authored timestamps. */
export const initiative = pgTable('initiative', identityColumns());
/** Historical Program association columns. */
export const program = pgTable('program', identityColumns());
/** Historical Project association columns. */
export const project = pgTable('project', identityColumns());
/** Historical Task association and retained starting-draft provenance. */
export const task = pgTable('task', { ...identityColumns(), templateId: text('template_id') });
