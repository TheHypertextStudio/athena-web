/**
 * Athena receiving mail natively, end to end: the public webhook, the separate store, the
 * universal stream entry, the delivery into the one Athena conversation, and attachment to work.
 *
 * @remarks
 * The pipeline is driven through the real HTTP edge with the offline inbound adapter, so every
 * assertion is about the production code path — the same parser, the same delivery function, the
 * same routes the browser calls. Nothing here stubs the pipeline and asserts the stub.
 *
 * Two assertions are load-bearing for the requirement and are written to fail loudly if the
 * design ever drifts: that receiving an Athena email writes **nothing** to the connector tables
 * Docket's synced mail lives in, and that the message reaches Athena through the *same* shared
 * conversation ingress a chat message uses rather than an email-only branch.
 */
import type * as DbModule from '@docket/db';
import { buildInboundFixturePayload } from '@docket/mail';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { beforeAll, describe, expect, it } from 'vitest';

import type inboundMailRouter from '../../src/routes/inbound-mail';
import type athenaMailRouter from '../../src/routes/athena-mail';
import type { ensureMailbox as EnsureMailbox } from '../../src/routes/athena-mail-store';
import { appWithSession, fakeSession, getDb } from '../support/routes-harness';
import { assertDefined } from '@docket/test-utils';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let inboundMail!: typeof inboundMailRouter;
let athenaMail!: typeof athenaMailRouter;
let ensureMailbox!: typeof EnsureMailbox;

const HOST = 'inbox.athena.docket.localhost';

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  inboundMail = (await import('../../src/routes/inbound-mail')).default;
  athenaMail = (await import('../../src/routes/athena-mail')).default;
  ({ ensureMailbox } = await import('../../src/routes/athena-mail-store'));
});

/** A signed-out Hono app carrying only the webhook — exactly how the provider reaches it. */
function webhookApp() {
  const app = new Hono();
  app.route('/', inboundMail);
  return app;
}

interface Fixture {
  readonly ownerUserId: string;
  readonly organizationId: string;
  readonly address: string;
}

let counter = 0;

/** Seed one person with a workspace, an actor, and a minted Athena inbox address. */
async function seedOwner(): Promise<Fixture> {
  counter += 1;
  const slug = `mail${String(counter)}-${Math.random().toString(36).slice(2, 8)}`;
  const [owner] = await db
    .insert(schema.user)
    .values({ name: 'Ada', email: `${slug}@example.com` })
    .returning({ id: schema.user.id });
  await db.insert(schema.hub).values({ userId: assertDefined(owner).id, preferences: {} });
  const [org] = await db
    .insert(schema.organization)
    .values({ name: `Workspace ${slug}`, slug })
    .returning({ id: schema.organization.id });
  await db.insert(schema.actor).values({
    organizationId: assertDefined(org).id,
    kind: 'human',
    displayName: 'Ada',
    userId: assertDefined(owner).id,
  });
  const mailbox = await ensureMailbox(assertDefined(owner).id);
  await db
    .update(schema.athenaMailbox)
    .set({ organizationId: assertDefined(org).id })
    .where(eq(schema.athenaMailbox.id, mailbox.id));
  return {
    ownerUserId: assertDefined(owner).id,
    organizationId: assertDefined(org).id,
    address: `${mailbox.key}@${HOST}`,
  };
}

/** POST one fixture message at the public webhook and return the HTTP response. */
async function deliver(
  address: string,
  overrides: {
    readonly emailId?: string;
    readonly from?: string;
    readonly subject?: string;
    readonly text?: string;
    readonly receivedAt?: string;
  } = {},
): Promise<Response> {
  counter += 1;
  const payload = buildInboundFixturePayload({
    emailId: overrides.emailId ?? `e_${String(counter)}_${Math.random().toString(36).slice(2, 8)}`,
    from: overrides.from ?? 'Jane Rivera <jane@example.com>',
    to: [address],
    subject: overrides.subject ?? 'Contract for the Q3 refresh',
    text: overrides.text ?? 'Attaching the signed contract. Can you file it against the refresh?',
    ...(overrides.receivedAt ? { receivedAt: overrides.receivedAt } : {}),
  });
  return webhookApp().request('/inbound', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: payload,
  });
}

