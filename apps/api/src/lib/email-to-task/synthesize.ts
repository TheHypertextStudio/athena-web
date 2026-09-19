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
import type { TaskSynthesizer } from '@docket/work/task-drafting';
import { and, eq, inArray } from 'drizzle-orm';

import { emitEvent } from '../../routes/event-emit';
import { loadMailRoutingCues } from '../automation/routing-cues';
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

/** A thread the funnel passed, carried with the verdict whose score and category are reused. */
interface WorthyCandidate {
  readonly thread: CandidateThread;
  readonly verdict: ReturnType<typeof classifyTaskWorthiness>;
}

/** The thread ids and Message-IDs this organization has already been shown a suggestion for. */
interface AlreadySuggested {
  readonly threadIds: ReadonlySet<string>;
  readonly messageIds: ReadonlySet<string>;
}

/**
 * Find which of the candidate threads already have a suggestion.
 *
 * @remarks
 * Two dedup keys, because sweeps re-pull recent threads and the same email seen through two mail
 * providers carries the same RFC 5322 Message-ID even though the provider thread ids differ.
 * Skipping here rather than after synthesis is what keeps the (potentially paid) model from
 * re-running on every recurring thread only to have the result discarded.
 *
 * @param organizationId - The workspace being swept.
 * @param worthy - The threads that passed the funnel.
 * @returns The keys to skip.
 */
async function loadAlreadySuggested(
  organizationId: string,
  worthy: readonly WorthyCandidate[],
): Promise<AlreadySuggested> {
  const byThread = await db
    .select({ threadId: emailSuggestion.externalThreadId })
    .from(emailSuggestion)
    .where(
      and(
        eq(emailSuggestion.organizationId, organizationId),
        inArray(
          emailSuggestion.externalThreadId,
          worthy.map((candidate) => candidate.thread.threadId),
        ),
      ),
    );

  const candidateMessageIds = worthy.flatMap((candidate) =>
    candidate.thread.rfc822MessageId !== undefined ? [candidate.thread.rfc822MessageId] : [],
  );
  const byMessageId =
    candidateMessageIds.length === 0
      ? []
      : await db
          .select({ messageId: emailSuggestion.rfc822MessageId })
          .from(emailSuggestion)
          .where(
            and(
              eq(emailSuggestion.organizationId, organizationId),
              inArray(emailSuggestion.rfc822MessageId, candidateMessageIds),
            ),
          );

  return {
    threadIds: new Set(byThread.map((row) => row.threadId)),
    messageIds: new Set(
      byMessageId.flatMap((row) => (row.messageId !== null ? [row.messageId] : [])),
    ),
  };
}

/** Build the email metadata for a suggestion row. */
function buildEmailMeta(thread: CandidateThread) {
  return {
    subject: thread.subject,
    sender: thread.sender,
    snippet: thread.snippet,
    ...(thread.receivedAt !== undefined ? { receivedAt: thread.receivedAt } : {}),
    ...(thread.rfc822MessageId !== undefined ? { rfc822MessageId: thread.rfc822MessageId } : {}),
    externalUrl: thread.externalUrl,
  };
}

/** Emit the created event after inserting a suggestion. */
async function emitSuggestionCreated(
  input: PersistSuggestionsInput,
  rowId: string,
  thread: CandidateThread,
  draft: Awaited<ReturnType<PersistSuggestionsInput['synthesizer']['synthesize']>>,
  verdict: ReturnType<typeof classifyTaskWorthiness>,
) {
  await emitEvent({
    organizationId: input.organizationId,
    kind: 'created',
    actorId: input.actorId,
    title: draft.title,
    subject: { type: 'email_suggestion', id: rowId, title: draft.title },
    detail: {
      schema: 'docket.email_suggestion',
      category: verdict.category ?? null,
      confidence: verdict.score,
      subject: thread.subject,
      sender: thread.sender,
      snippet: thread.snippet,
    },
  });
}

/**
 * Draft and persist one suggestion, emitting its `created` observation.
 *
 * @param input - The run's shared input.
 * @param candidate - The thread to draft, with its funnel verdict.
 * @returns The new suggestion's id, or `undefined` when a concurrent writer won the insert.
 */
async function persistOneSuggestion(
  input: PersistSuggestionsInput,
  candidate: WorthyCandidate,
): Promise<string | undefined> {
  const { thread, verdict } = candidate;
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
      emailMeta: buildEmailMeta(thread),
    })
    .onConflictDoNothing({
      target: [emailSuggestion.organizationId, emailSuggestion.externalThreadId],
    })
    .returning({ id: emailSuggestion.id });
  const row = inserted[0];
  if (!row) return undefined;

  await emitSuggestionCreated(input, row.id, thread, draft, verdict);
  return row.id;
}

/**
 * Classify, synthesize, and persist suggestions for a batch of threads.
 *
 * @remarks
 * Unworthy threads (below threshold, e.g. promotions) are dropped here for ~free. Threads
 * already suggested are skipped **before** synthesis — so the (potentially paid) model is
 * never re-run on a thread a previous sweep already proposed. The unique
 * `(organizationId, externalThreadId)` index is the race-safety net behind that check.
 *
 * The org's routing rules are loaded once per batch and handed to the classifier, because the
 * funnel runs before any rule does and would otherwise discard mail the person explicitly asked
 * to have routed. See {@link loadMailRoutingCues}.
 *
 * @param input - The threads to consider and the services to draft them with.
 * @returns The run's counters and the ids of the suggestions it created.
 */
export async function persistSuggestions(
  input: PersistSuggestionsInput,
): Promise<PersistSuggestionsResult> {
  const routingCues = await loadMailRoutingCues(input.organizationId);
  // Classify once and carry the verdict through (its score/category are reused below).
  const worthy: readonly WorthyCandidate[] = input.threads
    .map((thread) => ({
      thread,
      verdict: classifyTaskWorthiness(thread, input.threshold, routingCues),
    }))
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

  const seen = await loadAlreadySuggested(input.organizationId, worthy);
  const suggestionIds: string[] = [];
  let skippedExisting = 0;
  let synthCalls = 0;
  for (const candidate of worthy) {
    const { thread } = candidate;
    const messageId = thread.rfc822MessageId;
    if (
      seen.threadIds.has(thread.threadId) ||
      (messageId !== undefined && seen.messageIds.has(messageId))
    ) {
      skippedExisting += 1;
      continue;
    }
    synthCalls += 1;
    const id = await persistOneSuggestion(input, candidate);
    if (id !== undefined) suggestionIds.push(id);
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
