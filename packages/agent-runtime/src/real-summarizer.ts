/**
 * `@docket/agent-runtime` - `RealSummarizer` (Anthropic-backed per-episode narrator).
 *
 * @remarks
 * The env-driven {@link Summarizer}: it turns a day's episodes into one first-person sentence each
 * via a single non-streaming Anthropic Messages call. Prompt assembly ({@link buildRequest}),
 * response parsing ({@link parseHighlights}) and reconciliation ({@link reconcileHighlights}) are
 * pure and unit-testable; the one I/O seam is the injectable {@link MessageCreator} (the SDK by
 * default, a fake in tests). Selected only when `ANTHROPIC_API_KEY` is real-shaped; otherwise
 * {@link MockSummarizer} runs. Follows `RealTaskSynthesizer`'s structure for JSON replies.
 */
import type {
  Message,
  MessageCreateParamsNonStreaming,
} from '@anthropic-ai/sdk/resources/messages';

import type {
  NarrateDayInput,
  NarrateDayResult,
  NarratedHighlight,
  NarrationEpisode,
  Summarizer,
} from './summarizer';
import { makeAnthropicClient, wrapAnthropicError } from './anthropic';

/**
 * The Claude model the day is narrated with.
 *
 * @remarks
 * `claude-opus-4-8` is the latest, most-capable model and the repo-wide default (the agent runtime
 * uses the same). Narration runs once per user per day, so quality is worth more than the marginal
 * cost. Overridable via {@link RealSummarizerConfig.model}.
 */
export const DEFAULT_SUMMARIZER_MODEL = 'claude-opus-4-8';

/** The output ceiling — generous for a few dozen sentences, small enough to stay non-streaming. */
export const DEFAULT_MAX_TOKENS = 4000;

const SYSTEM_PROMPT =
  'You are Athena, a chief-of-staff assistant inside Docket. You are given the episodes of one ' +
  "person's working day, each with a stable key. Write ONE sentence per episode, in the first " +
  'person and the past tense, describing what that person did — "I merged the OSM import PR after ' +
  'fixing the lane directions", not "Willie merged a PR". Draw only on the events given: never ' +
  'invent detail, and never state that somebody attended a meeting, only that they had one. Keep ' +
  'each sentence to one clause or two. Reply with JSON only, in the shape ' +
  '{"highlights":[{"key":"<the key you were given>","sentence":"<one sentence>"}]}, with exactly ' +
  'one entry per episode and the keys copied verbatim.';

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
 * The real default calls the Anthropic SDK; tests inject a fake so prompt assembly and parsing are
 * exercised without any network/SDK wiring.
 */
export type MessageCreator = (params: MessageCreateParamsNonStreaming) => Promise<Message>;

/** Flatten one episode into its prompt block. */
function episodeBlock(episode: NarrationEpisode): string {
  const head = [
    `key: ${episode.key}`,
    `source: ${episode.provider}`,
    episode.subject === undefined ? undefined : `about: ${episode.subject}`,
    `from ${episode.startedAt} to ${episode.endedAt}`,
  ]
    .filter((part) => part !== undefined)
    .join(' | ');
  const events = episode.events
    .map((event) => {
      const tail = [event.summary, event.actor ? `by ${event.actor}` : undefined]
        .filter(Boolean)
        .join(' — ');
      return `  - [${event.kind} @ ${event.occurredAt}] ${event.title}${tail ? ` — ${tail}` : ''}`;
    })
    .join('\n');
  return `${head}\n${events}`;
}

/**
 * Build the Messages-API request for one day.
 *
 * @remarks
 * Pure: maps {@link NarrateDayInput} onto a single user turn listing every episode. No `thinking`
 * (these are short factual sentences) and non-streaming (the output is small).
 *
 * @param input - The day to narrate.
 * @param config - The resolved adapter configuration.
 * @returns the request to send.
 */
export function buildRequest(
  input: NarrateDayInput,
  config: RealSummarizerConfig,
): MessageCreateParamsNonStreaming {
  const who = input.recipientName === undefined ? '' : ` for ${input.recipientName}`;
  const blocks = input.episodes.map(episodeBlock).join('\n\n');
  const userText =
    `Narrate the day${who} for ${input.dateLabel}. There are ` +
    `${String(input.episodes.length)} episodes; reply with exactly that many highlights.\n\n` +
    (blocks || '(no activity)');
  return {
    model: config.model ?? DEFAULT_SUMMARIZER_MODEL,
    max_tokens: config.maxTokens ?? DEFAULT_MAX_TOKENS,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userText }],
  };
}

