/**
 * Semantics test for migration 0016's `email_meta.externalUrl` backfill: the harness has
 * already applied the migration (against empty tables), so this re-runs the identical
 * UPDATE against seeded pre-backfill-shaped rows and asserts the expression's behavior —
 * gmail rows gain the canonical deep link, rows that already carry a URL are untouched.
 */
import { sql } from 'drizzle-orm';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import { getDb, one, seedBaseOrg } from './harness.test';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
});

const BACKFILL = sql`
UPDATE "email_suggestion" es
SET "email_meta" = coalesce(es."email_meta", '{}'::jsonb)
  || jsonb_build_object('externalUrl', 'https://mail.google.com/mail/#all/' || es."external_thread_id")
FROM "integration" i
WHERE i."id" = es."integration_id"
  AND i."provider" = 'gmail'
  AND (es."email_meta" IS NULL OR es."email_meta"->>'externalUrl' IS NULL)
`;

describe('migration 0016 externalUrl backfill semantics', () => {
  it('stamps the gmail deep link onto legacy rows and leaves already-stamped rows alone', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const integration = one(
      await db
        .insert(schema.integration)
        .values({
          organizationId: orgId,
          provider: 'gmail',
          pattern: 'connector',
          roles: ['signal'],
          createdBy: humanActorId,
        })
        .returning({ id: schema.integration.id }),
    );
    const legacy = one(
      await db
        .insert(schema.emailSuggestion)
        .values({
          organizationId: orgId,
          integrationId: integration.id,
          externalThreadId: 'legacy-thread',
          title: 'Legacy suggestion',
          emailMeta: { subject: 'Legacy', sender: 'a@x.com', snippet: 's' },
        })
        .returning({ id: schema.emailSuggestion.id }),
    );
    const stamped = one(
      await db
        .insert(schema.emailSuggestion)
        .values({
          organizationId: orgId,
          integrationId: integration.id,
          externalThreadId: 'stamped-thread',
          title: 'Already stamped',
          emailMeta: { subject: 'S', externalUrl: 'https://example.com/keep-me' },
        })
        .returning({ id: schema.emailSuggestion.id }),
    );

    await db.execute(BACKFILL);

    const legacyRow = one(
      await db
        .select({ meta: schema.emailSuggestion.emailMeta })
        .from(schema.emailSuggestion)
        .where(eq(schema.emailSuggestion.id, legacy.id)),
    );
    expect((legacyRow.meta as Record<string, unknown>)['externalUrl']).toBe(
      'https://mail.google.com/mail/#all/legacy-thread',
    );
    // The pre-existing subject/sender snapshot survives the jsonb merge.
    expect((legacyRow.meta as Record<string, unknown>)['subject']).toBe('Legacy');

    const stampedRow = one(
      await db
        .select({ meta: schema.emailSuggestion.emailMeta })
        .from(schema.emailSuggestion)
        .where(eq(schema.emailSuggestion.id, stamped.id)),
    );
    expect((stampedRow.meta as Record<string, unknown>)['externalUrl']).toBe(
      'https://example.com/keep-me',
    );
  });
});
