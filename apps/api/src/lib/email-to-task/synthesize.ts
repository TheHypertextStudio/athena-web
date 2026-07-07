/**
 * `@docket/api` — email-to-task synthesis: turn classified threads into suggestions.
 *
 * @remarks
 * Stage two of the funnel. For each thread that passes {@link classifyTaskWorthiness} AND
 * isn't already suggested, the injected {@link TaskSynthesizer} (Athena on the real path, the
 * deterministic mock offline) drafts the task fields and a one-per-thread `email_suggestion`
 * row is written. Each new suggestion emits a `created` observation on an `email_suggestion`
 * subject, so pipeline automation rules (e.g. dismiss-promotions) run through the existing
 * Observer hook. See `docs/engineering/specs/email-to-task.md` §6.
 */
import { db, emailSuggestion } from '@docket/db';
import type { TaskSynthesizer } from '@docket/agent-runtime';
import { and, eq, inArray } from 'drizzle-orm';

import { emitEvent } from '../../routes/event-emit';
import { classifyTaskWorthiness, type ThreadSignal } from './funnel';

/** A thread to consider: the funnel signal plus its provider + RFC 5322 identity. */
export interface CandidateThread extends ThreadSignal {
  /** Provider-native thread id (Gmail `threadId`; Graph `conversationId`). */
  readonly threadId: string;
  /** Receipt time of the latest message (RFC3339), when the listing carried one. */
  readonly receivedAt?: string;
  /** RFC 5322 Message-ID of the latest message — the cross-provider dedup key. */
  readonly rfc822MessageId?: string;
  /** Canonical open-in-provider URL, captured from the provider at listing time. */
  readonly externalUrl: string;
}

/** Input to {@link persistSuggestions}. */
export interface PersistSuggestionsInput {
  readonly organizationId: string;
  readonly integrationId: string;
  readonly threads: readonly CandidateThread[];
  /** The funnel pass threshold (runtime config, not a literal). */
  readonly threshold: number;
  readonly actorId: string | null;
  /** The synthesizer that drafts each task (real Athena or the deterministic mock). */
  readonly synthesizer: TaskSynthesizer;
}

/** The outcome of one synthesis run (counters feed the sweep's structured log). */
export interface PersistSuggestionsResult {
  readonly created: number;
  readonly suggestionIds: readonly string[];
  /** Threads handed to the funnel this run. */
  readonly considered: number;
  /** Threads the funnel passed (score ≥ threshold). */
  readonly passedFunnel: number;
  /** Funnel-passing threads skipped as already suggested (thread-id or Message-ID dedup). */
  readonly skippedExisting: number;
  /** Paid model invocations this run (after all dedup). */
  readonly synthCalls: number;
}

/**
 * Classify, synthesize, and persist suggestions for a batch of threads.
 *
 * @remarks
 * Unworthy threads (below threshold, e.g. promotions) are dropped here for ~free. Threads
 * already suggested are skipped **before** synthesis — so the (potentially paid) model is
 * never re-run on a thread a previous sweep already proposed. The unique
 * `(organizationId, externalThreadId)` index is the race-safety net behind that check.
 */
export async function persistSuggestions(
  input: PersistSuggestionsInput,
): Promise<PersistSuggestionsResult> {
  // Classify once and carry the verdict through (its score/category are reused below).
  const worthy = input.threads
    .map((thread) => ({ thread, verdict: classifyTaskWorthiness(thread, input.threshold) }))
    .filter((candidate) => candidate.verdict.worthy);
  if (worthy.length === 0) {
    return {
      created: 0,
      suggestionIds: [],
      considered: input.threads.length,
      passedFunnel: 0,
      skippedExisting: 0,
      synthCalls: 0,
    };
  }

  // Pre-dedup 1: skip synthesis for threads already suggested (sweeps re-pull recent threads,
  // so without this the model would re-run on every recurring thread and the result be discarded).
  const alreadySuggested = await db
    .select({ threadId: emailSuggestion.externalThreadId })
    .from(emailSuggestion)
    .where(
      and(
        eq(emailSuggestion.organizationId, input.organizationId),
        inArray(
          emailSuggestion.externalThreadId,
          worthy.map((candidate) => candidate.thread.threadId),
        ),
      ),
    );
  const seen = new Set(alreadySuggested.map((row) => row.threadId));

  // Pre-dedup 2 (cross-provider): the same email seen through two mail providers carries the
  // same RFC 5322 Message-ID even though the provider thread ids differ — skip those too.
  const candidateMessageIds = worthy.flatMap((candidate) =>
    candidate.thread.rfc822MessageId !== undefined ? [candidate.thread.rfc822MessageId] : [],
  );
  const seenMessageIds = new Set(
    candidateMessageIds.length > 0
      ? (
          await db
            .select({ messageId: emailSuggestion.rfc822MessageId })
            .from(emailSuggestion)
            .where(
              and(
                eq(emailSuggestion.organizationId, input.organizationId),
                inArray(emailSuggestion.rfc822MessageId, candidateMessageIds),
              ),
            )
        ).flatMap((row) => (row.messageId !== null ? [row.messageId] : []))
      : [],
  );

  const suggestionIds: string[] = [];
  let skippedExisting = 0;
  let synthCalls = 0;
  for (const { thread, verdict } of worthy) {
    if (
      seen.has(thread.threadId) ||
      (thread.rfc822MessageId !== undefined && seenMessageIds.has(thread.rfc822MessageId))
    ) {
      skippedExisting += 1;
      continue;
    }
    synthCalls += 1;
    const draft = await input.synthesizer.synthesize({
      subject: thread.subject,
      snippet: thread.snippet,
      sender: thread.sender,
    });

    const inserted = await db
      .insert(emailSuggestion)
      .values({
        organizationId: input.organizationId,
        createdBy: input.actorId,
        integrationId: input.integrationId,
        externalThreadId: thread.threadId,
        title: draft.title,
        description: draft.description ?? null,
        priority: draft.priority,
        dueDate: draft.dueDate !== undefined ? new Date(`${draft.dueDate}T00:00:00.000Z`) : null,
        confidence: verdict.score,
        rfc822MessageId: thread.rfc822MessageId ?? null,
        emailMeta: {
          subject: thread.subject,
          sender: thread.sender,
          snippet: thread.snippet,
          ...(thread.receivedAt !== undefined ? { receivedAt: thread.receivedAt } : {}),
          ...(thread.rfc822MessageId !== undefined
            ? { rfc822MessageId: thread.rfc822MessageId }
            : {}),
          externalUrl: thread.externalUrl,
        },
      })
      .onConflictDoNothing({
        target: [emailSuggestion.organizationId, emailSuggestion.externalThreadId],
      })
      .returning({ id: emailSuggestion.id });
    const row = inserted[0];
    if (!row) continue; // raced with another writer — already suggested

    suggestionIds.push(row.id);
    await emitEvent({
      organizationId: input.organizationId,
      kind: 'created',
      actorId: input.actorId,
      title: draft.title,
      subject: { type: 'email_suggestion', id: row.id, title: draft.title },
      // The funnel verdict rides along so pipeline rules can match on it
      // (e.g. dismiss-promotions matches `detail.category === 'promotions'`).
      detail: {
        schema: 'docket.email_suggestion',
        category: verdict.category ?? null,
        confidence: verdict.score,
      },
    });
  }

  return {
    created: suggestionIds.length,
    suggestionIds,
    considered: input.threads.length,
    passedFunnel: worthy.length,
    skippedExisting,
    synthCalls,
  };
}
