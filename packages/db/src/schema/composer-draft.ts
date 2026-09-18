/**
 * `@docket/db` — saved composer drafts (the unsent state of a create composer).
 *
 * @remarks
 * A composer draft is what a person had typed into the task, project, initiative, program, or
 * team composer when they closed it. The whole form value is one jsonb payload governed by
 * `@docket/work/composer-draft-contract`, so the database never has to know one composer's
 * fields from another's.
 *
 * Drafts are personal: a row belongs to a user, names the workspace the composer would create
 * into, and is visible to nobody else. Membership is checked when the draft is saved; creating
 * the real record goes through the ordinary create route and its own authorization. A draft
 * expires after a fixed interval without an edit, and the expiry sweep removes it.
 *
 * Its own file, like `plan-draft.ts`, so the barrel keeps one island per personal document.
 */
import { index, integer, jsonb, pgEnum, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import type { ComposerDraftPayload } from '@docket/work/composer-draft-contract';

import { genId } from '../id';
import { user } from './auth';
import { organization } from './identity';

/** Which create composer a draft belongs to. */
export const composerDraftKind = pgEnum('composer_draft_kind', [
  'task',
  'project',
  'initiative',
  'program',
  'team',
]);

/** A saved composer draft. */
export const composerDraft = pgTable(
  'composer_draft',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    /** The person the draft belongs to. */
    ownerUserId: text('owner_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** The workspace the composer would create into. Fixed at creation. */
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    kind: composerDraftKind('kind').notNull(),
    /** Incremented on every save; a save carries the revision it was written against. */
    revision: integer('revision').notNull().default(0),
    payload: jsonb('payload').$type<ComposerDraftPayload>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    /** When the draft is removed unless saved again first. Renewed on every save. */
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    index('composer_draft_owner_org_kind_updated_idx').on(
      t.ownerUserId,
      t.organizationId,
      t.kind,
      t.updatedAt,
    ),
    index('composer_draft_expires_idx').on(t.expiresAt),
  ],
);
