/** Anthropic Messages adapter for Athena's provider-neutral one-turn boundary. */
import type Anthropic from '@anthropic-ai/sdk';
import type {
  ContentBlockParam,
  MessageCreateParamsBase,
  MessageParam,
  RawMessageStreamEvent,
} from '@anthropic-ai/sdk/resources/messages';

import type { TurnContentBlock } from '../../turn-protocol';
import { makeAnthropicClient, wrapAnthropicError } from '../../anthropic';

import type { AgentTurnRuntime, TurnEvent, TurnInput } from '../turn';
import { translateTurnEvents } from '../translate';

export { parseToolInput, toStopReason, translateTurnEvents } from '../translate';

/** Default Claude model Athena uses for a turn. */
export const DEFAULT_TURN_MODEL = 'claude-opus-4-8';

/** Default output-token ceiling for one Athena turn. */
export const DEFAULT_TURN_MAX_TOKENS = 16000;

/** Validated configuration for {@link RealAgentTurnRuntime}. */
export interface RealAgentTurnRuntimeConfig {
  /** Anthropic API key. */
  readonly apiKey: string;
  /** Optional model override. */
  readonly model?: string;
  /** Optional output-token ceiling. */
  readonly maxTokens?: number;
  /** Optional provider or gateway base URL. */
  readonly baseURL?: string;
  /** Optional Cloudflare AI Gateway credential. */
  readonly gatewayToken?: string;
}

/** Injectable provider I/O boundary used by tests and non-HTTP delivery adapters. */
export type TurnStreamer = (
  params: MessageCreateParamsBase,
) => AsyncIterable<RawMessageStreamEvent>;

/** Map one durable Athena content block into its Anthropic Messages API shape. */
function toProviderBlock(block: TurnContentBlock): ContentBlockParam {
  switch (block.type) {
    case 'text':
      return { type: 'text', text: block.text };
    case 'thinking':
      return { type: 'thinking', thinking: block.thinking, signature: block.signature };
    case 'tool_use':
      return { type: 'tool_use', id: block.id, name: block.name, input: block.input };
    case 'tool_result':
      return {
        type: 'tool_result',
        tool_use_id: block.toolUseId,
        content: block.content,
        is_error: block.isError,
      };
  }
}

/** Build the Messages API request for one turn without doing any network I/O. */
export function buildTurnRequest(
  input: TurnInput,
  config: RealAgentTurnRuntimeConfig,
): MessageCreateParamsBase {
  const messages: MessageParam[] = input.messages.map((message) => ({
    role: message.role,
    content: message.content.map(toProviderBlock),
  }));
  const tools: Anthropic.Tool[] = input.tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema as Anthropic.Tool['input_schema'],
  }));

  return {
    model: config.model ?? DEFAULT_TURN_MODEL,
    max_tokens: config.maxTokens ?? DEFAULT_TURN_MAX_TOKENS,
    system: input.system,
    thinking: { type: 'adaptive', display: 'summarized' },
    tools,
    messages,
  };
}

/** Turn an SDK or network failure into a clear, secret-free Athena error. */
export function wrapTurnError(cause: unknown): Error {
  return wrapAnthropicError(cause, 'agent turn runtime');
}

/** Build the default SDK-backed streamer after configuration has already been validated. */
export function defaultTurnStreamer(config: RealAgentTurnRuntimeConfig): TurnStreamer {
  /* v8 ignore start -- live provider SDK edge */
  const client = makeAnthropicClient(config);
  return (params) => client.messages.stream(params);
  /* v8 ignore stop */
}

/** Real one-turn runtime backed by Anthropic's streaming Messages API. */
export class RealAgentTurnRuntime implements AgentTurnRuntime {
  private readonly config: RealAgentTurnRuntimeConfig;
  private readonly streamer: TurnStreamer;

  /** Create a runtime with either an injected test seam or the live SDK streamer. */
  constructor(config: RealAgentTurnRuntimeConfig, streamer?: TurnStreamer) {
    this.config = config;
    this.streamer = streamer ?? defaultTurnStreamer(config);
  }

  /** Stream the translated events for exactly one provider turn. */
  async *streamTurn(input: TurnInput): AsyncIterable<TurnEvent> {
    const params = buildTurnRequest(input, this.config);
    let events: AsyncIterable<RawMessageStreamEvent>;

    try {
      events = this.streamer(params);
    } catch (cause) {
      throw wrapTurnError(cause);
    }

    try {
      yield* translateTurnEvents(events);
    } catch (cause) {
      throw wrapTurnError(cause);
    }
  }
}
