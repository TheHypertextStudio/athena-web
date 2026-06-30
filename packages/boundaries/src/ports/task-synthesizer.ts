/**
 * `@docket/boundaries/ports` — the `TaskSynthesizer` port.
 *
 * @remarks
 * Stage two of the email-to-task funnel: turn one email thread into an action-oriented task
 * draft ("Software Engineering Interview" → "Schedule the SWE interview with Google"). The
 * real adapter drives a Claude model; the mock is deterministic (subject-derived) so the
 * pipeline runs offline. This is the seam the synthesis sweep injects — see
 * `docs/engineering/specs/email-to-task.md` §6.
 */

/** The priority a synthesized draft can carry (mirrors the task priority enum). */
export type SynthesizedPriority = 'none' | 'urgent' | 'high' | 'medium' | 'low';

/** The email signal handed to the synthesizer. */
export interface TaskDraftInput {
  /** The thread subject. */
  readonly subject: string;
  /** A short preview snippet. */
  readonly snippet: string;
  /** The sender (display form). */
  readonly sender: string;
}

/** The synthesized task draft. */
export interface TaskDraft {
  /** An action-oriented title (what the user must do), not the raw subject. */
  readonly title: string;
  /** A short "why this matters" description. */
  readonly description?: string;
  /** The inferred priority. */
  readonly priority: SynthesizedPriority;
}

/** The task-synthesizer port: one email thread → one action-oriented task draft. */
export interface TaskSynthesizer {
  /**
   * Synthesize a task draft from an email thread.
   *
   * @param input - The thread's subject/snippet/sender.
   * @returns the drafted title/description/priority.
   * @throws {Error} On a provider failure (the caller falls back / records, never crashes a sweep).
   */
  synthesize(input: TaskDraftInput): Promise<TaskDraft>;
}
