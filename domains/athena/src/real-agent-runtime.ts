import type Anthropic from '@anthropic-ai/sdk';
import type {
  MessageCreateParamsBase,
  RawMessageStreamEvent,
} from '@anthropic-ai/sdk/resources/messages';

import { makeAnthropicClient, wrapAnthropicError } from './anthropic';
import type { AgentRuntime, SessionActivity, StartSessionInput } from './agent-session-contracts';
import { translateEvents } from './agent-session-translation';

/** Current default model for an Athena delegated session. */
export const DEFAULT_AGENT_MODEL = 'claude-opus-4-8';
/** Generous per-turn output ceiling for reasoning, proposed actions, and a final response. */
export const DEFAULT_MAX_TOKENS = 16000;

const SYSTEM_PROMPT =
  'You are Athena, an autonomous agent operating inside Docket — a multi-organization ' +
  'command center for Programs, Projects, and Tasks. You work a single delegated task ' +
  'on behalf of a human principal. Reason through the task, then PROPOSE any ' +
  'side-effecting change (creating, updating, or moving work) by calling the ' +
  '`propose_change` tool — never assume a proposal is applied. A human reviews and ' +
  'approves every proposal before it takes effect, so describe each change clearly. ' +
  'When you need a decision from the human before continuing, ask a single concise ' +
  'question. Keep your final response a short summary of what you proposed and why.';

const PROPOSE_CHANGE_TOOL: Anthropic.Tool = {
  name: 'propose_change',
  description:
    'Propose a single side-effecting change to Docket. The change is queued for human approval ' +
    'and is never applied directly by this tool call.',
  input_schema: {
    type: 'object',
    properties: {
      kind: { type: 'string', description: 'Action kind such as update_task or create_task.' },
      summary: { type: 'string', description: 'Short human-readable change summary.' },
      diff: { type: 'object', description: 'Optional structured description of the change.' },
    },
    required: ['kind', 'summary'],
  },
};

/** Validated configuration for the Anthropic-backed agent-session adapter. */
export interface RealProviderRuntimeConfig {
  /** Anthropic API key. */
  readonly apiKey: string;
  /** Optional model override. */
  readonly model?: string;
  /** Optional response-token ceiling. */
  readonly maxTokens?: number;
  /** Optional provider or gateway base URL. */
  readonly baseURL?: string;
}

/** Injectable I/O boundary for provider event streaming. */
export type MessageStreamer = (
  params: MessageCreateParamsBase,
) => AsyncIterable<RawMessageStreamEvent>;

/** Build the one-turn provider request for a delegated Athena task. */
export function buildRequest(
  input: StartSessionInput,
  config: RealProviderRuntimeConfig,
): MessageCreateParamsBase {
  return {
    model: config.model ?? DEFAULT_AGENT_MODEL,
    max_tokens: config.maxTokens ?? DEFAULT_MAX_TOKENS,
    system: SYSTEM_PROMPT,
    thinking: { type: 'adaptive', display: 'summarized' },
    tools: [PROPOSE_CHANGE_TOOL],
    messages: [
      {
        role: 'user',
        content:
          `You are running as agent "${input.agent}" for Docket session ${input.sessionId}.\n\n` +
          `Task:\n${input.task}`,
      },
    ],
  };
}

/** Wrap a provider runtime failure without exposing configuration values. */
export function wrapError(cause: unknown): Error {
  return wrapAnthropicError(cause, 'agent runtime');
}

/** Build the default live provider streamer. */
export function defaultMessageStreamer(config: RealProviderRuntimeConfig): MessageStreamer {
  /* v8 ignore start -- live provider SDK edge */
  const client = makeAnthropicClient(config);
  return (params) => client.messages.stream(params);
  /* v8 ignore stop */
}

/** Anthropic-backed implementation of Athena's provider-neutral session port. */
export class RealProviderRuntime implements AgentRuntime {
  private readonly config: RealProviderRuntimeConfig;
  private readonly streamer: MessageStreamer;

  constructor(config: RealProviderRuntimeConfig, streamer?: MessageStreamer) {
    this.config = config;
    this.streamer = streamer ?? defaultMessageStreamer(config);
  }

  /** Start one provider turn and translate its event stream to approved Athena activities. */
  async *startSession(input: StartSessionInput): AsyncIterable<SessionActivity> {
    const request = buildRequest(input, this.config);
    let events: AsyncIterable<RawMessageStreamEvent>;
    try {
      events = this.streamer(request);
    } catch (cause) {
      throw wrapError(cause);
    }
    try {
      yield* translateEvents(events);
    } catch (cause) {
      throw wrapError(cause);
    }
  }
}
