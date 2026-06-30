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

import type { Priority } from '@docket/types';

/** The default maximum synthesized-title length. */
export const TITLE_MAX = 120;

/**
 * Cap a title at `max` characters with a trailing ellipsis, falling back to a generic label
 * for an empty subject. Shared by every synthesizer so the cap rule lives in one place.
 */
export function truncateTitle(text: string, max = TITLE_MAX): string {
  const trimmed = text.trim() || 'Follow up on an email';
  return trimmed.length > max ? `${trimmed.slice(0, max - 1).trimEnd()}…` : trimmed;
}

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
  /** The inferred priority (the shared task {@link Priority}). */
  readonly priority: Priority;
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
