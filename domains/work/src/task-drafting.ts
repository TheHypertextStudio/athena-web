import type { Priority } from './task-contract';

/** The email signal handed to a task synthesizer. */
export interface TaskDraftInput {
  /** The email thread's subject. */
  readonly subject: string;
  /** A short preview snippet. */
  readonly snippet: string;
  /** The sender in display form. */
  readonly sender: string;
}

/** A task draft produced from an incoming email thread. */
export interface TaskDraft {
  /** An action-oriented title rather than the raw email subject. */
  readonly title: string;
  /** A short explanation of why the task matters. */
  readonly description?: string;
  /** The inferred Work priority. */
  readonly priority: Priority;
  /** An explicit email deadline, encoded as ISO `YYYY-MM-DD` when one exists. */
  readonly dueDate?: string;
}

/**
 * Port for converting one email thread into an actionable Work draft.
 *
 * @remarks
 * The Work layer owns the input and output language; the delivery/runtime domain owns concrete
 * model-backed or deterministic adapters. This lets email ingestion, browser workflows, and a
 * future desktop app share a stable task-drafting contract without importing an agent runtime.
 */
export interface TaskSynthesizer {
  /**
   * Produce one task draft from an email signal.
   *
   * @param input - The source email's usable signal.
   * @returns The title, optional description/deadline, and inferred priority.
   */
  synthesize(input: TaskDraftInput): Promise<TaskDraft>;
}
