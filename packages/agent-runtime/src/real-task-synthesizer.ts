/**
 * `@docket/agent-runtime` - `RealTaskSynthesizer` (Anthropic-backed task synthesis).
 *
 * @remarks
 * Drives a Claude turn (Anthropic Messages API) to turn one email thread into an
 * action-oriented task draft. Selected only when `ANTHROPIC_API_KEY` is real-shaped (see
 * the API container); otherwise the deterministic mock is used. The model is asked for a strict
 * JSON object; a malformed/partial response falls back to a subject-derived draft so a sweep
 * is never broken by a bad completion. See `docs/engineering/specs/email-to-task.md` §6.
 *
 * Prompt assembly ({@link buildRequest}) and response parsing ({@link parseDraft},
 * {@link fallbackDraft}) are pure and unit-testable; the one I/O seam is the injectable
 * {@link MessageCreator} (the SDK by default, a fake in tests) — mirrors `RealSummarizer` and
 * `RealProviderRuntime`'s structure.
 */
import type {
  Message,
  MessageCreateParamsNonStreaming,
} from '@anthropic-ai/sdk/resources/messages';
import type { Priority } from '@docket/types';

import {
  type TaskDraft,
  type TaskDraftInput,
  type TaskSynthesizer,
  truncateTitle,
} from './task-synthesizer';
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
  'Reply with ONLY a JSON object: {"title": string, "description": string, "priority": "none"|"urgent"|"high"|"medium"|"low", "dueDate": "YYYY-MM-DD" | null}.',
  'Keep the title under 120 characters; the description one short sentence on why it matters.',
  'Set dueDate ONLY when the email states an explicit date or deadline; otherwise null — never guess.',
].join(' ');

/** Accept only a literal ISO date the model echoed from the email (never a guess/format drift). */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The valid priorities, for validating the model's output. */
const PRIORITIES: readonly Priority[] = ['none', 'urgent', 'high', 'medium', 'low'];

/**
 * The injectable live edge: turns a Messages-API request into one completed message.
 *
 * @remarks
 * The real default calls the Anthropic SDK; tests inject a fake so prompt assembly and
 * response parsing are exercised without any network/SDK wiring.
 */
export type MessageCreator = (params: MessageCreateParamsNonStreaming) => Promise<Message>;

/**
 * Build the Messages-API request for one draft.
 *
 * @remarks
 * Pure: maps {@link TaskDraftInput} onto a single user turn asking for a strict JSON draft.
 */
export function buildRequest(
  input: TaskDraftInput,
  config: RealTaskSynthesizerConfig,
): MessageCreateParamsNonStreaming {
  const user = `From: ${input.sender}\nSubject: ${input.subject}\n\n${input.snippet}`;
  return {
    model: config.model ?? DEFAULT_SYNTHESIS_MODEL,
    max_tokens: 400,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: user }],
  };
}

/** Join a completed message's text blocks into the model's raw reply. */
export function extractText(message: Message): string {
  return message.content
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('')
    .trim();
}

/** Build the default {@link MessageCreator} backed by the Anthropic SDK. */
export function defaultMessageCreator(config: RealTaskSynthesizerConfig): MessageCreator {
  /* v8 ignore start -- live Anthropic SDK edge */
  const client = makeAnthropicClient(config);
  return (params) => client.messages.create(params);
  /* v8 ignore stop */
}

/** A deterministic, safe draft used when the model output can't be parsed. */
export function fallbackDraft(input: TaskDraftInput): TaskDraft {
  return {
    title: truncateTitle(input.subject),
    description: input.snippet.trim() || undefined,
    priority: 'medium',
  };
}

/** Parse the model's JSON reply into a {@link TaskDraft}, or `null` if malformed. */
export function parseDraft(text: string): TaskDraft | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    const title = typeof parsed['title'] === 'string' ? parsed['title'].trim() : '';
    if (!title) return null;
    const priority = PRIORITIES.includes(parsed['priority'] as Priority)
      ? (parsed['priority'] as Priority)
      : 'medium';
    const description =
      typeof parsed['description'] === 'string' && parsed['description'].trim().length > 0
        ? parsed['description'].trim()
        : undefined;
    const dueDate =
      typeof parsed['dueDate'] === 'string' && ISO_DATE.test(parsed['dueDate'])
        ? parsed['dueDate']
        : undefined;
    return {
      title,
      priority,
      ...(description ? { description } : {}),
      ...(dueDate ? { dueDate } : {}),
    };
  } catch {
    return null;
  }
}

/** The Anthropic-backed task synthesizer. */
export class RealTaskSynthesizer implements TaskSynthesizer {
  private readonly config: RealTaskSynthesizerConfig;
  private readonly creator: MessageCreator;

  /**
   * @param config - Anthropic credentials + optional model override.
   * @param creator - Optional injected {@link MessageCreator}; defaults to the live SDK.
   */
  constructor(config: RealTaskSynthesizerConfig, creator?: MessageCreator) {
    this.config = config;
    this.creator = creator ?? defaultMessageCreator(config);
  }

  /** {@inheritDoc TaskSynthesizer.synthesize} */
  async synthesize(input: TaskDraftInput): Promise<TaskDraft> {
    const params = buildRequest(input, this.config);
    let text: string;
    try {
      const message = await this.creator(params);
      text = extractText(message);
    } catch (cause) {
      throw wrapAnthropicError(cause, 'task synthesis');
    }
    return parseDraft(text) ?? fallbackDraft(input);
  }
}
