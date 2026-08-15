/**
 * Deterministic Athena adapter for Work's email-to-task drafting port.
 *
 * This adapter deliberately makes no provider request. It keeps local and test workflows
 * predictable while applying Work's shared title and priority vocabulary.
 */
import type { TaskDraft, TaskDraftInput, TaskSynthesizer } from '@docket/work/task-drafting';
import { truncateTitle } from '@docket/work/task-titles';

/** Matches the first literal ISO date in an email snippet. */
const ISO_DATE_IN_TEXT = /\b(\d{4}-\d{2}-\d{2})\b/;

/**
 * A deterministic, model-free task synthesizer for Athena's local runtime mode.
 */
export class MockTaskSynthesizer implements TaskSynthesizer {
  /** {@inheritDoc TaskSynthesizer.synthesize} */
  async synthesize(input: TaskDraftInput): Promise<TaskDraft> {
    const dueDate = ISO_DATE_IN_TEXT.exec(input.snippet)?.[1];
    const description = input.snippet.trim();
    return {
      title: truncateTitle(input.subject),
      priority: 'medium',
      ...(description ? { description } : {}),
      ...(dueDate !== undefined ? { dueDate } : {}),
    };
  }
}
