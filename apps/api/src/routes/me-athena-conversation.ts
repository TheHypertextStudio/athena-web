/**
 * `@docket/api` — browsing one endless Athena conversation: topics, keywords, dates.
 *
 * @remarks
 * A conversation that never ends cannot be navigated by scrolling. Three access paths make it
 * navigable and they compose: automatically derived topic segments, exact keyword search with
 * the matched span reported, and an inclusive date range.
 *
 * Segmentation is a *derivation cached in the database*, never user data. It is recomputed from
 * `session_activity` on read when the conversation has moved on, written as a new revision, and
 * the previous revision is deleted in the same transaction — so a reader sees one whole
 * segmentation or the previous one, never half of each. Nothing a person wrote is stored here,
 * which is why dropping the table is a performance event and not a data loss event.
 *
 * There is no "new topic" control anywhere in this file, and that is the point: pressing one is
 * the chore the derivation exists to remove.
 */
import { agentSession, athenaConversationSegment, db, sessionActivity } from '@docket/db';
import { LexicalCohesionSegmenter, searchConversation } from '@docket/agent-runtime';
import type { ConversationMessage, ConversationSegment } from '@docket/agent-runtime';
import { and, asc, count, desc, eq, gte, inArray, lte, ne } from 'drizzle-orm';
import { z } from 'zod';

/** How many activities one segmentation pass reads. Older history keeps its stored revision. */
const SEGMENTATION_WINDOW = 2_000;

/** Longest search result page. */
const SEARCH_LIMIT_MAX = 100;

/** The shared segmenter. Stateless, so one instance serves every request. */
const segmenter = new LexicalCohesionSegmenter();

/** One derived topic span, as the API returns it. */
export const AthenaSegmentOut = z.object({
  /** Stable row id for this segment in the current revision. */
  id: z.string(),
  /** Position in the conversation, oldest first. */
  ordinal: z.number().int(),
  /** Derived name, taken from what the person asked when the topic opened. */
  title: z.string(),
  /** The terms that distinguish this span from the rest of the conversation. */
  keywords: z.array(z.string()),
  /** First activity in the span; jump here to browse it. */
  startActivityId: z.string(),
  /** Last activity in the span. */
  endActivityId: z.string(),
  /** When the span opened. */
  startedAt: z.string(),
  /** When the span last had activity. */
  endedAt: z.string(),
  /** How many visible activities the span covers. */
  messageCount: z.number().int(),
  /** How sharp the topic change at this span's start was, 0–100. */
  boundaryScore: z.number().int(),
});

/** The automatically derived table of contents for one conversation. */
export const AthenaSegmentsOut = z.object({
  /** The conversation these segments describe. */
  sessionId: z.string(),
  /** Which recomputation produced them. */
  revision: z.number().int(),
  /** The segments, oldest first. */
  items: z.array(AthenaSegmentOut),
});

/** One matched message. */
export const AthenaSearchHitOut = z.object({
  /** The matched activity. */
  activityId: z.string(),
  /** The conversation it belongs to. */
  sessionId: z.string(),
  /** Who wrote it. */
  author: z.enum(['user', 'athena']),
  /** The message text, as stored. */
  text: z.string(),
  /** When it was written. */
  createdAt: z.string(),
  /** Character ranges in `text` that matched, so the caller can highlight exactly those. */
  highlights: z.array(z.object({ start: z.number().int(), end: z.number().int() })),
  /** True when the message literally contains a query term. */
  lexical: z.boolean(),
});

/** A conversation search result. */
export const AthenaSearchOut = z.object({
  /** Matches, best first. */
  items: z.array(AthenaSearchHitOut),
  /** How many matched before the limit was applied. */
  total: z.number().int(),
  /**
   * True when meaning-level ranking ran.
   *
   * @remarks
   * Reported rather than assumed. Keyword and date filtering are exact and always available;
   * meaning-level ranking needs an embedding backend, and claiming it ran when it did not would
   * make an empty result look like an answer.
   */
  semantic: z.boolean(),
  /** The normalized query terms; empty for a date-only query. */
  terms: z.array(z.string()),
});

