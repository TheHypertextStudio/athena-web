/**
 * Anthropic-backed implementation of the one-turn agent runtime.
 */
import type Anthropic from '@anthropic-ai/sdk';
import type {
  ContentBlockParam,
  MessageCreateParamsBase,
  MessageParam,
  RawMessageStreamEvent,
} from '@anthropic-ai/sdk/resources/messages';

import type { AgentTurnRuntime, TurnContentBlock, TurnEvent, TurnInput } from './agent-turn';
import { translateTurnEvents } from './agent-turn-translate';
import { makeAnthropicClient, wrapAnthropicError } from './anthropic';

export { parseToolInput, toStopReason, translateTurnEvents } from './agent-turn-translate';

/** The default Claude model Athena drives turns with. */
export const DEFAULT_TURN_MODEL = 'claude-opus-4-8';

/** The default per-turn output ceiling. */
export const DEFAULT_TURN_MAX_TOKENS = 16000;

/** Validated configuration for {@link RealAgentTurnRuntime}. */
export interface RealAgentTurnRuntimeConfig {
  /** Anthropic API key. */
  readonly apiKey: string;
  /** Model id override. */
  readonly model?: string;
  /** Per-turn output token ceiling. */
  readonly maxTokens?: number;
  /** Base URL override. */
  readonly baseURL?: string;
}

/** The injectable live edge that streams raw provider events. */
export type TurnStreamer = (
  params: MessageCreateParamsBase,
) => AsyncIterable<RawMessageStreamEvent>;

/** Map one port content block onto its Messages API param shape. */
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

/**
 * Build the Messages API request params for one agent turn.
 *
 * @param input - The conversation state and available tools.
 * @param config - The validated runtime config.
 */
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

/**
 * Wrap a thrown SDK/network error as a clear, secret-free {@link Error}.
 *
 * @param cause - The original thrown value.
 */
export function wrapTurnError(cause: unknown): Error {
  return wrapAnthropicError(cause, 'agent turn runtime');
}

/**
 * Build the default SDK-backed turn streamer.
 *
 * @param config - The validated runtime config.
 */
export function defaultTurnStreamer(config: RealAgentTurnRuntimeConfig): TurnStreamer {
  /* v8 ignore start -- live Anthropic SDK edge */
  const client = makeAnthropicClient(config);
  return (params) => client.messages.stream(params);
  /* v8 ignore stop */
}

/** A real, env-driven one-turn runtime backed by Anthropic Messages. */
export class RealAgentTurnRuntime implements AgentTurnRuntime {
  private readonly config: RealAgentTurnRuntimeConfig;
  private readonly streamer: TurnStreamer;

  /**
   * @param config - Runtime configuration.
   * @param streamer - Optional test seam for raw provider events.
   */
  constructor(config: RealAgentTurnRuntimeConfig, streamer?: TurnStreamer) {
    this.config = config;
    this.streamer = streamer ?? defaultTurnStreamer(config);
  }

  /** {@inheritDoc AgentTurnRuntime.streamTurn} */
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
