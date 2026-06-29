/**
 * `@docket/boundaries/real` — `RealProviderRuntime` (Anthropic-backed Athena runtime).
 *
 * @remarks
 * The env-driven {@link AgentRuntime} that drives a real Claude turn via the Anthropic
 * Messages API (`@anthropic-ai/sdk`) and translates the model's streamed reasoning,
 * tool use, and output into the port's {@link SessionActivity} stream.
 * Selected only when `ANTHROPIC_API_KEY` is present and never in `APP_MODE ∈ {local,test}`.
 *
 * Pure translation logic (`toActionBody`, `translateEvents`) lives in
 * `agent-runtime-translate.ts` and is unit-testable without network/SDK wiring.
 *
 * @see {@link MockAgentRuntime} for the deterministic offline counterpart.
 */
import type Anthropic from '@anthropic-ai/sdk';
import type {
  MessageCreateParamsBase,
  RawMessageStreamEvent,
} from '@anthropic-ai/sdk/resources/messages';

import type { AgentRuntime, SessionActivity, StartSessionInput } from '../ports/agent-runtime';
import { makeAnthropicClient, wrapAnthropicError } from './anthropic';
import { translateEvents } from './agent-runtime-translate';

export { blockKind, toActionBody, translateEvents } from './agent-runtime-translate';
export type { BlockBuffer } from './agent-runtime-translate';

/**
 * The current Claude model id Athena drives a session with.
 *
 * @remarks
 * `claude-opus-4-8` is the latest, most-capable model and the correct default for
 * agentic/tool-use work. Overridable via {@link RealProviderRuntimeConfig.model}.
 */
export const DEFAULT_AGENT_MODEL = 'claude-opus-4-8';

/**
 * The default per-turn output ceiling.
 *
 * @remarks
 * Generous enough for a full reasoning + tool-proposal + response turn.
 */
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
    'Propose a single side-effecting change to Docket (e.g. update_task, create_task, ' +
    'move_task). The change is NOT applied — it is queued for human approval. Call this ' +
    'once per discrete change you want to make.',
  input_schema: {
    type: 'object',
    properties: {
      kind: {
        type: 'string',
        description: 'The action kind, e.g. "update_task", "create_task", "move_task".',
      },
      summary: {
        type: 'string',
        description: 'A short human-readable summary of the proposed change.',
      },
      diff: {
        type: 'object',
        description: 'Optional structured description of the change (before/after, fields set).',
      },
    },
    required: ['kind', 'summary'],
  },
};

/** Validated configuration for {@link RealProviderRuntime} (sourced from env). */
export interface RealProviderRuntimeConfig {
  /** Anthropic API key (`sk-ant-...`). Read from `ANTHROPIC_API_KEY`. */
  readonly apiKey: string;
  /** Model id override; defaults to {@link DEFAULT_AGENT_MODEL}. */
  readonly model?: string;
  /** Per-turn output token ceiling; defaults to {@link DEFAULT_MAX_TOKENS}. */
  readonly maxTokens?: number;
  /** Base URL override (e.g. a gateway/proxy); defaults to the Anthropic API. */
  readonly baseURL?: string;
}

/**
 * The injectable live edge: turns Messages-API params into a stream of raw events.
 *
 * @remarks
 * The real default calls the Anthropic SDK; tests inject a fake so the translation logic
 * is exercised without any network/SDK wiring. This is the single I/O seam.
 */
export type MessageStreamer = (
  params: MessageCreateParamsBase,
) => AsyncIterable<RawMessageStreamEvent>;

/**
 * Build the Messages-API request params for one Athena turn.
 *
 * @remarks
 * Pure: maps {@link StartSessionInput} onto a single-user-turn request with adaptive
 * thinking and the gated `propose_change` tool.
 *
 * @param input - The session id, task, and agent slug to run.
 * @param config - The validated runtime config (model + token ceiling).
 */
export function buildRequest(
  input: StartSessionInput,
  config: RealProviderRuntimeConfig,
): MessageCreateParamsBase {
  const userText =
    `You are running as agent "${input.agent}" for Docket session ${input.sessionId}.\n\n` +
    `Task:\n${input.task}`;
  return {
    model: config.model ?? DEFAULT_AGENT_MODEL,
    max_tokens: config.maxTokens ?? DEFAULT_MAX_TOKENS,
    system: SYSTEM_PROMPT,
    thinking: { type: 'adaptive', display: 'summarized' },
    tools: [PROPOSE_CHANGE_TOOL],
    messages: [{ role: 'user', content: userText }],
  };
}

/**
 * Wrap a thrown SDK/network error as a clear, secret-free {@link Error}.
 *
 * @param cause - The original thrown value.
 */
export function wrapError(cause: unknown): Error {
  return wrapAnthropicError(cause, 'agent runtime');
}

/**
 * Build the default {@link MessageStreamer} backed by the Anthropic SDK.
 *
 * @param config - The validated runtime config.
 */
export function defaultMessageStreamer(config: RealProviderRuntimeConfig): MessageStreamer {
  /* v8 ignore start -- live Anthropic SDK edge */
  const client = makeAnthropicClient(config);
  return (params) => client.messages.stream(params);
  /* v8 ignore stop */
}

/**
 * A real, env-driven agent runtime backed by the Anthropic Messages API.
 *
 * @remarks
 * `startSession` drives one Claude turn for the delegated task and streams the model's
 * reasoning/tool-use/output as {@link SessionActivity}.
 */
export class RealProviderRuntime implements AgentRuntime {
  private readonly config: RealProviderRuntimeConfig;
  private readonly streamer: MessageStreamer;

  constructor(config: RealProviderRuntimeConfig, streamer?: MessageStreamer) {
    this.config = config;
    this.streamer = streamer ?? defaultMessageStreamer(config);
  }

  /** {@inheritDoc AgentRuntime.startSession} */
  async *startSession(input: StartSessionInput): AsyncIterable<SessionActivity> {
    const params = buildRequest(input, this.config);
    let events: AsyncIterable<RawMessageStreamEvent>;
    try {
      events = this.streamer(params);
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
