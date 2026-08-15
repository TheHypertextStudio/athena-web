/**
 * Direct unit coverage for `src/routes/athena-mail-store.ts` exports that the end-to-end
 * `inbound-mail.test.ts` suite does not reach: the key-minting rejection loop, dedupe in
 * recipient resolution, the zero-id short circuits, the `metadata-only`/anonymous-sender
 * projection branches, the mailbox-creation race, and the orphaned/mixed-subject-type paths of
 * `listAttachmentTargets`.
 */
import type * as DbModule from '@docket/db';
import { apiHosts } from '@docket/env/api';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as AthenaMailStoreModule from '../../src/routes/athena-mail-store';
import { getDb, one, seedBaseOrg, seedUserWithHub } from '../support/routes-harness';
import { assertDefined } from '@docket/test-utils';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let mintMailboxKey!: typeof AthenaMailStoreModule.mintMailboxKey;
let ensureMailbox!: typeof AthenaMailStoreModule.ensureMailbox;
let resolveMailboxForRecipients!: typeof AthenaMailStoreModule.resolveMailboxForRecipients;
let countAttachmentsFor!: typeof AthenaMailStoreModule.countAttachmentsFor;
let toMailMessageOut!: typeof AthenaMailStoreModule.toMailMessageOut;
let listAttachmentTargets!: typeof AthenaMailStoreModule.listAttachmentTargets;
let athenaMailHost!: typeof AthenaMailStoreModule.athenaMailHost;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  const mod = await import('../../src/routes/athena-mail-store');
  ({
    mintMailboxKey,
    ensureMailbox,
    resolveMailboxForRecipients,
    countAttachmentsFor,
    toMailMessageOut,
    listAttachmentTargets,
    athenaMailHost,
  } = mod);
});

describe('mintMailboxKey', () => {
  it('mints a 12-character key from the real crypto source', () => {
    const key = mintMailboxKey();
    expect(key).toHaveLength(12);
    expect(key).toMatch(/^[a-z0-9]+$/);
  });

  it('stops accepting bytes mid-batch once the key reaches its target length', () => {
    // A well-behaved `random` never needs more than KEY_LENGTH (12) bytes, so the loop's
    // "already long enough, stop" guard is only reachable when a caller-supplied source hands
    // back more bytes than requested in one call — exactly what this fake does.
    let calls = 0;
    const random = (): Uint8Array => {
      calls += 1;
      // 20 bytes, all well under the 32-symbol alphabet's range, so none are ever rejected.
      return new Uint8Array(20).map((_, i) => i % 26);
    };
    const key = mintMailboxKey(random);
    expect(key).toHaveLength(12);
    expect(calls).toBe(1);
  });
});

describe('athenaMailHost', () => {
  it('resolves the configured receiving host', () => {
    expect(athenaMailHost()).toBe('inbox.athena.docket.localhost');
  });
});

describe('ensureMailbox', () => {
  it('re-reads the winner’s row rather than erroring when two callers race for the same owner', async () => {
    const userId = await seedUserWithHub(db, schema, 'RacingOwner');
    const [first, second] = await Promise.all([ensureMailbox(userId), ensureMailbox(userId)]);
    expect(first.id).toBe(second.id);
    const rows = await db
      .select()
      .from(schema.athenaMailbox)
      .where(eq(schema.athenaMailbox.ownerUserId, userId));
    expect(rows).toHaveLength(1);
  });
});

describe('when Athena has no receiving domain configured', () => {
  it('reports no host, no address, and routes nothing', async () => {
    const hosts = apiHosts as unknown as Record<string, unknown>;
    const saved = hosts['athenaMail'];
    delete hosts['athenaMail'];
    try {
      expect(athenaMailHost()).toBeNull();
      const userId = await seedUserWithHub(db, schema, 'NoHostOwner');
      const mailbox = await ensureMailbox(userId);
      const { mailboxAddress } = await import('../../src/routes/athena-mail-store');
      expect(mailboxAddress(mailbox)).toBeNull();
      expect(await resolveMailboxForRecipients([`${mailbox.key}@anywhere.example`])).toBeNull();
    } finally {
      hosts['athenaMail'] = saved;
    }
  });
});

describe('resolveMailboxForRecipients', () => {
  it('returns null when none of the recipients resolve to any known mailbox', async () => {
    expect(await resolveMailboxForRecipients(['nobody@inbox.athena.docket.localhost'])).toBeNull();
  });

  it('deduplicates two +tag variants of the same address to a single candidate', async () => {
    const userId = await seedUserWithHub(db, schema, 'DedupeOwner');
    const mailbox = await ensureMailbox(userId);
    const host = athenaMailHost();
    const resolved = await resolveMailboxForRecipients([
      `${mailbox.key}+receipts@${host}`,
      `${mailbox.key}+other-tag@${host}`,
    ]);
    expect(resolved?.mailbox.id).toBe(mailbox.id);
    // The first-seen spelling of the address is the one recorded as the match.
    expect(resolved?.address).toBe(`${mailbox.key}+receipts@${host}`);
  });
});

describe('countAttachmentsFor', () => {
  it('returns an empty map for an empty id list without querying', async () => {
    expect((await countAttachmentsFor([])).size).toBe(0);
  });
});

