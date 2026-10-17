import { assertDefined } from '@docket/test-utils';
import { eq } from 'drizzle-orm';
import { OrganizationId } from '@docket/identity-access/ids';
import type { getDb } from '../../support/routes-harness';
import { seedBaseOrg, seedUserWithHub } from '../../support/routes-harness';
import { configureMailChannel } from '../../../src/services/athena-mail/channel';
import { ensureMailbox, mailboxAddress } from '../../../src/routes/athena-mail-store';
import { deliverInboundMail } from '../../../src/routes/inbound-mail-delivery';
import { sweepMailIngress } from '../../../src/services/athena-mail/ingress';
type Schema = Awaited<ReturnType<typeof getDb>>;
/** Create explicit consent for a verified owner in a current workspace. */
export async function enrolled(schema: Schema) {
  const owner = await seedUserWithHub(schema.db, schema, 'EmailWorkflow');
  const { orgId, humanActorId } = await seedBaseOrg(schema.db, schema);
  await schema.db
    .update(schema.actor)
    .set({ userId: owner, status: 'active' })
    .where(eq(schema.actor.id, humanActorId));
  await schema.db.update(schema.user).set({ emailVerified: true }).where(eq(schema.user.id, owner));
  await configureMailChannel(owner, {
    enabled: true,
    ownerRepliesEnabled: true,
    organizationId: OrganizationId.parse(orgId),
  });
  const mailbox = await ensureMailbox(owner);
  await schema.db.insert(schema.grant).values({
    organizationId: orgId,
    subjectKind: 'actor',
    subjectId: humanActorId,
    resourceKind: 'organization',
    resourceId: orgId,
    capabilities: ['view', 'contribute', 'manage'],
    effect: 'allow',
  });
  return { owner, orgId, mailbox, humanActorId };
}

/** Admit one isolated owner request without opening a client. */
export async function ownerOperation(
  schema: Schema,
  mailbox: typeof schema.athenaMailbox.$inferSelect,
) {
  const key = `request-${Math.random()}`;
  await deliverInboundMail(
    {
      providerMessageId: key,
      rfc822MessageId: `<${key}@example.com>`,
      fromAddress: assertDefined(mailbox.ownerAddress),
      fromName: null,
      to: [assertDefined(mailboxAddress(mailbox))],
      cc: [],
      subject: 'Help me',
      text: 'Please help with this request.',
      html: null,
      bodyStatus: 'complete',
      receivedAt: new Date().toISOString(),
      attachments: [],
      authentication: { spf: 'pass', dkim: 'pass', dmarc: 'pass' },
    },
    'fixture',
  );
  await sweepMailIngress();
  const [message] = await schema.db
    .select()
    .from(schema.athenaInboundMessage)
    .where(eq(schema.athenaInboundMessage.providerMessageId, key));
  const [session] = await schema.db
    .select()
    .from(schema.agentSession)
    .where(eq(schema.agentSession.id, assertDefined(assertDefined(message).sessionId)));
  return assertDefined(session);
}
