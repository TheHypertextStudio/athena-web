/**
 * `@docket/api` — Slack per-user relevance (the "which connected users does this message
 * concern" resolver consumed by the event drain).
 *
 * @remarks
 * Slack events arrive per **workspace**, not per user: the shared app's user-token event
 * subscriptions deliver every message any authorizing user can see, and Docket must decide
 * whom each message concerns. The classification (strongest first, mirroring
 * `RELEVANCE_RANK` in `routing.ts`):
 *
 * 1. `mention` — the message text `<@U…>`-mentions the user's connected Slack id.
 * 2. `mention` — the message is a DM / group DM to the user (`channel_type` `im`/`mpim`);
 *    gated by the payload's `authorizations` when present so one user's DM never fans out to
 *    every connected user of the workspace.
 * 3. `participant` — the message replies in a thread the user previously posted in, per the
 *    `thread_participation` memory ({@link recordSlackParticipation}).
 *
 * The observer (`packages/integrations`) stays pure — it emits raw Slack facts (mentioned ids,
 * channel type, thread ts); everything here is the DB-aware half: the Slack-id → Docket-user
 * map from connected integrations, and the thread-participation lookup. The resolved map feeds
 * `RoutableEvent.externalUserRecipients`, keeping `routing.ts` the single relevance authority.
 */
import { actor, db, integration, threadParticipation } from '@docket/db';
import { asRecord, slackMentionedUserIds, str } from '@docket/integrations';
import type { StreamRelevance } from '@docket/types';
import { and, eq, inArray, sql } from 'drizzle-orm';

/** The Slack facts one normalized message draft carries, as the drain extracts them. */
export interface SlackMessageFacts {
  /** The workspace the message belongs to (`T…`), from the payload's `team_id`. */
  readonly teamId: string;
  /** The conversation the message was posted in. */
  readonly channelId: string;
  /** The Slack conversation type (`im` | `mpim` | `channel` | `group`), when known. */
  readonly channelType: string | null;
  /** The parent thread root ts, or null for a top-level message. */
  readonly threadTs: string | null;
  /** The message's own ts — a top-level message roots a thread under its own ts. */
  readonly ts: string | null;
  /** The author's Slack user id, when known. */
  readonly authorSlackId: string | null;
  /** Slack user ids `<@…>`-mentioned in the text (from the draft's participants). */
  readonly mentionedSlackIds: readonly string[];
  /** The user ids Slack says this delivery was authorized for (`authorizations[].user_id`). */
  readonly authorizedSlackIds: readonly string[];
}

/**
 * Extract {@link SlackMessageFacts} from a raw inbound Slack payload (the `event_callback`
 * envelope).
 *
 * @remarks
 * Reads the payload directly rather than the normalized draft's detail: the drain runs against
 * whichever {@link Observer} the environment selected, and the mock observer normalizes to a
 * `generic` detail — routing facts must not depend on that. Mentions are parsed with the same
 * shared {@link slackMentionedUserIds} the real observer uses.
 *
 * @param payload - The raw inbound event payload.
 * @returns the facts, or `null` when the payload doesn't describe a Slack message in a channel.
 */
export function slackMessageFacts(payload: unknown): SlackMessageFacts | null {
  const body = asRecord(payload);
  const teamId = str(body, 'team_id');
  const ev = asRecord(body?.['event']);
  const channelId = str(ev, 'channel');
  if (!teamId || !ev || !channelId) return null;
  const authorizations = Array.isArray(body?.['authorizations']) ? body['authorizations'] : [];
  const authorizedSlackIds = authorizations.flatMap((a) => {
    const id = str(asRecord(a), 'user_id');
    return id ? [id] : [];
  });
  return {
    teamId,
    channelId,
    channelType: str(ev, 'channel_type') ?? null,
    threadTs: str(ev, 'thread_ts') ?? null,
    ts: str(ev, 'ts') ?? null,
    authorSlackId: str(ev, 'user') ?? null,
    mentionedSlackIds: slackMentionedUserIds(str(ev, 'text') ?? ''),
    authorizedSlackIds,
  };
}

/**
 * The org's connected Slack identities for a workspace: Slack user id → Docket user id.
 *
 * @remarks
 * One entry per user who completed the Slack connect flow (a `connected` integration whose
 * `externalAccountId` is their Slack id), resolved to their Better Auth user via the
 * integration's `createdBy` Actor. The drain caches this per `(org, team)` per sweep.
 */