/** Join a completed message's text blocks into the model's raw reply. */
export function extractText(message: Message): string {
  return message.content
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('')
    .trim();
}

/**
 * Parse the model's JSON reply into sentences by episode key.
 *
 * @remarks
 * Tolerant of prose either side of the JSON, of unknown keys, and of a malformed reply — the caller
 * reconciles whatever comes back against the episodes it asked about, so a partial parse degrades
 * individual sentences rather than the day.
 *
 * @param text - The model's raw reply.
 * @returns sentences keyed by episode key; empty when nothing could be parsed.
 */
export function parseHighlights(text: string): Map<string, string> {
  const byKey = new Map<string, string>();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return byKey;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return byKey;
  }
  const highlights = (parsed as { highlights?: unknown }).highlights;
  if (!Array.isArray(highlights)) return byKey;
  for (const entry of highlights) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { key, sentence } = entry as { key?: unknown; sentence?: unknown };
    if (typeof key !== 'string' || typeof sentence !== 'string') continue;
    const trimmed = sentence.trim();
    // First writing wins, so a duplicated key cannot overwrite an earlier good sentence.
    if (trimmed.length > 0 && !byKey.has(key)) byKey.set(key, trimmed);
  }
  return byKey;
}

/** The verb an episode's leading event reads as, in the first person. */
const KIND_PHRASE: Readonly<Record<string, string>> = {
  created: 'opened',
  completed: 'finished',
  status_change: 'moved',
  comment: 'commented on',
  message: 'wrote about',
  mention: 'was mentioned on',
  assignment: 'took on',
  task_assignment: 'took on',
  meeting_attended: 'had',
  email_received: 'received mail about',
  field_change: 'updated',
};

/**
 * A deterministic sentence for an episode the model did not narrate.
 *
 * @remarks
 * Application-owned copy assembled from the episode's own values — never model text, and never
 * provider or exception text. Its job is that a day is never quietly shorter than it was: a line the
 * model missed still says something true, and the person can rewrite it.
 *
 * @param episode - The episode to describe.
 * @returns one plain sentence.
 */
export function fallbackSentence(episode: NarrationEpisode): string {
  const subject = episode.subject ?? episode.events[0]?.title ?? 'something';
  const kind = episode.events[0]?.kind ?? '';
  const phrase = KIND_PHRASE[kind] ?? 'worked on';
  const more = episode.events.length > 1 ? ` (${String(episode.events.length)} updates)` : '';
  return `I ${phrase} ${subject}${more}.`;
}

/**
 * Pair every requested episode with a sentence, in the order it was requested.
 *
 * @remarks
 * The honesty guarantee at the model boundary. It walks the *input* rather than the reply, so a
 * truncated, malformed, partial or over-eager response can only ever affect the wording of
 * individual lines — it can never drop a highlight, reorder the day, or invent an episode nobody
 * asked about.
 *
 * @param input - The episodes that were requested.
 * @param parsed - Sentences the model returned, keyed by episode key.
 * @returns one highlight per input episode.
 */
export function reconcileHighlights(
  input: NarrateDayInput,
  parsed: Map<string, string>,
): NarratedHighlight[] {
  return input.episodes.map((episode) => ({
    key: episode.key,
    sentence: parsed.get(episode.key) ?? fallbackSentence(episode),
  }));
}

/** Build the default {@link MessageCreator} backed by the Anthropic SDK. */
export function defaultMessageCreator(config: RealSummarizerConfig): MessageCreator {
  /* v8 ignore start -- live Anthropic SDK edge */
  const client = makeAnthropicClient(config);
  return (params) => client.messages.create(params);
  /* v8 ignore stop */
}

/** A real, env-driven day narrator backed by the Anthropic Messages API. */
export class RealSummarizer implements Summarizer {
  private readonly config: RealSummarizerConfig;
  private readonly creator: MessageCreator;

  constructor(config: RealSummarizerConfig, creator?: MessageCreator) {
    this.config = config;
    this.creator = creator ?? defaultMessageCreator(config);
  }

  /** {@inheritDoc Summarizer.narrateDay} */
  async narrateDay(input: NarrateDayInput): Promise<NarrateDayResult> {
    // Nothing to ask about, so nothing to spend: an empty day never reaches the model.
    if (input.episodes.length === 0) return { highlights: [] };
    const params = buildRequest(input, this.config);
    let message: Message;
    try {
      message = await this.creator(params);
    } catch (cause) {
      throw wrapAnthropicError(cause, 'summarizer');
    }
    return { highlights: reconcileHighlights(input, parseHighlights(extractText(message))) };
  }
}