/** Query parameters for conversation search. */
export const conversationSearchQuery = z.object({
  /** Free text. Omit for a date-only query. */
  q: z.string().optional(),
  /** Inclusive lower bound, ISO-8601. */
  from: z.iso.datetime({ offset: true }).optional(),
  /** Inclusive upper bound, ISO-8601. */
  to: z.iso.datetime({ offset: true }).optional(),
  /** Page size. */
  limit: z.coerce.number().int().min(1).max(SEARCH_LIMIT_MAX).default(50),
});

/** Text and author of one visible activity, or `null` when it carries no readable text. */
function messageFrom(row: typeof sessionActivity.$inferSelect): ConversationMessage | null {
  const text = typeof row.body.text === 'string' ? row.body.text : '';
  if (text.trim().length === 0) return null;
  return {
    id: row.id,
    role: row.body.author === 'user' ? 'user' : 'agent',
    text,
    at: row.createdAt,
  };
}

/** Load the visible, readable messages of one conversation, oldest first. */
async function conversationMessages(
  sessionId: string,
  limit = SEGMENTATION_WINDOW,
): Promise<
  readonly (ConversationMessage & { readonly row: typeof sessionActivity.$inferSelect })[]
> {
  const rows = await db
    .select()
    .from(sessionActivity)
    .where(
      and(
        eq(sessionActivity.sessionId, sessionId),
        ne(sessionActivity.type, 'thought'),
        ne(sessionActivity.type, 'error'),
      ),
    )
    .orderBy(asc(sessionActivity.createdAt), asc(sessionActivity.id))
    .limit(limit);
  return rows.flatMap((row) => {
    const message = messageFrom(row);
    return message ? [{ ...message, row }] : [];
  });
}

/** Scale a 0–2 boundary depth onto the 0–100 integer the API and the database carry. */
function scaleBoundary(score: number): number {
  return Math.max(0, Math.min(100, Math.round((score / 2) * 100)));
}

/**
 * Return the conversation's automatically derived topic segments, recomputing when stale.
 *
 * @remarks
 * Staleness is measured by message count rather than by a timestamp: the segmentation is a pure
 * function of the messages, so the same count means the same answer, and recomputing is cheap
 * enough that a mismatch is simply recomputed rather than scheduled.
 *
 * @param ownerUserId - The conversation's owner.
 * @param sessionId - The conversation.
 * @returns the live revision's segments, oldest first.
 */
export async function athenaConversationSegments(
  ownerUserId: string,
  sessionId: string,
): Promise<z.input<typeof AthenaSegmentsOut>> {
  const messages = await conversationMessages(sessionId);
  const [stored, covered] = await Promise.all([
    db
      .select()
      .from(athenaConversationSegment)
      .where(eq(athenaConversationSegment.sessionId, sessionId))
      .orderBy(desc(athenaConversationSegment.revision), asc(athenaConversationSegment.ordinal)),
    db
      .select({ total: count() })
      .from(athenaConversationSegment)
      .where(eq(athenaConversationSegment.sessionId, sessionId)),
  ]);
  const liveRevision = stored[0]?.revision ?? 0;
  const live = stored.filter((row) => row.revision === liveRevision);
  const storedMessages = live.reduce((sum, row) => sum + row.messageCount, 0);
  void covered;

  if (live.length > 0 && storedMessages === messages.length) {
    return {
      sessionId,
      revision: liveRevision,
      items: live.map(toSegmentOut),
    };
  }

  const derived = segmenter.segment(messages);
  const revision = liveRevision + 1;
  const written = await db.transaction(async (tx) => {
    if (derived.length === 0) {
      await tx
        .delete(athenaConversationSegment)
        .where(eq(athenaConversationSegment.sessionId, sessionId));
      return [];
    }
    const rows = await tx
      .insert(athenaConversationSegment)
      .values(
        derived.map((segment: ConversationSegment, index) => ({
          sessionId,
          ownerUserId,
          revision,
          ordinal: index,
          title: segment.title,
          keywords: [...segment.keywords],
          startActivityId: segment.startId,
          endActivityId: segment.endId,
          startedAt: segment.startedAt,
          endedAt: segment.endedAt,
          messageCount: segment.messageCount,
          boundaryScore: scaleBoundary(segment.boundaryScore),
        })),
      )
      .returning();
    await tx
      .delete(athenaConversationSegment)
      .where(
        and(
          eq(athenaConversationSegment.sessionId, sessionId),
          ne(athenaConversationSegment.revision, revision),
        ),
      );
    return rows;
  });

  return { sessionId, revision, items: written.map(toSegmentOut) };
}

