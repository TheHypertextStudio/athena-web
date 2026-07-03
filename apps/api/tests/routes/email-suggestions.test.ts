import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';
import type { EmailSuggestionOut } from '@docket/types';

import { appWithActor, getDb, one, seedBaseOrg } from './harness.test';
import type emailSuggestionsRouter from '../../src/routes/email-suggestions';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let router!: typeof emailSuggestionsRouter;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  router = (await import('../../src/routes/email-suggestions')).default;
});

const J = { 'content-type': 'application/json' };

async function body<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

interface Page<T> {
  items: T[];
}

/** A fresh org with a Gmail integration and one pending suggestion. */
async function seedSuggestion(overrides: Partial<typeof schema.emailSuggestion.$inferInsert> = {}) {
  const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
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
  const suggestion = one(
    await db
      .insert(schema.emailSuggestion)
      .values({
        organizationId: orgId,
        integrationId: integration.id,
        externalThreadId: `thread_${Math.random().toString(36).slice(2, 8)}`,
        title: 'Schedule the SWE interview with Google',
        description: 'They proposed three slots next week.',
        priority: 'high',
        emailMeta: {
          subject: 'Software Engineering Interview',
          sender: 'recruiter@google.com',
          snippet: 'pick a slot',
          externalUrl: 'https://mail.mock.docket.local/#all/thread_seed',
        },
        createdBy: humanActorId,
        ...overrides,
      })
      .returning(),
  );
  return { orgId, teamId, humanActorId, suggestion };
}

describe('email-suggestions router', () => {
  it('lists only pending suggestions for the org', async () => {
    const { orgId, humanActorId } = await seedSuggestion();
    const w = appWithActor(router, orgId, ['contribute'], humanActorId);
    const page = await body<Page<EmailSuggestionOut>>(await w.request('/'));
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.status).toBe('pending');
    expect(page.items[0]?.title).toContain('SWE interview');
  });

  it('accept materializes a task with an email attachment and marks the suggestion accepted', async () => {
    const { orgId, humanActorId, suggestion } = await seedSuggestion();
    const w = appWithActor(router, orgId, ['contribute'], humanActorId);

    const res = await w.request(`/${suggestion.id}/accept`, {
      method: 'POST',
      headers: J,
      body: '{}',
    });
    expect(res.status).toBe(200);
    const accepted = await body<EmailSuggestionOut>(res);
    expect(accepted.status).toBe('accepted');
    expect(accepted.createdTaskId).toBeTruthy();

    // A real task now exists, titled from the suggestion, with the suggested priority.
    const taskRow = one(
      await db.select().from(schema.task).where(eq(schema.task.id, accepted.createdTaskId!)),
    );
    expect(taskRow.title).toBe('Schedule the SWE interview with Google');
    expect(taskRow.priority).toBe('high');

    // The source email is attached back to that task.
    const att = await db
      .select()
      .from(schema.attachment)
      .where(
        and(
          eq(schema.attachment.subjectId, accepted.createdTaskId!),
          eq(schema.attachment.kind, 'email'),
        ),
      );
    expect(att).toHaveLength(1);
    expect(att[0]?.externalId).toBe(suggestion.externalThreadId);
    expect(att[0]?.sourceIntegrationId).toBe(suggestion.integrationId);
    // The attachment URL is the provider-captured one from the ingest snapshot — never fabricated.
    expect(att[0]?.url).toBe('https://mail.mock.docket.local/#all/thread_seed');
  });

  it('GET /:id/thread serves the live source thread through the mail connector', async () => {
    const { orgId, humanActorId, suggestion } = await seedSuggestion();
    const w = appWithActor(router, orgId, ['contribute'], humanActorId);

    const res = await w.request(`/${suggestion.id}/thread`);
    expect(res.status).toBe(200);
    const thread = await body<{
      threadId: string;
      subject: string;
      externalUrl: string;
      messages: { from: string; bodyHtml: string | null }[];
    }>(res);
    expect(thread.threadId).toBe(suggestion.externalThreadId);
    expect(thread.messages.length).toBeGreaterThanOrEqual(1);
    // The mock connector serves a deterministic render-ready thread (body is live, not stored).
    expect(thread.messages[0]?.bodyHtml).toContain('deterministic mock email body');
  });

  it('accept honors title/priority overrides', async () => {
    const { orgId, humanActorId, suggestion } = await seedSuggestion();
    const w = appWithActor(router, orgId, ['contribute'], humanActorId);
    const res = await w.request(`/${suggestion.id}/accept`, {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ title: 'Reply to Google recruiter', priority: 'urgent' }),
    });
    const accepted = await body<EmailSuggestionOut>(res);
    const taskRow = one(
      await db.select().from(schema.task).where(eq(schema.task.id, accepted.createdTaskId!)),
    );
    expect(taskRow.title).toBe('Reply to Google recruiter');
    expect(taskRow.priority).toBe('urgent');
  });

  it('rejects accepting an already-resolved suggestion (409)', async () => {
    const { orgId, humanActorId, suggestion } = await seedSuggestion();
    const w = appWithActor(router, orgId, ['contribute'], humanActorId);
    await w.request(`/${suggestion.id}/accept`, { method: 'POST', headers: J, body: '{}' });
    const second = await w.request(`/${suggestion.id}/accept`, {
      method: 'POST',
      headers: J,
      body: '{}',
    });
    expect(second.status).toBe(409);
  });

  it('dismiss marks the suggestion dismissed and drops it from the pending list', async () => {
    const { orgId, humanActorId, suggestion } = await seedSuggestion();
    const w = appWithActor(router, orgId, ['contribute'], humanActorId);
    const res = await w.request(`/${suggestion.id}/dismiss`, { method: 'POST' });
    expect(res.status).toBe(200);
    expect(await body<{ id: string; status: string }>(res)).toEqual({
      id: suggestion.id,
      status: 'dismissed',
    });
    expect((await body<Page<EmailSuggestionOut>>(await w.request('/'))).items).toHaveLength(0);
  });

  it('isolates by tenant: another org cannot accept or dismiss', async () => {
    const a = await seedSuggestion();
    const b = await seedBaseOrg(db, schema);
    const wb = appWithActor(router, b.orgId, ['contribute'], b.humanActorId);
    expect(
      (await wb.request(`/${a.suggestion.id}/accept`, { method: 'POST', headers: J, body: '{}' }))
        .status,
    ).toBe(404);
    expect((await wb.request(`/${a.suggestion.id}/dismiss`, { method: 'POST' })).status).toBe(404);
  });

  it('enforces the `contribute` capability on accept/dismiss (403)', async () => {
    const { orgId, humanActorId, suggestion } = await seedSuggestion();
    const viewer = appWithActor(router, orgId, ['view'], humanActorId);
    expect(
      (await viewer.request(`/${suggestion.id}/accept`, { method: 'POST', headers: J, body: '{}' }))
        .status,
    ).toBe(403);
    expect((await viewer.request(`/${suggestion.id}/dismiss`, { method: 'POST' })).status).toBe(
      403,
    );
  });
});
