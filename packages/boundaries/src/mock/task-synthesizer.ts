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

/** A deterministic, model-free task synthesizer. */
export class MockTaskSynthesizer implements TaskSynthesizer {
  /** {@inheritDoc TaskSynthesizer.synthesize} */
  async synthesize(input: TaskDraftInput): Promise<TaskDraft> {
    return {
      title: truncateTitle(input.subject),
      description: input.snippet.trim() || undefined,
      priority: 'medium',
    };
  }
}