describe('toMailMessageOut', () => {
  const baseRow: AthenaMailStoreModule.AthenaInboundMessageRow = {
    id: 'msg_test',
    organizationId: 'org_test',
    createdBy: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    archivedAt: null,
    ownerUserId: 'user_test',
    mailboxId: 'mailbox_test',
    provider: 'fixture',
    providerMessageId: 'pm_1',
    rfc822MessageId: null,
    fromAddress: 'sender@example.com',
    fromName: 'Sender Name',
    toAddress: 'key@inbox.athena.docket.localhost',
    title: 'A subject',
    bodyText: 'Body text',
    bodyHtml: null,
    snippet: 'Body text',
    bodyStatus: 'complete',
    receivedAt: new Date('2026-01-01T00:00:00.000Z'),
    attachments: [],
    streamEventId: null,
    sessionId: null,
  };

  it('reports contentStatus complete for a fully-retrieved message', () => {
    const out = toMailMessageOut(baseRow, 0);
    expect(out.contentStatus).toBe('complete');
    expect(out.source.label).toBe('Sender Name');
  });

  it('reports contentStatus metadata-only, and falls back to the address when no name was given', () => {
    const out = toMailMessageOut({ ...baseRow, bodyStatus: 'metadata-only', fromName: null }, 3);
    expect(out.contentStatus).toBe('metadata-only');
    expect(out.source.label).toBe('sender@example.com');
    expect(out.attachedCount).toBe(3);
  });
});

describe('listAttachmentTargets', () => {
  it('returns an empty array when the message has no attachments', async () => {
    expect(await listAttachmentTargets('msg_with_nothing_attached')).toEqual([]);
  });

  it('resolves a project-only attachment set (no task attachments) with the project title', async () => {
    const { orgId, statusId } = await seedBaseOrg(db, schema);
    const userId = await seedUserWithHub(db, schema, 'ProjectOnlyOwner');
    const mailbox = await ensureMailbox(userId);
    const [message] = await db
      .insert(schema.athenaInboundMessage)
      .values({
        organizationId: orgId,
        ownerUserId: userId,
        mailboxId: mailbox.id,
        provider: 'fixture',
        providerMessageId: `pm_${Math.random().toString(36).slice(2, 8)}`,
        fromAddress: 'sender@example.com',
        toAddress: 'key@inbox.athena.docket.localhost',
        title: 'Project-only',
      })
      .returning();
    const projectId = one(
      await db
        .insert(schema.project)
        .values({
          organizationId: orgId,
          name: 'Attachment target project',
          status: 'planned',
          statusId: statusId('project', 'planned'),
        })
        .returning({ id: schema.project.id }),
    ).id;
    await db.insert(schema.attachment).values({
      organizationId: orgId,
      subjectType: 'project',
      subjectId: projectId,
      kind: 'athena_email',
      title: 'Project-only',
      externalId: assertDefined(message).id,
    });

    const targets = await listAttachmentTargets(assertDefined(message).id);
    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({
      subjectType: 'project',
      subjectTitle: 'Attachment target project',
    });
  });

  it('resolves an initiative attachment with the initiative’s title', async () => {
    const { orgId, statusId } = await seedBaseOrg(db, schema);
    const userId = await seedUserWithHub(db, schema, 'InitiativeOwner');
    const mailbox = await ensureMailbox(userId);
    const [message] = await db
      .insert(schema.athenaInboundMessage)
      .values({
        organizationId: orgId,
        ownerUserId: userId,
        mailboxId: mailbox.id,
        provider: 'fixture',
        providerMessageId: `pm_${Math.random().toString(36).slice(2, 8)}`,
        fromAddress: 'sender@example.com',
        toAddress: 'key@inbox.athena.docket.localhost',
        title: 'Initiative-attached',
      })
      .returning();
    const initiativeId = one(
      await db
        .insert(schema.initiative)
        .values({
          organizationId: orgId,
          name: 'Attachment target initiative',
          status: 'active',
          statusId: statusId('initiative', 'active'),
        })
        .returning({ id: schema.initiative.id }),
    ).id;
    await db.insert(schema.attachment).values({
      organizationId: orgId,
      subjectType: 'initiative',
      subjectId: initiativeId,
      kind: 'athena_email',
      title: 'Initiative-attached',
      externalId: assertDefined(message).id,
    });

    const targets = await listAttachmentTargets(assertDefined(message).id);
    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({
      subjectType: 'initiative',
      subjectTitle: 'Attachment target initiative',
    });
  });

  it('silently drops an attachment whose subject has since been hard-deleted', async () => {
    const { orgId, teamId, statusId } = await seedBaseOrg(db, schema);
    const userId = await seedUserWithHub(db, schema, 'OrphanOwner');
    const mailbox = await ensureMailbox(userId);
    const [message] = await db
      .insert(schema.athenaInboundMessage)
      .values({
        organizationId: orgId,
        ownerUserId: userId,
        mailboxId: mailbox.id,
        provider: 'fixture',
        providerMessageId: `pm_${Math.random().toString(36).slice(2, 8)}`,
        fromAddress: 'sender@example.com',
        toAddress: 'key@inbox.athena.docket.localhost',
        title: 'Orphaned soon',
      })
      .returning();
    const [task] = await db
      .insert(schema.task)
      .values({
        organizationId: orgId,
        teamId,
        title: 'Doomed task',
        state: 'backlog',
        statusId: statusId('task', 'backlog'),
      })
      .returning({ id: schema.task.id });
    await db.insert(schema.attachment).values({
      organizationId: orgId,
      subjectType: 'task',
      subjectId: assertDefined(task).id,
      kind: 'athena_email',
      title: 'Orphaned soon',
      externalId: assertDefined(message).id,
    });
    await db.delete(schema.task).where(eq(schema.task.id, assertDefined(task).id));

    expect(await listAttachmentTargets(assertDefined(message).id)).toEqual([]);
  });
});