describe('the inbound webhook', () => {
  it('accepts a message addressed to an Athena inbox and stores it', async () => {
    const fixture = await seedOwner();
    const response = await deliver(fixture.address);

    expect(response.status).toBe(204);
    expect(response.headers.get('x-docket-inbound-outcome')).toBe('delivered');

    const rows = await db
      .select()
      .from(schema.athenaInboundMessage)
      .where(eq(schema.athenaInboundMessage.ownerUserId, fixture.ownerUserId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      fromAddress: 'jane@example.com',
      fromName: 'Jane Rivera',
      title: 'Contract for the Q3 refresh',
      toAddress: fixture.address,
      provider: 'fixture',
      bodyStatus: 'complete',
      organizationId: fixture.organizationId,
    });
    expect(rows[0]?.snippet).toContain('Attaching the signed contract');
  });

  it('routes a plus-addressed variant to the same mailbox', async () => {
    const fixture = await seedOwner();
    const [local, host] = fixture.address.split('@');
    const response = await deliver(`${local ?? ''}+receipts@${host ?? ''}`);
    expect(response.headers.get('x-docket-inbound-outcome')).toBe('delivered');

    const rows = await db
      .select()
      .from(schema.athenaInboundMessage)
      .where(eq(schema.athenaInboundMessage.ownerUserId, fixture.ownerUserId));
    expect(rows).toHaveLength(1);
  });

  it('stores a redelivered message exactly once', async () => {
    const fixture = await seedOwner();
    const emailId = `e_retry_${Math.random().toString(36).slice(2, 8)}`;
    const first = await deliver(fixture.address, { emailId });
    const second = await deliver(fixture.address, { emailId });

    expect(first.headers.get('x-docket-inbound-outcome')).toBe('delivered');
    expect(second.headers.get('x-docket-inbound-outcome')).toBe('duplicate');

    const rows = await db
      .select()
      .from(schema.athenaInboundMessage)
      .where(eq(schema.athenaInboundMessage.ownerUserId, fixture.ownerUserId));
    expect(rows).toHaveLength(1);
  });

  it('accepts, without effect, a message addressed to nobody it hosts', async () => {
    const response = await deliver(`nosuchmailbox@${HOST}`);
    expect(response.status).toBe(204);
    expect(response.headers.get('x-docket-inbound-outcome')).toBe('unroutable');
  });

  it('accepts, without effect, a message addressed to a domain it does not receive for', async () => {
    const fixture = await seedOwner();
    const [local] = fixture.address.split('@');
    const response = await deliver(`${local ?? ''}@someone-elses-domain.example`);
    expect(response.headers.get('x-docket-inbound-outcome')).toBe('unroutable');
    const rows = await db
      .select()
      .from(schema.athenaInboundMessage)
      .where(eq(schema.athenaInboundMessage.ownerUserId, fixture.ownerUserId));
    expect(rows).toHaveLength(0);
  });

  it('rejects a body it cannot read as a receiving event', async () => {
    const response = await webhookApp().request('/inbound', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"nonsense":true}',
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ received: false, code: 'malformed-payload' });
  });

  it('acknowledges an authentic event of another type without storing anything', async () => {
    const before = await db.select().from(schema.athenaInboundMessage);
    const response = await webhookApp().request('/inbound', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'email.delivered', data: { email_id: 'x' } }),
    });
    expect(response.status).toBe(204);
    const after = await db.select().from(schema.athenaInboundMessage);
    expect(after).toHaveLength(before.length);
  });
});

