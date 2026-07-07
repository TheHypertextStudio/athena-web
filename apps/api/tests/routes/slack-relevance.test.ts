/**
 * `@docket/api` — Slack relevance unit tests: payload fact extraction, the connected-user map,
 * thread-participation memory, and the per-user classification matrix (mention / DM / thread).
 */
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import type * as SlackRelevance from '../../src/consumers/slack-relevance';
import { getDb, one, seedBaseOrg, seedUserWithHub } from '../support/routes-harness';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let mod!: typeof SlackRelevance;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  mod = await import('../../src/consumers/slack-relevance');
});

/** A minimal Slack event_callback payload around one message event. */
function payloadFor(event: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return { type: 'event_callback', team_id: 'T1', event, ...extra };
}

/** Seed a user + linked actor + connected Slack integration; returns the Docket user id. */
async function seedConnected(orgId: string, slackId: string): Promise<string> {
  const userId = await seedUserWithHub(db, schema, `u-${slackId}`);
  const a = one(
    await db
      .insert(schema.actor)
      .values({ organizationId: orgId, kind: 'human', displayName: slackId, userId })
      .returning({ id: schema.actor.id }),
  );
  await db.insert(schema.integration).values({
    organizationId: orgId,
    provider: 'slack',
    pattern: 'connector',
    roles: ['signal'],
    status: 'connected',
    externalAccountId: slackId,
    connection: { externalWorkspaceId: 'T1' },
    createdBy: a.id,
  });
  return userId;
}

describe('slackMessageFacts', () => {
  it('extracts team/channel/thread/author/mentions/authorizations from a raw payload', () => {
    const facts = mod.slackMessageFacts(
      payloadFor(
        {
          type: 'message',
          channel: 'C1',
          channel_type: 'channel',
          user: 'UAAA1',
          text: 'ping <@UBBB2> and <@WCCC3|carla>',
          ts: '100.1',
          thread_ts: '99.9',
        },
        { authorizations: [{ user_id: 'UBBB2' }] },
      ),
    );
    expect(facts).toEqual({
      teamId: 'T1',
      channelId: 'C1',
      channelType: 'channel',
      threadTs: '99.9',
      ts: '100.1',
      authorSlackId: 'UAAA1',
      mentionedSlackIds: ['UBBB2', 'WCCC3'],
      authorizedSlackIds: ['UBBB2'],
    });
  });

  it('returns null for payloads without a team or channel (e.g. the handshake)', () => {
    expect(mod.slackMessageFacts({ type: 'url_verification', challenge: 'c' })).toBeNull();
    expect(mod.slackMessageFacts(payloadFor({ type: 'app_home_opened' }))).toBeNull();
  });
});

describe('connectedSlackUsers', () => {
  it('maps only connected slack integrations of the workspace to their users', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const userA = await seedConnected(orgId, 'UAAA1');
    // A pending (never completed) connect must not contribute an identity.
    await db.insert(schema.integration).values({
      organizationId: orgId,
      provider: 'slack',
      pattern: 'connector',
      roles: ['signal'],
      status: 'pending',
      externalAccountId: 'UPEND9',
      connection: { externalWorkspaceId: 'T1' },
      createdBy: humanActorId,
    });
    const map = await mod.connectedSlackUsers(orgId, 'T1');
    expect(map.get('UAAA1')).toBe(userA);
    expect(map.has('UPEND9')).toBe(false);
    expect((await mod.connectedSlackUsers(orgId, 'T-OTHER')).size).toBe(0);
  });
});

describe('recordSlackParticipation', () => {
  it('upserts one row per (thread, user), rooting top-level messages under their own ts', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const facts = mod.slackMessageFacts(
      payloadFor({ type: 'message', channel: 'C1', user: 'UAAA1', text: 'root', ts: '100.1' }),
    );
    expect(facts).not.toBeNull();
    await mod.recordSlackParticipation(orgId, facts!);
    await mod.recordSlackParticipation(orgId, facts!);
    const rows = await db
      .select()
      .from(schema.threadParticipation)
      .where(
        and(
          eq(schema.threadParticipation.organizationId, orgId),
          eq(schema.threadParticipation.channelId, 'C1'),
        ),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.threadTs).toBe('100.1');
    expect(rows[0]!.externalUserId).toBe('UAAA1');
  });
});

