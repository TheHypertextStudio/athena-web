/** Public native-email setup, owner isolation and private attachment download contracts. */
import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { assertDefined } from '@docket/test-utils';
import { AthenaMailChannelOut, AthenaMailOutboxOut } from '@docket/athena/athena-mail-contract';
import type athenaMailRouter from '../../src/routes/athena-mail';
import { pageOf } from '../../src/contracts/pagination';
import { getContainer } from '../../src/container';
import { mailAttachmentDigest } from '../../src/services/athena-mail/attachments';
import { ensureMailbox } from '../../src/routes/athena-mail-store';
import {
  appWithSession,
  fakeSession,
  getDb,
  seedBaseOrg,
  seedUserWithHub,
} from '../support/routes-harness';
let schema: Awaited<ReturnType<typeof getDb>>;
let router: typeof athenaMailRouter;
beforeAll(async () => {
  schema = await getDb();
  router = (await import('../../src/routes/athena-mail')).default;
});

async function ownerFixture(verified = true) {
  const owner = await seedUserWithHub(schema.db, schema, 'HttpMailOwner');
  const { orgId, humanActorId } = await seedBaseOrg(schema.db, schema);
  await schema.db
    .update(schema.actor)
    .set({ userId: owner })
    .where(eq(schema.actor.id, humanActorId));
  await schema.db
    .update(schema.user)
    .set({ emailVerified: verified })
    .where(eq(schema.user.id, owner));
  const [account] = await schema.db.select().from(schema.user).where(eq(schema.user.id, owner));
  return {
    owner,
    orgId,
    email: assertDefined(account).email,
    app: appWithSession(router, fakeSession(owner)),
  };
}
function settingsRequest(organizationId: string | null, enabled: boolean) {
  return {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled, ownerRepliesEnabled: enabled, organizationId }),
  };
}
async function enrolledHttpOwner() {
  const fixture = await ownerFixture();
  const response = await fixture.app.request('/channel', settingsRequest(fixture.orgId, true));
  expect(response.status).toBe(200);
  return { ...fixture, mailbox: await ensureMailbox(fixture.owner) };
}
async function privateFileFixture() {
  const fixture = await enrolledHttpOwner();
  const bytes = new TextEncoder().encode('# Private plan\nVenue seats 40 people.');
  const filename = 'Résumé plan.md';
  const [message] = await schema.db
    .insert(schema.athenaInboundMessage)
    .values({
      ownerUserId: fixture.owner,
      mailboxId: fixture.mailbox.id,
      organizationId: fixture.orgId,
      provider: 'fixture',
      providerMessageId: `http-file-${fixture.mailbox.id}`,
      fromAddress: fixture.email,
      toAddress: `${fixture.mailbox.key}@inbox.athena.docket.localhost`,
      title: 'Private planning notes',
      channelRevision: fixture.mailbox.revision,
    })
    .returning();
  const messageId = assertDefined(message).id;
  const digest = mailAttachmentDigest(bytes);
  const blobKey = `athena-mail/${fixture.owner}/${messageId}/${digest}`;
  await getContainer().blob.put(blobKey, bytes, 'text/markdown');
  await schema.db
    .update(schema.athenaInboundMessage)
    .set({
      attachments: [
        {
          id: 'plan-file',
          filename,
          contentType: 'text/markdown',
          status: 'ready',
          digest,
          size: bytes.byteLength,
          blobKey,
        },
      ],
    })
    .where(eq(schema.athenaInboundMessage.id, messageId));
  return {
    ...fixture,
    bytes,
    filename,
    blobKey,
    messageId,
    path: `/channel/attachments/${messageId}/plan-file`,
  };
}

describe('native email channel HTTP setup', () => {
  it('reads disabled defaults, enrolls the persisted verified owner, then disables without a workspace', async () => {
    const fixture = await ownerFixture();
    const initial = await fixture.app.request('/channel');
    expect(initial.status).toBe(200);
    expect(AthenaMailChannelOut.parse(await initial.json())).toMatchObject({
      enabled: false,
      ownerRepliesEnabled: false,
      ownerAddress: fixture.email,
      configured: true,
    });
    const enabled = await fixture.app.request('/channel', settingsRequest(fixture.orgId, true));
    expect(enabled.status).toBe(200);
    const settings = AthenaMailChannelOut.parse(await enabled.json());
    expect(settings).toMatchObject({
      enabled: true,
      ownerRepliesEnabled: true,
      organizationId: fixture.orgId,
      ownerAddress: fixture.email,
    });
    expect(settings.address).toMatch(/@inbox\.athena\.docket\.localhost$/);
    const disabled = await fixture.app.request('/channel', settingsRequest(null, false));
    expect(disabled.status).toBe(200);
    expect(AthenaMailChannelOut.parse(await disabled.json())).toMatchObject({
      enabled: false,
      ownerRepliesEnabled: false,
      organizationId: null,
    });
    const reread = await fixture.app.request('/channel');
    expect(AthenaMailChannelOut.parse(await reread.json()).enabled).toBe(false);
  });

  it('does not trust the session display emailVerified flag instead of persisted account verification', async () => {
    const fixture = await ownerFixture(false);
    const response = await fixture.app.request('/channel', settingsRequest(fixture.orgId, true));
    expect(response.status).toBe(409);
    const reread = await fixture.app.request('/channel');
    expect(AthenaMailChannelOut.parse(await reread.json())).toMatchObject({
      enabled: false,
      ownerAddress: null,
    });
  });

  it('rejects malformed settings and cannot select another owner through the request body', async () => {
    const mine = await ownerFixture();
    const other = await enrolledHttpOwner();
    expect(
      (
        await mine.app.request('/channel', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: 'yes' }),
        })
      ).status,
    ).toBe(422);
    const spoof = await mine.app.request('/channel', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        enabled: true,
        ownerRepliesEnabled: true,
        organizationId: other.orgId,
        ownerUserId: other.owner,
      }),
    });
    expect(spoof.status).toBe(404);
    const untouched = await other.app.request('/channel');
    expect(AthenaMailChannelOut.parse(await untouched.json())).toMatchObject({
      enabled: true,
      ownerAddress: other.email,
    });
    const mineSettings = await mine.app.request('/channel');
    expect(AthenaMailChannelOut.parse(await mineSettings.json()).enabled).toBe(false);
  });

  it.each([
    ['/channel', 'GET'],
    ['/channel', 'PUT'],
    ['/channel/outbox', 'GET'],
    ['/channel/attachments/message/file', 'GET'],
  ] as const)('requires authentication for %s %s', async (path, method) => {
    const anonymous = appWithSession(router, null);
    const request = method === 'PUT' ? settingsRequest(null, false) : { method };
    expect((await anonymous.request(path, request)).status).toBe(401);
  });
});

