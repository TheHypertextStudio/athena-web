/**
 * `@docket/boundaries/real` — `RealSummarizer` (Anthropic-backed daily digest narrator).
 *
 * @remarks
 * The env-driven {@link Summarizer}: it turns a day's observations into the digest
 * Markdown via a single non-streaming Anthropic Messages call. Prompt assembly
 * ({@link buildRequest}) and response parsing ({@link extractMarkdown}) are pure and
 * unit-testable; the one I/O seam is the injectable {@link MessageCreator} (the SDK by
 * default, a fake in tests). Selected only when `ANTHROPIC_API_KEY` is real-shaped;
 * otherwise {@link MockSummarizer} runs. Mirrors `RealProviderRuntime`'s structure.
 */
import type {
  Message,
  MessageCreateParamsNonStreaming,
} from '@anthropic-ai/sdk/resources/messages';

import type { SummarizeInput, SummarizeResult, Summarizer } from '../ports/summarizer';
import { makeAnthropicClient, wrapAnthropicError } from './anthropic';

/**
 * The Claude model the digest is narrated with.
 *
 * @remarks
 * `claude-opus-4-8` is the latest, most-capable model and the repo-wide default (the
 * agent runtime uses the same). The digest runs once per user per day, so quality is
 * worth more than the marginal cost. Overridable via {@link RealSummarizerConfig.model}.
 */
export const DEFAULT_SUMMARIZER_MODEL = 'claude-opus-4-8';

/** The digest output ceiling — generous for a narrative, small enough to stay non-streaming. */
export const DEFAULT_MAX_TOKENS = 4000;

const SYSTEM_PROMPT =
  'You are Athena, a chief-of-staff assistant inside Docket. You write a short, warm ' +
  'end-of-day digest summarizing what the user actually did today, drawn from the tools ' +
  'they use. Group related activity, lead with what matters, and keep it skimmable. ' +
  'Write in Markdown: a one-line greeting, then tight thematic bullets — no preamble, no ' +
  'invented detail beyond the observations provided. If there was little activity, say so ' +
  'briefly and kindly.';

/** Validated configuration for {@link RealSummarizer} (sourced from env). */
export interface RealSummarizerConfig {
  /** Anthropic API key (`sk-ant-...`). Read from `ANTHROPIC_API_KEY`. */
  readonly apiKey: string;
  /** Model id override; defaults to {@link DEFAULT_SUMMARIZER_MODEL}. */
  readonly model?: string;
  /** Output token ceiling; defaults to {@link DEFAULT_MAX_TOKENS}. */
  readonly maxTokens?: number;
  /** Base URL override (e.g. a gateway/proxy); defaults to the Anthropic API. */
  readonly baseURL?: string;
}

/**
 * The injectable live edge: turns Messages-API params into one completed message.
 *
 * @remarks
 * The real default calls the Anthropic SDK; tests inject a fake so prompt assembly and
 * parsing are exercised without any network/SDK wiring.
 */
export type MessageCreator = (params: MessageCreateParamsNonStreaming) => Promise<Message>;

/** Flatten one observation into a compact prompt line. */
function observationLine(o: SummarizeInput['observations'][number]): string {
  const meta = [o.actor ? `by ${o.actor}` : undefined, o.subject ? `on ${o.subject}` : undefined]
    .filter(Boolean)
    .join(', ');
  const tail = [o.summary, meta].filter(Boolean).join(' — ');
  return `- [${o.provider}/${o.kind} @ ${o.occurredAt}] ${o.title}${tail ? ` — ${tail}` : ''}`;
}

/**
 * Build the Messages-API request for one digest.
 *
 * @remarks
 * Pure: maps {@link SummarizeInput} onto a single user turn listing the day's observations.
 * No `thinking` (a digest is light summarization) and non-streaming (output is small).
 */
export function buildRequest(
  input: SummarizeInput,
  config: RealSummarizerConfig,
): MessageCreateParamsNonStreaming {
  const who = input.recipientName ? ` for ${input.recipientName}` : '';
  const lines = input.observations.map(observationLine).join('\n');
  const userText =
    `Write the daily digest${who} for ${input.dateLabel}. Here is everything observed ` +
    `across their tools today (chronological):\n\n${lines || '(no tracked activity)'}`;
  return {
    model: config.model ?? DEFAULT_SUMMARIZER_MODEL,
    max_tokens: config.maxTokens ?? DEFAULT_MAX_TOKENS,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userText }],
  };
}

/** Join the message's text blocks into the digest Markdown. */
export function extractMarkdown(message: Message): string {
  return message.content
    .filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
}

/** Build the default {@link MessageCreator} backed by the Anthropic SDK. */
export function defaultMessageCreator(config: RealSummarizerConfig): MessageCreator {
  /* v8 ignore start -- live Anthropic SDK edge */
  const client = makeAnthropicClient(config);
  return (params) => client.messages.create(params);
  /* v8 ignore stop */
}

/** A real, env-driven daily-digest summarizer backed by the Anthropic Messages API. */
export class RealSummarizer implements Summarizer {
  private readonly config: RealSummarizerConfig;
  private readonly creator: MessageCreator;

  constructor(config: RealSummarizerConfig, creator?: MessageCreator) {
    this.config = config;
    this.creator = creator ?? defaultMessageCreator(config);
  }

  /** {@inheritDoc Summarizer.summarize} */
  async summarize(input: SummarizeInput): Promise<SummarizeResult> {
    const params = buildRequest(input, this.config);
    let message: Message;
    try {
      message = await this.creator(params);
    } catch (cause) {
      throw wrapAnthropicError(cause, 'summarizer');
    }
    return { markdown: extractMarkdown(message) };
  }
}