describe('the universal inbox stream', () => {
  it('records the message as an event with its sender, subject and received time', async () => {
    const fixture = await seedOwner();
    await deliver(fixture.address, {
      subject: 'Budget approval needed',
      from: 'Nadia Okoro <nadia@example.com>',
      receivedAt: '2026-08-01T15:04:05.000Z',
    });

    const [row] = await db
      .select()
      .from(schema.event)
      .where(
        and(
          eq(schema.event.organizationId, fixture.organizationId),
          eq(schema.event.kind, 'email_received'),
        ),
      );
    expect(row).toBeDefined();
    expect(row?.title).toBe('Budget approval needed');
    expect(row?.occurredAt.toISOString()).toBe('2026-08-01T15:04:05.000Z');
    expect(row?.detail).toMatchObject({
      schema: 'docket.inbound_email',
      fromAddress: 'nadia@example.com',
      fromName: 'Nadia Okoro',
      subject: 'Budget approval needed',
    });
    // The entry is addressed to the mailbox owner, so it reaches their personal feed.
    const recipients = await db
      .select()
      .from(schema.eventRecipient)
      .where(eq(schema.eventRecipient.eventId, assertDefined(row).id));
    expect(recipients.map((r) => r.userId)).toContain(fixture.ownerUserId);

    // And the stored message points back at its stream entry, so the two are navigable.
    const [message] = await db
      .select()
      .from(schema.athenaInboundMessage)
      .where(eq(schema.athenaInboundMessage.ownerUserId, fixture.ownerUserId));
    expect(message?.streamEventId).toBe(row?.id);
  });

  it('interleaves with non-email events in one chronological feed', async () => {
    const fixture = await seedOwner();
    const { emitEvent } = await import('../../src/routes/event-emit');

    await emitEvent({
      organizationId: fixture.organizationId,
      kind: 'created',
      title: 'Q3 refresh',
      subject: { type: 'project', id: `proj_${Math.random().toString(36).slice(2, 8)}` },
      occurredAt: new Date('2026-08-01T09:00:00.000Z'),
      forUserId: fixture.ownerUserId,
    });
    await deliver(fixture.address, { receivedAt: '2026-08-01T10:00:00.000Z' });
    await emitEvent({
      organizationId: fixture.organizationId,
      kind: 'completed',
      title: 'Sign the contract',
      subject: { type: 'task', id: `task_${Math.random().toString(36).slice(2, 8)}` },
      occurredAt: new Date('2026-08-01T11:00:00.000Z'),
      forUserId: fixture.ownerUserId,
    });

    const rows = await db
      .select({ kind: schema.event.kind, occurredAt: schema.event.occurredAt })
      .from(schema.event)
      .where(eq(schema.event.organizationId, fixture.organizationId));
    const ordered = [...rows].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
    expect(ordered.map((r) => r.kind)).toEqual(['created', 'email_received', 'completed']);
  });
});

