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
import type { TaskSynthesizer } from '@docket/boundaries';
import { and, eq, inArray } from 'drizzle-orm';

import { emitObservation } from '../../routes/observation-emit';
import { classifyTaskWorthiness, type ThreadSignal } from './funnel';

/** A thread to consider, with its external id and snapshot signal. */
export interface CandidateThread extends ThreadSignal {
  readonly threadId: string;
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

/** The outcome of one synthesis run. */
export interface PersistSuggestionsResult {
  readonly created: number;
  readonly suggestionIds: readonly string[];
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
  if (worthy.length === 0) return { created: 0, suggestionIds: [] };

  // Pre-dedup: skip synthesis for threads already suggested (sweeps re-pull recent threads,
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

  const suggestionIds: string[] = [];
  for (const { thread, verdict } of worthy) {
    if (seen.has(thread.threadId)) continue;
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
        confidence: verdict.score,
        emailMeta: { subject: thread.subject, sender: thread.sender, snippet: thread.snippet },
      })
      .onConflictDoNothing({
        target: [emailSuggestion.organizationId, emailSuggestion.externalThreadId],
      })
      .returning({ id: emailSuggestion.id });
    const row = inserted[0];
    if (!row) continue; // raced with another writer — already suggested

    suggestionIds.push(row.id);
    await emitObservation({
      organizationId: input.organizationId,
      kind: 'created',
      actorId: input.actorId,
      title: draft.title,
      subject: { type: 'email_suggestion', id: row.id, title: draft.title },
      payload: {
        suggestionId: row.id,
        threadId: thread.threadId,
        ...(verdict.category ? { category: verdict.category } : {}),
      },
    });
  }

  return { created: suggestionIds.length, suggestionIds };
}