export async function connectedSlackUsers(
  organizationId: string,
  teamId: string,
): Promise<Map<string, string>> {
  const rows = await db
    .select({ slackId: integration.externalAccountId, userId: actor.userId })
    .from(integration)
    .innerJoin(actor, eq(actor.id, integration.createdBy))
    .where(
      and(
        eq(integration.organizationId, organizationId),
        eq(integration.provider, 'slack'),
        eq(integration.status, 'connected'),
        sql`${integration.connection}->>'externalWorkspaceId' = ${teamId}`,
      ),
    );
  const map = new Map<string, string>();
  for (const row of rows) {
    if (row.slackId && row.userId) map.set(row.slackId, row.userId);
  }
  return map;
}

/**
 * Remember that a connected user posted in a thread (or started one), so later replies can
 * resolve `participant` relevance. Idempotent per (thread, user); refreshes `lastSeenAt`.
 *
 * @param organizationId - The org the routed inbound event belongs to.
 * @param facts - The message facts; a top-level message registers under its own `ts`.
 */
export async function recordSlackParticipation(
  organizationId: string,
  facts: SlackMessageFacts,
): Promise<void> {
  const rootTs = facts.threadTs ?? facts.ts;
  if (!facts.authorSlackId || !rootTs) return;
  await db
    .insert(threadParticipation)
    .values({
      organizationId,
      provider: 'slack',
      externalWorkspaceId: facts.teamId,
      channelId: facts.channelId,
      threadTs: rootTs,
      externalUserId: facts.authorSlackId,
      lastSeenAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [
        threadParticipation.organizationId,
        threadParticipation.provider,
        threadParticipation.externalWorkspaceId,
        threadParticipation.channelId,
        threadParticipation.threadTs,
        threadParticipation.externalUserId,
      ],
      set: { lastSeenAt: new Date() },
    });
}

/**
 * Resolve which connected users a Slack message concerns, and why.
 *
 * @param organizationId - The org the (already routed) inbound event belongs to.
 * @param facts - The message facts.
 * @param connected - The workspace's Slack-id → Docket-user map ({@link connectedSlackUsers}).
 * @returns `userId → reason`, strongest reason per user; empty when the message concerns nobody.
 */
export async function resolveSlackRecipients(
  organizationId: string,
  facts: SlackMessageFacts,
  connected: ReadonlyMap<string, string>,
): Promise<Map<string, StreamRelevance>> {
  const recipients = new Map<string, StreamRelevance>();
  if (connected.size === 0) return recipients;

  const isDm = facts.channelType === 'im' || facts.channelType === 'mpim';
  const nonAuthorIds = [...connected.keys()].filter((id) => id !== facts.authorSlackId);

  // Thread lookup: one indexed query answers "which candidate ids posted in this thread".
  let threadParticipants: ReadonlySet<string> = new Set();
  if (facts.threadTs && nonAuthorIds.length > 0) {
    const rows = await db
      .select({ externalUserId: threadParticipation.externalUserId })
      .from(threadParticipation)
      .where(
        and(
          eq(threadParticipation.organizationId, organizationId),
          eq(threadParticipation.provider, 'slack'),
          eq(threadParticipation.externalWorkspaceId, facts.teamId),
          eq(threadParticipation.channelId, facts.channelId),
          eq(threadParticipation.threadTs, facts.threadTs),
          inArray(threadParticipation.externalUserId, nonAuthorIds),
        ),
      );
    threadParticipants = new Set(rows.map((r) => r.externalUserId));
  }

  for (const [slackId, userId] of connected) {
    if (slackId === facts.authorSlackId) continue; // never self-notify
    if (facts.mentionedSlackIds.includes(slackId)) {
      recipients.set(userId, 'mention');
      continue;
    }
    if (isDm && dmConcerns(slackId, facts, nonAuthorIds)) {
      recipients.set(userId, 'mention');
      continue;
    }
    if (threadParticipants.has(slackId)) recipients.set(userId, 'participant');
  }
  return recipients;
}

/**
 * Whether a DM/group-DM delivery concerns a given connected user.
 *
 * @remarks
 * An `im` event only reaches Docket because *some* authorizing user is party to the DM, but the
 * payload's `authorizations` array names at most a few of them — so with several connected
 * users in one workspace, fanning to all of them would leak DMs. The gate: the user must appear
 * in `authorizations`, or be the only connected non-author (the unambiguous case). The full fix
 * (`apps.event.authorizations.list`) is a noted follow-up.
 */
function dmConcerns(
  slackId: string,
  facts: SlackMessageFacts,
  nonAuthorIds: readonly string[],
): boolean {
  if (facts.authorizedSlackIds.length > 0) return facts.authorizedSlackIds.includes(slackId);
  return nonAuthorIds.length === 1 && nonAuthorIds[0] === slackId;
}