describe('delivery into Athena', () => {
  it('lands on the one open conversation through the shared message ingress', async () => {
    const fixture = await seedOwner();
    const { resolveCanonicalConversation } = await import('../../src/routes/agent-dispatch');
    const conversation = await resolveCanonicalConversation(fixture.ownerUserId);

    await deliver(fixture.address, { subject: 'Renew the hosting plan' });

    const activities = await db
      .select()
      .from(schema.sessionActivity)
      .where(eq(schema.sessionActivity.sessionId, conversation.id));

    // The exact write shape the chat door produces: a visible `response` activity authored by the
    // human side of the conversation. An email-only branch would not produce this.
    const humanTurns = activities.filter(
      (row) =>
        row.type === 'response' && (row.body as { author?: string } | null)?.author === 'user',
    );
    expect(humanTurns).toHaveLength(1);
    const text = (humanTurns[0]?.body as { text?: string } | null)?.text ?? '';
    expect(text).toContain('Renew the hosting plan');
    expect(text).toContain('jane@example.com');

    // No second conversation was opened for the email.
    const sessions = await db
      .select()
      .from(schema.agentSession)
      .where(
        and(
          eq(schema.agentSession.ownerUserId, fixture.ownerUserId),
          eq(schema.agentSession.kind, 'chat'),
        ),
      );
    expect(sessions).toHaveLength(1);

    // Athena answered on that same conversation, through the ordinary loop.
    const agentTurns = activities.filter(
      (row) => (row.body as { author?: string } | null)?.author !== 'user',
    );
    expect(agentTurns.length).toBeGreaterThan(0);

    const [message] = await db
      .select()
      .from(schema.athenaInboundMessage)
      .where(eq(schema.athenaInboundMessage.ownerUserId, fixture.ownerUserId));
    expect(message?.sessionId).toBe(conversation.id);
  });

  it('names the stored context object so Athena can act on it', async () => {
    const fixture = await seedOwner();
    await deliver(fixture.address);
    const [message] = await db
      .select()
      .from(schema.athenaInboundMessage)
      .where(eq(schema.athenaInboundMessage.ownerUserId, fixture.ownerUserId));
    const activities = await db
      .select()
      .from(schema.sessionActivity)
      .where(eq(schema.sessionActivity.sessionId, assertDefined(assertDefined(message).sessionId)));
    const text = activities
      .map((row) => (row.body as { text?: string } | null)?.text ?? '')
      .join('\n');
    expect(text).toContain(assertDefined(message).id);
  });
});

describe('separation from mail Docket syncs', () => {
  it('writes to Athena’s own store and to none of the connector tables', async () => {
    const fixture = await seedOwner();

    const suggestionsBefore = await db.select().from(schema.emailSuggestion);
    const emailAttachmentsBefore = await db
      .select()
      .from(schema.attachment)
      .where(eq(schema.attachment.kind, 'email'));
    const notificationInboundBefore = await db.select().from(schema.notificationInboundEvent);

    await deliver(fixture.address);

    const stored = await db
      .select()
      .from(schema.athenaInboundMessage)
      .where(eq(schema.athenaInboundMessage.ownerUserId, fixture.ownerUserId));
    expect(stored).toHaveLength(1);
    // The message belongs to no integration at all — that is the structural separation.
    expect(await db.select().from(schema.emailSuggestion)).toHaveLength(suggestionsBefore.length);
    expect(
      await db.select().from(schema.attachment).where(eq(schema.attachment.kind, 'email')),
    ).toHaveLength(emailAttachmentsBefore.length);
    expect(await db.select().from(schema.notificationInboundEvent)).toHaveLength(
      notificationInboundBefore.length,
    );
  });

  it('leaves Athena’s store untouched when a synced-mail suggestion is written', async () => {
    const fixture = await seedOwner();
    const [integration] = await db
      .insert(schema.integration)
      .values({
        organizationId: fixture.organizationId,
        provider: 'gmail',
        pattern: 'connector',
        status: 'connected',
        externalAccountId: `acct_${Math.random().toString(36).slice(2, 8)}`,
      })
      .returning({ id: schema.integration.id });

    const before = await db.select().from(schema.athenaInboundMessage);
    await db.insert(schema.emailSuggestion).values({
      organizationId: fixture.organizationId,
      integrationId: assertDefined(integration).id,
      externalThreadId: `thread_${Math.random().toString(36).slice(2, 8)}`,
      title: 'Synced from a connected mailbox',
    });
    const after = await db.select().from(schema.athenaInboundMessage);
    expect(after).toHaveLength(before.length);
  });
});