/** Project one stored segment row onto the API shape. */
function toSegmentOut(
  row: typeof athenaConversationSegment.$inferSelect,
): z.input<typeof AthenaSegmentOut> {
  return {
    id: row.id,
    ordinal: row.ordinal,
    title: row.title,
    keywords: row.keywords,
    startActivityId: row.startActivityId,
    endActivityId: row.endActivityId,
    startedAt: row.startedAt.toISOString(),
    endedAt: row.endedAt.toISOString(),
    messageCount: row.messageCount,
    boundaryScore: row.boundaryScore,
  };
}

/**
 * Search the caller's whole Athena history by keyword, by date, or by both.
 *
 * @remarks
 * Scoped to the caller's own sessions by an explicit id list rather than by a join, so a
 * conversation that is not theirs cannot appear even if a future index change alters the join.
 *
 * @param ownerUserId - The searching owner.
 * @param query - Term and/or date constraints.
 * @param sessionId - Restrict to one conversation; omit to search every conversation they own.
 * @returns matches, best first, with the matched spans reported.
 */
export async function athenaConversationSearch(
  ownerUserId: string,
  query: z.infer<typeof conversationSearchQuery>,
  sessionId?: string,
): Promise<z.input<typeof AthenaSearchOut>> {
  const owned = await db
    .select({ id: agentSession.id })
    .from(agentSession)
    .where(
      and(
        eq(agentSession.executorKind, 'athena'),
        eq(agentSession.ownerUserId, ownerUserId),
        ...(sessionId ? [eq(agentSession.id, sessionId)] : []),
      ),
    );
  const sessionIds = owned.map((row) => row.id);
  if (sessionIds.length === 0) {
    return { items: [], total: 0, semantic: false, terms: [] };
  }

  const from = query.from ? new Date(query.from) : undefined;
  const to = query.to ? new Date(query.to) : undefined;
  const rows = await db
    .select()
    .from(sessionActivity)
    .where(
      and(
        inArray(sessionActivity.sessionId, sessionIds),
        ne(sessionActivity.type, 'thought'),
        ne(sessionActivity.type, 'error'),
        ...(from ? [gte(sessionActivity.createdAt, from)] : []),
        ...(to ? [lte(sessionActivity.createdAt, to)] : []),
      ),
    )
    .orderBy(desc(sessionActivity.createdAt), desc(sessionActivity.id));

  const bySession = new Map(rows.map((row) => [row.id, row]));
  const messages = rows.flatMap((row) => {
    const message = messageFrom(row);
    return message ? [message] : [];
  });
  const result = searchConversation(
    messages,
    {
      ...(query.q ? { text: query.q } : {}),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
    },
    { limit: query.limit },
  );

  return {
    items: result.hits.flatMap((hit) => {
      const row = bySession.get(hit.message.id);
      if (!row) return [];
      return [
        {
          activityId: hit.message.id,
          sessionId: row.sessionId,
          author: hit.message.role === 'user' ? ('user' as const) : ('athena' as const),
          text: hit.message.text,
          createdAt: hit.message.at.toISOString(),
          highlights: hit.highlights.map((span) => ({ start: span.start, end: span.end })),
          lexical: hit.lexical,
        },
      ];
    }),
    total: result.total,
    semantic: result.semantic,
    terms: [...result.terms],
  };
}
