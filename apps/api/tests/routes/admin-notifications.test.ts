import type * as DbModule from '@docket/db';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { beforeAll, describe, expect, it } from 'vitest';

import type { AppEnv, AuthSession } from '../../src/context';
import { onError } from '../../src/error';
import { fakeSession, getDb, seedUserWithHub } from './harness.test';
import type adminRouter from '../../src/routes/admin';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let admin!: typeof adminRouter;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  admin = (await import('../../src/routes/admin')).default;
});

describe('admin notification routes', () => {
  it('lists and gets notification intents for staff', async () => {
    const staff = await makeStaff('support');
    const intent = await seedIntent(staff.userId, 'Admin announcement list');
    const app = adminApp(fakeSession(staff.userId));

    const list = await app.request('/notifications?limit=20&offset=0');
    expect(list.status).toBe(200);
    const listBody = (await list.json()) as { items: { id: string }[] };
    expect(listBody.items.some((item) => item.id === intent.id)).toBe(true);

    const detail = await app.request(`/notifications/${intent.id}`);
    expect(detail.status).toBe(200);
    expect(await detail.json()).toMatchObject({
      id: intent.id,
      subject: 'Admin announcement list',
    });
  });

  it('approves draft notifications by queueing them and writing operator audit', async () => {
    const staff = await makeStaff('superadmin');
    const intent = await seedIntent(staff.userId, 'Approve this notification');
    const app = adminApp(fakeSession(staff.userId));

    const res = await app.request(`/notifications/${intent.id}/approve`, { method: 'POST' });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: intent.id, status: 'queued' });
    expect(await auditCount('notification.approved', intent.id)).toBe(1);
  });

  it('rejects notifications by canceling them and writing operator audit', async () => {
    const staff = await makeStaff('support');
    const intent = await seedIntent(staff.userId, 'Reject this notification');
    const app = adminApp(fakeSession(staff.userId));

    const res = await app.request(`/notifications/${intent.id}/reject`, { method: 'POST' });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: intent.id, status: 'canceled' });
    expect(await auditCount('notification.rejected', intent.id)).toBe(1);
  });

  it('returns notification audit entries and inbound events', async () => {
    const staff = await makeStaff('support');
    const intent = await seedIntent(staff.userId, 'Notification monitoring');
    await db.insert(schema.operatorAuditEvent).values({
      staffUserId: staff.staffUserId,
      type: 'notification.approved',
      subjectType: 'notification',
      subjectId: intent.id,
      metadata: { status: 'queued' },
    });
    await db.insert(schema.notificationInboundEvent).values({
      notificationId: intent.id,
      channel: 'email',
      kind: 'delivered',
      payload: { providerEventId: 'admin-inbound-monitor' },
    });
    const app = adminApp(fakeSession(staff.userId));

    const audit = await app.request(`/notifications/${intent.id}/audit`);
    expect(audit.status).toBe(200);
    expect((await audit.json()) as { items: { type: string }[] }).toMatchObject({
      items: [expect.objectContaining({ type: 'notification.approved' })],
    });

    const inbound = await app.request(`/notifications/${intent.id}/inbound-events`);
    expect(inbound.status).toBe(200);
    expect((await inbound.json()) as { items: { kind: string }[] }).toMatchObject({
      items: [expect.objectContaining({ kind: 'delivered' })],
    });
  });
});

function adminApp(session: AuthSession) {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    if (session) c.set('session', session);
    await next();
  });
  app.route('/', admin);
  app.onError(onError);
  return app;
}

let counter = 0;
function uniq(): string {
  counter += 1;
  return `${Date.now().toString(36)}${counter}`;
}

async function makeStaff(
  role: 'support' | 'finance' | 'superadmin',
): Promise<{ readonly userId: string; readonly staffUserId: string }> {
  const suffix = uniq();
  const [user] = await db
    .insert(schema.user)
    .values({ name: `Staff ${suffix}`, email: `staff-${suffix}@example.com` })
    .returning({ id: schema.user.id });
  const [staff] = await db
    .insert(schema.staffUser)
    .values({ userId: user!.id, role })
    .returning({ id: schema.staffUser.id });
  return { userId: user!.id, staffUserId: staff!.id };
}

async function seedIntent(createdBy: string, subject: string): Promise<{ readonly id: string }> {
  const userId = await seedUserWithHub(db, schema, `Recipient${uniq()}`);
  const [intent] = await db
    .insert(schema.notificationIntent)
    .values({
      senderType: 'staff',
      category: 'service_announcement',
      priority: 'normal',
      audience: { type: 'user', userId },
      channels: ['web'],
      subject,
      body: { text: subject },
      replyPolicy: 'none',
      status: 'draft',
      createdBy,
    })
    .returning({ id: schema.notificationIntent.id });
  return intent!;
}

async function auditCount(type: string, subjectId: string): Promise<number> {
  const rows = await db
    .select()
    .from(schema.operatorAuditEvent)
    .where(eq(schema.operatorAuditEvent.subjectId, subjectId));
  return rows.filter((row) => row.type === type).length;
}
