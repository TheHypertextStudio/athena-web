import type {
  Message,
  MessageCreateParamsNonStreaming,
} from '@anthropic-ai/sdk/resources/messages';

import { makeAnthropicClient, wrapAnthropicError } from './anthropic';
import type {
  NarrateDayInput,
  NarrateDayResult,
  NarratedHighlight,
  NarrationEpisode,
  Summarizer,
} from './digest-contracts';

/** Default model for a once-daily per-episode narration pass. */
export const DEFAULT_SUMMARIZER_MODEL = 'claude-opus-4-8';
/** Output ceiling for a day's bounded set of short highlights. */
export const DEFAULT_MAX_TOKENS = 4000;

const SYSTEM_PROMPT =
  'You are Athena, a chief-of-staff assistant inside Docket. You are given the episodes of one ' +
  "person's working day, each with a stable key. Write ONE sentence per episode, in the first " +
  'person and the past tense: write "I merged the pull request", not "Willie merged the pull ' +
  'request". Describe only what that person did from the events given: ' +
  'never invent detail, and never state that somebody attended a meeting, only that they had one. ' +
  'Keep each sentence to one clause or two. Reply with JSON only, in the shape ' +
  '{"highlights":[{"key":"<the key you were given>","sentence":"<one sentence>"}]}, with exactly ' +
  'one entry per episode and the keys copied verbatim.';

/** Validated configuration for the live Anthropic-backed day narrator. */
export interface RealSummarizerConfig {
  /** Anthropic API key. */
  readonly apiKey: string;
  /** Optional model override. */
  readonly model?: string;
  /** Optional output-token ceiling. */
  readonly maxTokens?: number;
  /** Optional provider or gateway base URL. */
  readonly baseURL?: string;
}

/** Injectable boundary for one completed provider message. */
export type MessageCreator = (params: MessageCreateParamsNonStreaming) => Promise<Message>;

/** Flatten one narration episode into one factual prompt block. */
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
 * Build the one non-streaming provider request that narrates all episodes for a day.
 *
 * @param input - Day context and the chronological episodes to narrate.
 * @param config - Resolved live adapter configuration.
 * @returns the provider request.
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

/** Extract the concatenated text content from a completed provider message. */
export function extractText(message: Message): string {
  return message.content
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('')
    .trim();
}

/**
 * Parse model JSON into the first nonblank sentence for each returned episode key.
 *
 * @remarks
 * A response is untrusted until reconciliation. Invalid JSON, prose around JSON, malformed rows,
 * duplicate keys, and unknown keys all degrade only the affected episode rather than the day.
 *
 * @param text - Raw model response text.
 * @returns a partial key-to-sentence map.
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
  if (typeof parsed !== 'object' || parsed === null) return byKey;
  const highlights = (parsed as { highlights?: unknown }).highlights;
  if (!Array.isArray(highlights)) return byKey;

  for (const entry of highlights) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { key, sentence } = entry as { key?: unknown; sentence?: unknown };
    if (typeof key !== 'string' || typeof sentence !== 'string') continue;
    const trimmed = sentence.trim();
    if (trimmed.length > 0 && !byKey.has(key)) byKey.set(key, trimmed);
  }
  return byKey;
}

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
 * Build application-owned narration for an episode a model response did not cover.
 *
 * @param episode - The factual episode to describe.
 * @returns a deterministic first-person sentence.
 */
export function fallbackSentence(episode: NarrationEpisode): string {
  const subject = episode.subject ?? episode.events[0]?.title ?? 'something';
  const kind = episode.events[0]?.kind ?? '';
  const phrase = KIND_PHRASE[kind] ?? 'worked on';
  const more = episode.events.length > 1 ? ` (${String(episode.events.length)} updates)` : '';
  return `I ${phrase} ${subject}${more}.`;
}

/**
 * Reconcile a partial model reply to the caller's episodes.
 *
 * @param input - Requested episodes, which define the authoritative order and membership.
 * @param parsed - Model sentences keyed by episode.
 * @returns one trusted highlight per input episode.
 */
export function reconcileHighlights(
  input: NarrateDayInput,
  parsed: ReadonlyMap<string, string>,
): NarratedHighlight[] {
  return input.episodes.map((episode) => ({
    key: episode.key,
    sentence: parsed.get(episode.key) ?? fallbackSentence(episode),
  }));
}

/** Build the default live provider completion boundary. */
export function defaultMessageCreator(config: RealSummarizerConfig): MessageCreator {
  /* v8 ignore start -- live provider SDK edge */
  const client = makeAnthropicClient(config);
  return (params) => client.messages.create(params);
  /* v8 ignore stop */
}

/** Live implementation of Athena's per-episode daily-narration port. */
export class RealSummarizer implements Summarizer {
  private readonly config: RealSummarizerConfig;
  private readonly creator: MessageCreator;

  constructor(config: RealSummarizerConfig, creator?: MessageCreator) {
    this.config = config;
    this.creator = creator ?? defaultMessageCreator(config);
  }

  /** Narrate all episodes in one request, or return immediately for an empty day. */
  async narrateDay(input: NarrateDayInput): Promise<NarrateDayResult> {
    if (input.episodes.length === 0) return { highlights: [] };

    let message: Message;
    try {
      message = await this.creator(buildRequest(input, this.config));
    } catch (cause) {
      throw wrapAnthropicError(cause, 'summarizer');
    }
    return { highlights: reconcileHighlights(input, parseHighlights(extractText(message))) };
  }
}