describe('the owner-facing inbox API', () => {
  it('reports the address, and reads the message back as a context object', async () => {
    const fixture = await seedOwner();
    await deliver(fixture.address, { subject: 'Invoice 4471' });
    const app = appWithSession(athenaMail, fakeSession(fixture.ownerUserId));

    const addressResponse = await app.request('/address');
    expect(addressResponse.status).toBe(200);
    expect(await addressResponse.json()).toEqual({
      address: fixture.address,
      host: HOST,
      configured: true,
    });

    const listResponse = await app.request('/');
    expect(listResponse.status).toBe(200);
    const list = (await listResponse.json()) as { items: Record<string, unknown>[] };
    expect(list.items).toHaveLength(1);
    // The shared context-object contract: a stable id, a title, content, provenance, timestamps.
    expect(list.items[0]).toMatchObject({
      kind: 'athena_email',
      title: 'Invoice 4471',
      contentStatus: 'complete',
      source: { system: 'docket', provider: 'fixture', label: 'Jane Rivera' },
      attachedCount: 0,
    });
    expect(typeof list.items[0]?.['id']).toBe('string');
    expect(typeof list.items[0]?.['occurredAt']).toBe('string');
    expect(typeof list.items[0]?.['content']).toBe('string');
  });

  it('hides another person’s message rather than forbidding it', async () => {
    const mine = await seedOwner();
    const theirs = await seedOwner();
    await deliver(theirs.address);
    const [message] = await db
      .select()
      .from(schema.athenaInboundMessage)
      .where(eq(schema.athenaInboundMessage.ownerUserId, theirs.ownerUserId));

    const app = appWithSession(athenaMail, fakeSession(mine.ownerUserId));
    expect((await app.request(`/${assertDefined(message).id}`)).status).toBe(404);
  });
});