describe('resolveSlackRecipients', () => {
  it('classifies mentions, excludes the author, and ignores unconnected mention targets', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const userA = await seedConnected(orgId, 'UAAA1');
    const userB = await seedConnected(orgId, 'UBBB2');
    const connected = await mod.connectedSlackUsers(orgId, 'T1');
    const facts = mod.slackMessageFacts(
      payloadFor({
        type: 'message',
        channel: 'C1',
        channel_type: 'channel',
        user: 'UAAA1',
        text: 'ping <@UAAA1> <@UBBB2> <@UZZZ9>',
        ts: '1.1',
      }),
    );
    const recipients = await mod.resolveSlackRecipients(orgId, facts!, connected);
    // The author never self-notifies (even self-mentioned); the unconnected id contributes nothing.
    expect(recipients.get(userB)).toBe('mention');
    expect(recipients.has(userA)).toBe(false);
    expect(recipients.size).toBe(1);
  });

  it('treats a DM to the sole connected non-author as a mention-strength signal', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const userA = await seedConnected(orgId, 'UAAA1');
    const connected = await mod.connectedSlackUsers(orgId, 'T1');
    const facts = mod.slackMessageFacts(
      payloadFor({
        type: 'message',
        channel: 'D1',
        channel_type: 'im',
        user: 'UZZZ9',
        text: 'psst',
        ts: '2.1',
      }),
    );
    const recipients = await mod.resolveSlackRecipients(orgId, facts!, connected);
    expect(recipients.get(userA)).toBe('mention');
  });

  it('gates DM fan-out by authorizations when several users are connected', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const userA = await seedConnected(orgId, 'UAAA1');
    const userB = await seedConnected(orgId, 'UBBB2');
    const connected = await mod.connectedSlackUsers(orgId, 'T1');
    const dm = (extra: Record<string, unknown>) =>
      mod.slackMessageFacts(
        payloadFor(
          {
            type: 'message',
            channel: 'D2',
            channel_type: 'im',
            user: 'UZZZ9',
            text: 'x',
            ts: '3.1',
          },
          extra,
        ),
      );
    // Authorizations name UAAA1 → only that user concerns.
    const gated = await mod.resolveSlackRecipients(
      orgId,
      dm({ authorizations: [{ user_id: 'UAAA1' }] })!,
      connected,
    );
    expect(gated.get(userA)).toBe('mention');
    expect(gated.has(userB)).toBe(false);
    // No authorizations + two candidates → ambiguous, nobody fans out (DMs must never leak).
    const ambiguous = await mod.resolveSlackRecipients(orgId, dm({})!, connected);
    expect(ambiguous.size).toBe(0);
  });

  it('routes thread replies to prior participants as participant relevance', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const userA = await seedConnected(orgId, 'UAAA1');
    const connected = await mod.connectedSlackUsers(orgId, 'T1');
    // A (connected) posts a top-level message; its ts roots the thread.
    const root = mod.slackMessageFacts(
      payloadFor({ type: 'message', channel: 'C9', user: 'UAAA1', text: 'root', ts: '50.0' }),
    );
    await mod.recordSlackParticipation(orgId, root!);
    // Later an unconnected user replies in that thread.
    const reply = mod.slackMessageFacts(
      payloadFor({
        type: 'message',
        channel: 'C9',
        channel_type: 'channel',
        user: 'UZZZ9',
        text: 'reply',
        ts: '51.0',
        thread_ts: '50.0',
      }),
    );
    const recipients = await mod.resolveSlackRecipients(orgId, reply!, connected);
    expect(recipients.get(userA)).toBe('participant');
    // A reply in an unrelated thread concerns nobody.
    const other = mod.slackMessageFacts(
      payloadFor({
        type: 'message',
        channel: 'C9',
        channel_type: 'channel',
        user: 'UZZZ9',
        text: 'reply',
        ts: '52.0',
        thread_ts: '49.0',
      }),
    );
    expect((await mod.resolveSlackRecipients(orgId, other!, connected)).size).toBe(0);
  });
});
