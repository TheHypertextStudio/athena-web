import { beforeAll, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { assertDefined } from '@docket/test-utils';
import { getDb } from '../../support/routes-harness';
import { enrolled } from './fixtures';
import { deliverInboundMail } from '../../../src/routes/inbound-mail-delivery';
import { mailboxAddress } from '../../../src/routes/athena-mail-store';
import { NotificationOut } from '@docket/notifications/notification-contract';
import { toNotificationOut } from '../../../src/services/notifications/inbox';
import {
  projectMailInboxItem,
  recoverMailInboxItems,
} from '../../../src/services/athena-mail/inbox';

let schema: Awaited<ReturnType<typeof getDb>>;
beforeAll(async () => {
  schema = await getDb();
});

it('delivers email into the same caller-owned unread Inbox without duplicating provider retries', async () => {
  const { owner, mailbox } = await enrolled(schema);
  const mail = {
    providerMessageId: crypto.randomUUID(),
    rfc822MessageId: null,
    fromAddress: 'morgan@example.com',
    fromName: 'Morgan',
    to: [assertDefined(mailboxAddress(mailbox))],
    cc: [],
    subject: 'Launch decisions',
    text: 'Two decisions need review.',
    html: null,
    bodyStatus: 'complete' as const,
    receivedAt: new Date().toISOString(),
    attachments: [],
  };
  const delivered = await deliverInboundMail(mail, 'fixture');
  expect(delivered.status).toBe('delivered');
  await deliverInboundMail(mail, 'fixture');
  const rows = await schema.db
    .select()
    .from(schema.notification)
    .where(eq(schema.notification.userId, owner));
  expect(rows).toHaveLength(1);
  const item = assertDefined(rows[0]);
  expect(NotificationOut.parse(toNotificationOut(item)).id).toBe(item.id);
  expect(item.type).toBe('email');
  expect(item.body.title).toBe('Launch decisions');
  expect(item.body.summary).toContain('Morgan');
  expect(item.body.summary).toContain('Two decisions');
  expect(item.body.url).toMatch(/^\/athena\/mail\//);
  expect(item.readAt).toBeNull();
  const readAt = new Date();
  await schema.db
    .update(schema.notification)
    .set({ readAt })
    .where(eq(schema.notification.id, item.id));
  await deliverInboundMail(mail, 'fixture');
  const [message] = await schema.db
    .select()
    .from(schema.athenaInboundMessage)
    .where(eq(schema.athenaInboundMessage.providerMessageId, mail.providerMessageId));
  await projectMailInboxItem({
    ...assertDefined(message),
    snippet: 'The complete message arrived.',
  });
  const [updated] = await schema.db
    .select()
    .from(schema.notification)
    .where(eq(schema.notification.id, item.id));
  expect(assertDefined(updated).readAt).toEqual(readAt);
  expect(assertDefined(updated).body.summary).toContain('complete message');
  await schema.db.delete(schema.notification).where(eq(schema.notification.id, item.id));
  await recoverMailInboxItems();
  await recoverMailInboxItems();
  const recovered = await schema.db
    .select()
    .from(schema.notification)
    .where(eq(schema.notification.userId, owner));
  expect(recovered).toHaveLength(1);
  expect(assertDefined(recovered[0]).id).toBe(item.id);
});