describe('native email delivery HTTP visibility', () => {
  it('shows only the caller’s outbox, retaining provider acceptance versus confirmed delivery', async () => {
    const mine = await enrolledHttpOwner();
    const other = await enrolledHttpOwner();
    const [mineIntent] = await schema.db
      .insert(schema.athenaMailOutbox)
      .values({
        ownerUserId: mine.owner,
        mailboxId: mine.mailbox.id,
        channelRevision: mine.mailbox.revision,
        toAddress: mine.email,
        subject: 'Mine',
        bodyText: 'Private owner result.',
        status: 'sent',
        providerMessageId: 'http-owner-accepted',
        sentAt: new Date(),
      })
      .returning();
    const [otherIntent] = await schema.db
      .insert(schema.athenaMailOutbox)
      .values({
        ownerUserId: other.owner,
        mailboxId: other.mailbox.id,
        channelRevision: other.mailbox.revision,
        toAddress: other.email,
        subject: 'Another owner',
        bodyText: 'Do not disclose.',
        status: 'delivered',
      })
      .returning();
    const mineResponse = await mine.app.request('/channel/outbox');
    expect(mineResponse.status).toBe(200);
    const minePage = pageOf(AthenaMailOutboxOut).parse(await mineResponse.json());
    expect(minePage.items.map((row) => row.id)).toEqual([assertDefined(mineIntent).id]);
    expect(minePage.items[0]?.status).toBe('sent');
    const otherResponse = await other.app.request('/channel/outbox');
    const otherPage = pageOf(AthenaMailOutboxOut).parse(await otherResponse.json());
    expect(otherPage.items.map((row) => row.id)).toEqual([assertDefined(otherIntent).id]);
    expect(otherPage.items[0]?.status).toBe('delivered');
  });
});

describe('private native mail attachment HTTP boundary', () => {
  it('streams exact private bytes with download-only headers and no public storage URL', async () => {
    const fixture = await privateFileFixture();
    try {
      const response = await fixture.app.request(fixture.path);
      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('application/octet-stream');
      expect(response.headers.get('Content-Disposition')).toBe(
        `attachment; filename*=UTF-8''${encodeURIComponent(fixture.filename)}`,
      );
      expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
      expect(response.headers.get('Cache-Control')).toBe('private, no-store');
      expect(response.headers.get('Location')).toBeNull();
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(fixture.bytes);
    } finally {
      await getContainer().blob.delete(fixture.blobKey);
    }
  });

  it.each([
    'other-owner',
    'revoked',
    'missing-message',
    'missing-attachment',
    'missing-bytes',
    'changed-bytes',
  ] as const)('returns absent without disclosing private bytes for %s', async (boundary) => {
    const fixture = await privateFileFixture();
    try {
      const other = boundary === 'other-owner' ? await ownerFixture() : null;
      if (boundary === 'revoked')
        expect((await fixture.app.request('/channel', settingsRequest(null, false))).status).toBe(
          200,
        );
      if (boundary === 'missing-bytes') await getContainer().blob.delete(fixture.blobKey);
      if (boundary === 'changed-bytes')
        await getContainer().blob.put(
          fixture.blobKey,
          new TextEncoder().encode('Different bytes'),
          'text/plain',
        );
      const path =
        boundary === 'missing-message'
          ? '/channel/attachments/unknown-message/plan-file'
          : boundary === 'missing-attachment'
            ? `/channel/attachments/${fixture.messageId}/unknown-file`
            : fixture.path;
      const response = await (other?.app ?? fixture.app).request(path);
      expect(response.status).toBe(404);
      expect(response.headers.get('Content-Disposition')).toBeNull();
      expect(await response.text()).not.toContain('Venue seats 40 people.');
    } finally {
      await getContainer().blob.delete(fixture.blobKey);
    }
  });
});
