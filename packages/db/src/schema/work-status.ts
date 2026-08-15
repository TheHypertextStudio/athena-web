/**
 * `@docket/db` — workspace-defined work statuses.
 *
 * @remarks
 * A workspace names its own statuses for each kind of work it tracks: Tasks, Projects, Programs,
 * and Initiatives. Every status declares one of the five canonical categories
 * ({@link workStatusCategory}), and that category — never the key a workspace happened to
 * choose — is what a status glyph, a cross-team comparison, a progress calculation, and every
 * integration mapping read.
 *
 * **A team may keep its own Task statuses.** A row with a null `team_id` belongs to the workspace
 * set. A row with a `team_id` belongs to that team's forked set, and a team that has any such rows
 * resolves to them instead of the workspace's. Only Tasks may be forked, because only Tasks are
 * team-scoped; the check constraint makes a team-scoped Project status unrepresentable.
 *
 * **Deleting a status requires remapping the work on it**, which is what the `ON DELETE RESTRICT`
 * on each referencing table buys. There is no soft delete here: an archived status would keep its
 * work while vanishing from every picker, which is worse than either alternative, so
 * `archived_at` is constrained to stay null.
 */
import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';

import { workStatusCategory, workStatusEntity } from '../enums';
import { notBlank } from './constraints';
import { auditColumns, team } from './identity';

/** One status in a workspace's (or a forked team's) set for one kind of work. */
export const workStatus = pgTable(
  'work_status',
  {
    ...auditColumns(),
    entityType: workStatusEntity('entity_type').notNull(),
    /** The owning team when this belongs to a forked Task set; null for the workspace set. */
    teamId: text('team_id').references(() => team.id, { onDelete: 'cascade' }),
    /**
     * Stable identifier within the set, mirrored onto the work carrying this status.
     *
     * @remarks
     * Assigned by the server from the name at creation and never rewritten by a rename, because
     * it is also what saved-view predicates, automation-rule parameters, and connector mappings
     * store. Renaming a status moves `name`; `key` stays put.
     */
    key: text('key').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    category: workStatusCategory('category').notNull(),
    /** Sort order among the statuses sharing this category; board order is category, then this. */
    position: integer('position').notNull(),
    /** Whether new work of this kind starts here. Exactly one per set. */
    isDefault: boolean('is_default').notNull().default(false),
  },
  (t) => [
    index('work_status_org_idx').on(t.organizationId),
    // The composite-FK target. A referencing table points at (id, key, organization_id) so the
    // key column it already stores is provably the referenced status's key, and so a status from
    // another tenant cannot be referenced at all. Postgres accepts a non-partial unique index as
    // an FK target (the `agent_session_id_org_uq` precedent in `./agents`).
    uniqueIndex('work_status_id_key_org_uq').on(t.id, t.key, t.organizationId),
    // Keys are unique within one set. The workspace set and a forked team's set are different
    // sets, so both may hold a `done` — hence two partial uniques rather than one.
    uniqueIndex('work_status_ws_key_uq')
      .on(t.organizationId, t.entityType, t.key)
      .where(sql`${t.teamId} is null`),
    uniqueIndex('work_status_team_key_uq')
      .on(t.teamId, t.entityType, t.key)
      .where(sql`${t.teamId} is not null`),
    // At most one default per set, enforced where it can be, so "where does new work land" is
    // never ambiguous.
    uniqueIndex('work_status_ws_default_uq')
      .on(t.organizationId, t.entityType)
      .where(sql`${t.teamId} is null and ${t.isDefault}`),
    uniqueIndex('work_status_team_default_uq')
      .on(t.teamId, t.entityType)
      .where(sql`${t.teamId} is not null and ${t.isDefault}`),
    index('work_status_set_idx').on(t.organizationId, t.entityType, t.teamId, t.position),
    // Only Tasks are team-scoped, so only a Task status can belong to a team.
    check('work_status_team_scope', sql`${t.teamId} is null or ${t.entityType} = 'task'`),
    // See the module remarks: a status is deleted with an explicit remap, never archived.
    check('work_status_never_archived', sql`${t.archivedAt} is null`),
    check('work_status_position_nonneg', sql`${t.position} >= 0`),
    notBlank('work_status_key_not_blank', t.key),
    notBlank('work_status_name_not_blank', t.name),
  ],
);
