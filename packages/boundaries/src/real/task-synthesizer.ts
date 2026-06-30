/**
 * `@docket/boundaries/real` — `RealTaskSynthesizer` (Anthropic-backed task synthesis).
 *
 * @remarks
 * Drives a Claude turn (Anthropic Messages API) to turn one email thread into an
 * action-oriented task draft. Selected only when `ANTHROPIC_API_KEY` is real-shaped (see
 * `selectAdapter`); otherwise the deterministic mock is used. The model is asked for a strict
 * JSON object; a malformed/partial response falls back to a subject-derived draft so a sweep
 * is never broken by a bad completion. See `docs/engineering/specs/email-to-task.md` §6.
 */
import type Anthropic from '@anthropic-ai/sdk';

import type {
  SynthesizedPriority,
  TaskDraft,
  TaskDraftInput,
  TaskSynthesizer,
} from '../ports/task-synthesizer';
import { type AnthropicClientConfig, makeAnthropicClient, wrapAnthropicError } from './anthropic';

/** The default synthesis model — capable rewording; overridable per config. */
export const DEFAULT_SYNTHESIS_MODEL = 'claude-opus-4-8';

/** Construction config for {@link RealTaskSynthesizer}. */
export interface RealTaskSynthesizerConfig extends AnthropicClientConfig {
  /** Override the synthesis model. */
  readonly model?: string;
}

const SYSTEM_PROMPT = [
  'You convert an email thread into a single, action-oriented task for the recipient.',
  'The title must state what the recipient should DO (start with a verb), not echo the subject.',
  'Reply with ONLY a JSON object: {"title": string, "description": string, "priority": "none"|"urgent"|"high"|"medium"|"low"}.',
  'Keep the title under 120 characters; the description one short sentence on why it matters.',
].join(' ');

/** The valid priorities, for validating the model's output. */
const PRIORITIES: readonly SynthesizedPriority[] = ['none', 'urgent', 'high', 'medium', 'low'];

/** A deterministic, safe draft used when the model output can't be parsed. */
function fallbackDraft(input: TaskDraftInput): TaskDraft {
  const subject = input.subject.trim() || 'Follow up on an email';
  return {
    title: subject.length > 120 ? `${subject.slice(0, 119).trimEnd()}…` : subject,
    description: input.snippet.trim() || undefined,
    priority: 'medium',
  };
}

/** Parse the model's JSON reply into a {@link TaskDraft}, or `null` if malformed. */
function parseDraft(text: string): TaskDraft | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    const title = typeof parsed['title'] === 'string' ? parsed['title'].trim() : '';
    if (!title) return null;
    const priority = PRIORITIES.includes(parsed['priority'] as SynthesizedPriority)
      ? (parsed['priority'] as SynthesizedPriority)
      : 'medium';
    const description =
      typeof parsed['description'] === 'string' && parsed['description'].trim().length > 0
        ? parsed['description'].trim()
        : undefined;
    return { title, priority, ...(description ? { description } : {}) };
  } catch {
    return null;
  }
}

/** The Anthropic-backed task synthesizer. */
export class RealTaskSynthesizer implements TaskSynthesizer {
  private readonly client: Anthropic;
  private readonly model: string;

  /**
   * @param config - Anthropic credentials + optional model override.
   */
  constructor(config: RealTaskSynthesizerConfig) {
    this.client = makeAnthropicClient(config);
    this.model = config.model ?? DEFAULT_SYNTHESIS_MODEL;
  }

  /** {@inheritDoc TaskSynthesizer.synthesize} */
  async synthesize(input: TaskDraftInput): Promise<TaskDraft> {
    const user = `From: ${input.sender}\nSubject: ${input.subject}\n\n${input.snippet}`;
    let text: string;
    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 400,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: user }],
      });
      text = response.content
        .map((block) => (block.type === 'text' ? block.text : ''))
        .join('')
        .trim();
    } catch (cause) {
      throw wrapAnthropicError(cause, 'task synthesis');
    }
    return parseDraft(text) ?? fallbackDraft(input);
  }
}