describe('attaching a received message to work', () => {
  /** Create a task in a workspace, with the team a task requires. */
  async function seedTask(fixture: Fixture, title: string): Promise<string> {
    const slug = Math.random().toString(36).slice(2, 8);
    const [team] = await db
      .insert(schema.team)
      .values({ organizationId: fixture.organizationId, name: `Team ${slug}`, key: slug })
      .returning({ id: schema.team.id });
    const [row] = await db
      .insert(schema.task)
      .values({
        organizationId: fixture.organizationId,
        teamId: assertDefined(team).id,
        title,
        state: 'backlog',
      })
      .returning({ id: schema.task.id });
    return assertDefined(row).id;
  }

  it('attaches to a task and to a project through the generic attachment table', async () => {
    const fixture = await seedOwner();
    await deliver(fixture.address, { subject: 'Signed contract' });
    const [message] = await db
      .select()
      .from(schema.athenaInboundMessage)
      .where(eq(schema.athenaInboundMessage.ownerUserId, fixture.ownerUserId));
    const taskId = await seedTask(fixture, 'File the contract');
    const [project] = await db
      .insert(schema.project)
      .values({ organizationId: fixture.organizationId, name: 'Q3 refresh' })
      .returning({ id: schema.project.id });

    const app = appWithSession(athenaMail, fakeSession(fixture.ownerUserId));
    for (const [subjectType, subjectId] of [
      ['task', taskId],
      ['project', assertDefined(project).id],
    ] as const) {
      const response = await app.request(`/${assertDefined(message).id}/attachments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          subjectType,
          subjectId,
          organizationId: fixture.organizationId,
        }),
      });
      expect(response.status).toBe(200);
    }

    // It really is the generic table every other attachable resource uses.
    const attachments = await db
      .select()
      .from(schema.attachment)
      .where(
        and(
          eq(schema.attachment.kind, 'athena_email'),
          eq(schema.attachment.externalId, assertDefined(message).id),
        ),
      );
    expect(attachments).toHaveLength(2);
    expect(attachments.map((row) => row.subjectType).sort()).toEqual(['project', 'task']);
    expect(attachments[0]?.title).toBe('Signed contract');

    // The message reports both, with the entities' own titles.
    const listed = (await (
      await app.request(`/${assertDefined(message).id}/attachments`)
    ).json()) as {
      items: { subjectTitle: string }[];
    };
    expect(listed.items.map((item) => item.subjectTitle).sort()).toEqual([
      'File the contract',
      'Q3 refresh',
    ]);

    // And the entity side answers with the message, showing sender and subject.
    const onTask = (await (
      await app.request(
        `/attached?subjectType=task&subjectId=${taskId}&organizationId=${fixture.organizationId}`,
      )
    ).json()) as { items: { title: string; fromAddress: string }[] };
    expect(onTask.items).toHaveLength(1);
    expect(onTask.items[0]).toMatchObject({
      title: 'Signed contract',
      fromAddress: 'jane@example.com',
    });
  });

  it('refuses to attach the same message to the same item twice', async () => {
    const fixture = await seedOwner();
    await deliver(fixture.address);
    const [message] = await db
      .select()
      .from(schema.athenaInboundMessage)
      .where(eq(schema.athenaInboundMessage.ownerUserId, fixture.ownerUserId));
    const taskId = await seedTask(fixture, 'Only once');
    const app = appWithSession(athenaMail, fakeSession(fixture.ownerUserId));
    const body = JSON.stringify({
      subjectType: 'task',
      subjectId: taskId,
      organizationId: fixture.organizationId,
    });
    const headers = { 'content-type': 'application/json' };
    expect(
      (
        await app.request(`/${assertDefined(message).id}/attachments`, {
          method: 'POST',
          headers,
          body,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await app.request(`/${assertDefined(message).id}/attachments`, {
          method: 'POST',
          headers,
          body,
        })
      ).status,
    ).toBe(409);
  });

  it('refuses a target in a workspace the caller does not belong to', async () => {
    const mine = await seedOwner();
    const theirs = await seedOwner();
    await deliver(mine.address);
    const [message] = await db
      .select()
      .from(schema.athenaInboundMessage)
      .where(eq(schema.athenaInboundMessage.ownerUserId, mine.ownerUserId));
    const foreignTask = await seedTask(theirs, 'Not yours');

    const app = appWithSession(athenaMail, fakeSession(mine.ownerUserId));
    const response = await app.request(`/${assertDefined(message).id}/attachments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        subjectType: 'task',
        subjectId: foreignTask,
        organizationId: theirs.organizationId,
      }),
    });
    expect(response.status).toBe(404);
  });

  it('detaches without deleting the message', async () => {
    const fixture = await seedOwner();
    await deliver(fixture.address);
    const [message] = await db
      .select()
      .from(schema.athenaInboundMessage)
      .where(eq(schema.athenaInboundMessage.ownerUserId, fixture.ownerUserId));
    const taskId = await seedTask(fixture, 'Detach me');
    const app = appWithSession(athenaMail, fakeSession(fixture.ownerUserId));
    const created = (await (
      await app.request(`/${assertDefined(message).id}/attachments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          subjectType: 'task',
          subjectId: taskId,
          organizationId: fixture.organizationId,
        }),
      })
    ).json()) as { attachmentId: string };

    const removed = await app.request(
      `/${assertDefined(message).id}/attachments/${created.attachmentId}`,
      {
        method: 'DELETE',
      },
    );
    expect(removed.status).toBe(200);
    expect(await removed.json()).toEqual({ id: created.attachmentId, removed: true });

    const still = await db
      .select()
      .from(schema.athenaInboundMessage)
      .where(eq(schema.athenaInboundMessage.id, assertDefined(message).id));
    expect(still).toHaveLength(1);
  });
});

describe('the receiving domain is configuration', () => {
  it('never appears as a literal in application source', async () => {
    const { readdirSync, readFileSync, statSync } = await import('node:fs');
    const { join, resolve } = await import('node:path');
    // Assembled from parts so this test's own source does not contain the literal it bans.
    const banned = ['inbox', 'athena', 'hypertext', 'studio'].join('.');
    const roots = [
      resolve(import.meta.dirname, '../../src'),
      resolve(import.meta.dirname, '../../../web/src'),
      resolve(import.meta.dirname, '../../../../packages/mail/src'),
      resolve(import.meta.dirname, '../../../../packages/db/src'),
      resolve(import.meta.dirname, '../../../../packages/types/src'),
    ];
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(entry)) continue;
        if (readFileSync(full, 'utf8').includes(banned)) offenders.push(full);
      }
    };
    for (const root of roots) walk(root);
    expect(offenders).toEqual([]);
  });
});
