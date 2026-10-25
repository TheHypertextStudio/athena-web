import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  integer,
  jsonb,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { organization } from './identity';
import { blueprintInvocation } from './work-template-blueprint';
import { invocationHead } from './work-template-invocation-head';

/** Original source aliases and independently proved ordering; never physical generated-work identities. */
export interface InvocationRevisionProjection {
  readonly revision: 1;
  readonly steps: readonly {
    readonly alias: string;
    readonly key: string;
    readonly rootKey: string;
    readonly path: readonly string[];
    readonly kind: 'project' | 'milestone' | 'task';
    readonly sort: number;
  }[];
}
/** Immutable private authored-revision registry; a revision number is independent of head metadata CAS. */
export const invocationRevision = pgTable(
  'work_template_invocation_revision',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    headId: text('head_id').notNull(),
    invocationId: text('invocation_id').notNull(),
    number: integer('number').notNull(),
    state: text('state').$type<'published' | 'pending_draft'>().notNull(),
    creationMode: text('creation_mode').$type<'all_at_once' | 'when_ready'>().notNull(),
    origin: text('origin').$type<'retained' | 'authored'>().notNull(),
    originalSourceFingerprint: text('original_source_fingerprint'),
    sourceArchiveHash: text('source_archive_hash'),
    authoredPayloadHash: text('authored_payload_hash'),
    projection: jsonb('projection').$type<InvocationRevisionProjection>().notNull(),
    createdBy: text('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('invocation_revision_head_number_unique').on(t.headId, t.organizationId, t.number),
    uniqueIndex('invocation_revision_alias_tenant_unique').on(t.id, t.organizationId, t.headId),
    uniqueIndex('invocation_revision_alias_org_unique').on(t.id, t.organizationId),
    uniqueIndex('invocation_revision_document_unique').on(
      t.invocationId,
      t.headId,
      t.organizationId,
    ),
    uniqueIndex('invocation_revision_invocation_tenant_unique').on(
      t.invocationId,
      t.organizationId,
    ),
    foreignKey({
      name: 'invocation_revision_head_tenant_fk',
      columns: [t.headId, t.organizationId],
      foreignColumns: [invocationHead.id, invocationHead.organizationId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'invocation_revision_document_tenant_fk',
      columns: [t.invocationId, t.organizationId],
      foreignColumns: [blueprintInvocation.id, blueprintInvocation.organizationId],
    }).onDelete('restrict'),
    check(
      'invocation_revision_shape',
      sql`${t.number}>0 and ${t.creationMode} in('all_at_once','when_ready') and ((${t.state}='published' and ${t.publishedAt} is not null) or (${t.state}='pending_draft' and ${t.publishedAt} is null)) and ((${t.origin}='retained' and ${t.originalSourceFingerprint} is not null and ${t.sourceArchiveHash} is not null and ${t.originalSourceFingerprint} ~ '^[a-f0-9]{32}$' and ${t.sourceArchiveHash} ~ '^sha256:[a-f0-9]{64}$' and ${t.authoredPayloadHash} is null) or (${t.origin}='authored' and ${t.originalSourceFingerprint} is null and ${t.sourceArchiveHash} is null and ${t.authoredPayloadHash} is not null and ${t.authoredPayloadHash} ~ '^sha256:[a-f0-9]{64}$'))`,
    ),
    pgPolicy('invocation_revision_private', {
      for: 'all',
      using: sql`exists(select 1 from work_template_invocation_head h where h.id=${t.headId} and h.organization_id=${t.organizationId})`,
      withCheck: sql`exists(select 1 from work_template_invocation_head h where h.id=${t.headId} and h.organization_id=${t.organizationId})`,
    }),
  ],
).enableRLS();
