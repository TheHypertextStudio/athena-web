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
import type { TaskDraft, TaskDraftInput, TaskSynthesizer } from '../ports/task-synthesizer';

/** The maximum synthesized-title length. */
const TITLE_MAX = 120;

/** A deterministic, model-free task synthesizer. */
export class MockTaskSynthesizer implements TaskSynthesizer {
  /** {@inheritDoc TaskSynthesizer.synthesize} */
  async synthesize(input: TaskDraftInput): Promise<TaskDraft> {
    const subject = input.subject.trim() || 'Follow up on an email';
    const title =
      subject.length > TITLE_MAX ? `${subject.slice(0, TITLE_MAX - 1).trimEnd()}…` : subject;
    return {
      title,
      description: input.snippet.trim() || undefined,
      priority: 'medium',
    };
  }
}
