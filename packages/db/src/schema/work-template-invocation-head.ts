import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { actor, auditColumns } from './identity';
import { blueprintInvocation } from './work-template-blueprint';

/** Private metadata-only authoring handle; its ID preserves a legacy definition alias when converted. */
export const invocationHead = pgTable(
  'work_template_invocation_head',
  {
    ...auditColumns(),
    ownerActorId: text('owner_actor_id').references(() => actor.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    description: text('description'),
    status: text('status').$type<'draft' | 'published' | 'archived'>().notNull().default('draft'),
    revision: integer('revision').notNull().default(1),
    canonicalAuthoringAt: timestamp('canonical_authoring_at', { withTimezone: true }),
    draftInvocationId: text('draft_invocation_id'),
    publishedInvocationId: text('published_invocation_id'),
  },
  (t) => {
    const visible = sql`docket_schedule_private_scope(${t.organizationId},NULL,${t.ownerActorId})`;
    return [
      uniqueIndex('invocation_head_identity_unique').on(t.id, t.organizationId),
      index('invocation_head_owner_idx').on(t.organizationId, t.ownerActorId, t.status),
      check('invocation_head_name', sql`length(btrim(${t.name}))>0`),
      check('invocation_head_revision', sql`${t.revision}>0`),
      check(
        'invocation_head_status',
        sql`${t.status} in('draft','published','archived') and (${t.status}<>'published' or ${t.publishedInvocationId} is not null)`,
      ),
      foreignKey({
        name: 'invocation_head_owner_tenant_fk',
        columns: [t.ownerActorId, t.organizationId],
        foreignColumns: [actor.id, actor.organizationId],
      }),
      ...(['draft', 'published'] as const).map((kind) =>
        foreignKey({
          name: `invocation_head_${kind}_tenant_fk`,
          columns: [
            kind === 'draft' ? t.draftInvocationId : t.publishedInvocationId,
            t.organizationId,
          ],
          foreignColumns: [blueprintInvocation.id, blueprintInvocation.organizationId],
        }).onDelete('restrict'),
      ),
      pgPolicy('invocation_head_private', { for: 'all', using: visible, withCheck: visible }),
    ];
  },
).enableRLS();
