/**
 * `@docket/boundaries/mock` — `MockTaskSynthesizer`.
 *
 * @remarks
 * A deterministic, offline {@link TaskSynthesizer}: it derives a title from the subject and
 * keeps the snippet as the description, with a neutral priority. No model, no randomness — so
 * the synthesis pipeline runs and is testable with zero external accounts. The real adapter
 * ({@link import('../real/task-synthesizer').RealTaskSynthesizer}) does the action-oriented
 * rewording.
 */
import {
  type TaskDraft,
  type TaskDraftInput,
  type TaskSynthesizer,
  truncateTitle,
} from '../ports/task-synthesizer';

/** Matches the first literal ISO date in the snippet — the mock's deterministic dueDate rule. */
const ISO_DATE_IN_TEXT = /\b(\d{4}-\d{2}-\d{2})\b/;

/** A deterministic, model-free task synthesizer. */
export class MockTaskSynthesizer implements TaskSynthesizer {
  /** {@inheritDoc TaskSynthesizer.synthesize} */
  async synthesize(input: TaskDraftInput): Promise<TaskDraft> {
    // Deterministic stand-in for the real adapter's explicit-date rule: a dueDate appears
    // iff the snippet contains a literal ISO date (so offline tests stay exact).
    const dueDate = ISO_DATE_IN_TEXT.exec(input.snippet)?.[1];
    return {
      title: truncateTitle(input.subject),
      description: input.snippet.trim() || undefined,
      priority: 'medium',
      ...(dueDate !== undefined ? { dueDate } : {}),
    };
  }
}
