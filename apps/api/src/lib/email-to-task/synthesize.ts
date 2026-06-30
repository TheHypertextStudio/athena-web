/**
 * `@docket/api` — email-to-task synthesis: turn classified threads into suggestions.
 *
 * @remarks
 * Stage two of the funnel. For each thread that passes {@link classifyTaskWorthiness}, a
 * {@link Synthesizer} drafts the task fields and a one-per-thread `email_suggestion` row is
 * written (deduped via the unique `(organizationId, externalThreadId)` index). Each new
 * suggestion emits a `created` observation on an `email_suggestion` subject, so pipeline
 * automation rules (e.g. dismiss-promotions) run through the existing Observer hook. The
 * synthesizer is injectable: the default is a deterministic heuristic; the real path is
 * Athena (the agent runtime). See `docs/engineering/specs/email-to-task.md` §6.
 */
import { db, emailSuggestion } from '@docket/db';
import type { Priority } from '@docket/types';

import { emitObservation } from '../../routes/observation-emit';
import { classifyTaskWorthiness, type ThreadSignal, type ThreadVerdict } from './funnel';

/** A thread to consider, with its external id and snapshot signal. */
export interface CandidateThread extends ThreadSignal {
  readonly threadId: string;
}

/** The synthesized draft fields for a task. */
export interface SynthesizedDraft {
  readonly title: string;
  readonly description?: string;
  readonly priority: Priority;
  readonly dueDate?: string;
}

/** Drafts task fields from a thread + its verdict. Default is heuristic; real is Athena. */
export type Synthesizer = (
  signal: CandidateThread,
  verdict: ThreadVerdict,
) => SynthesizedDraft | Promise<SynthesizedDraft>;

/** The maximum synthesized-title length. */
const TITLE_MAX = 120;

/**
 * The deterministic default synthesizer — no LLM.
 *
 * @remarks
 * Derives an action-oriented title from the subject and keeps the snippet as the description;
 * maps the funnel score onto a priority. Good enough offline and as a fallback; the Athena
 * synthesizer replaces it on the real path for richer, reworded drafts.
 */
export const defaultSynthesizer: Synthesizer = (signal, verdict) => {
  const subject = signal.subject.trim() || 'Follow up on an email';
  const title =
    subject.length > TITLE_MAX ? `${subject.slice(0, TITLE_MAX - 1).trimEnd()}…` : subject;
  const priority: Priority = verdict.score >= 70 ? 'high' : verdict.score >= 40 ? 'medium' : 'low';
  return { title, description: signal.snippet || undefined, priority };
};

/** Input to {@link persistSuggestions}. */
export interface PersistSuggestionsInput {
  readonly organizationId: string;
  readonly integrationId: string;
  readonly threads: readonly CandidateThread[];
  /** The funnel pass threshold (runtime config, not a literal). */
  readonly threshold: number;
  readonly actorId: string | null;
  /** Defaults to {@link defaultSynthesizer}. */
  readonly synthesize?: Synthesizer;
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
 * Unworthy threads (below threshold, e.g. promotions) are dropped here for ~free — no
 * synthesis. Worthy threads are deduped one-per-thread; a freshly-created suggestion emits a
 * `created` observation so automation rules fire. Re-running over the same threads creates
 * nothing new (idempotent).
 */
export async function persistSuggestions(
  input: PersistSuggestionsInput,
): Promise<PersistSuggestionsResult> {
  const synthesize = input.synthesize ?? defaultSynthesizer;
  const suggestionIds: string[] = [];

  for (const thread of input.threads) {
    const verdict = classifyTaskWorthiness(thread, input.threshold);
    if (!verdict.worthy) continue;
    const draft = await synthesize(thread, verdict);

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
        dueDate: draft.dueDate ? new Date(draft.dueDate) : null,
        confidence: verdict.score,
        emailMeta: { subject: thread.subject, sender: thread.sender, snippet: thread.snippet },
      })
      .onConflictDoNothing({
        target: [emailSuggestion.organizationId, emailSuggestion.externalThreadId],
      })
      .returning({ id: emailSuggestion.id });
    const row = inserted[0];
    if (!row) continue; // duplicate thread — already suggested

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
