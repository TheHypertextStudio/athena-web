/**
 * `@docket/boundaries/real` — `RealProviderRuntime` (Anthropic-backed Athena runtime).
 *
 * @remarks
 * The env-driven {@link AgentRuntime} that drives a real Claude turn via the Anthropic
 * Messages API (`@anthropic-ai/sdk`) and translates the model's streamed reasoning,
 * tool use, and output into the port's {@link SessionActivity} stream
 * (`thought → action(proposed) → response`, plus `elicitation`/`error`). Selected only
 * when `ANTHROPIC_API_KEY` is present and real-shaped (see {@link selectAdapter}) and
 * never in `APP_MODE ∈ {local,test}`. Configuration comes from validated env; the live
 * network/SDK edge goes through an injectable {@link MessageStreamer} so the pure
 * translation logic stays unit-testable. The hosting layer's approval gate is real
 * business logic — side-effecting tool calls surface as `approval: 'proposed'` actions
 * and are NEVER auto-executed here (`boundaries.md` §4).
 *
 * @see {@link MockAgentRuntime} for the deterministic offline counterpart.
 */
import Anthropic from '@anthropic-ai/sdk';
import type {
  MessageCreateParamsBase,
  RawMessageStreamEvent,
} from '@anthropic-ai/sdk/resources/messages';

import type {
  AgentRuntime,
  SessionActionBody,
  SessionActivity,
  StartSessionInput,
} from '../ports/agent-runtime';

/**
 * The current Claude model id Athena drives a session with.
 *
 * @remarks
 * Verified current via the Claude API reference: `claude-opus-4-8` is the latest,
 * most-capable model and the correct default for agentic/tool-use work. Overridable
 * per-instance via {@link RealProviderRuntimeConfig.model} (e.g. to pin a version).
 */
export const DEFAULT_AGENT_MODEL = 'claude-opus-4-8';

/**
 * The default per-turn output ceiling.
 *
 * @remarks
 * Streaming makes a large ceiling safe (no HTTP timeout), so this is generous enough
 * for a full reasoning + tool-proposal + response turn without truncating mid-thought.
 */
export const DEFAULT_MAX_TOKENS = 16000;

/**
 * The system prompt that frames an Athena session.
 *
 * @remarks
 * Instructs the model that it operates behind Docket's approval gate: it proposes
 * side-effecting changes as tool calls (which surface as gated `action` activities)
 * rather than performing them, and asks the human when it needs a decision.
 */
const SYSTEM_PROMPT =
  'You are Athena, an autonomous agent operating inside Docket — a multi-organization ' +
  'command center for Programs, Projects, and Tasks. You work a single delegated task ' +
  'on behalf of a human principal. Reason through the task, then PROPOSE any ' +
  'side-effecting change (creating, updating, or moving work) by calling the ' +
  '`propose_change` tool — never assume a proposal is applied. A human reviews and ' +
  'approves every proposal before it takes effect, so describe each change clearly. ' +
  'When you need a decision from the human before continuing, ask a single concise ' +
  'question. Keep your final response a short summary of what you proposed and why.';

/**
 * The one tool Athena uses to surface a gated, side-effecting change.
 *
 * @remarks
 * A side-effecting action is promoted to a dedicated tool (rather than free-form text)
 * so the hosting layer gets a typed, interceptable proposal it can route through the
 * approval gate. Its `input` maps 1:1 onto {@link SessionActionBody}.
 */
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
 * The real default calls the Anthropic SDK; tests inject a fake that yields a scripted
 * event sequence, so the {@link translateEvents} translation logic is exercised without
 * any network/SDK wiring. This is the single I/O seam of the adapter.
 */
export type MessageStreamer = (
  params: MessageCreateParamsBase,
) => AsyncIterable<RawMessageStreamEvent>;

/**
 * Build the Messages-API request params for one Athena turn.
 *
 * @remarks
 * Pure: maps the port's {@link StartSessionInput} onto a single-user-turn request with
 * adaptive thinking (`display: 'summarized'` so reasoning is translatable into
 * `thought` activities) and the gated `propose_change` tool. The `agent` slug and
 * Docket `sessionId` are threaded into the prompt for traceability.
 *
 * @param input - The session id, task, and agent slug to run.
 * @param config - The validated runtime config (model + token ceiling).
 * @returns the streaming Messages-API request params.
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

/** Internal accumulator for an in-flight content block while its deltas stream in. */
interface BlockBuffer {
  /** The block kind, taken from the `content_block_start` event. */
  readonly type: 'thinking' | 'text' | 'tool_use' | 'other';
  /** Accumulated text/thinking deltas (for `text`/`thinking` blocks). */
  text: string;
  /** Accumulated partial-JSON deltas (for `tool_use` blocks). */
  json: string;
  /** The tool name (for `tool_use` blocks). */
  toolName: string;
}

/**
 * Parse an accumulated `tool_use` block into a gated {@link SessionActionBody}.
 *
 * @remarks
 * Pure. Tolerant of blank/invalid JSON (Claude may emit no input deltas): falls back to
 * the tool name as `kind` and a generic summary. Always yields a well-formed body so a
 * proposed action is never dropped.
 *
 * @param toolName - The tool the model invoked.
 * @param partialJson - The concatenated `input_json_delta` payload (may be empty).
 * @returns the structured proposed-change body.
 */
export function toActionBody(toolName: string, partialJson: string): SessionActionBody {
  let parsed: Record<string, unknown> = {};
  const trimmed = partialJson.trim();
  if (trimmed) {
    try {
      const obj: unknown = JSON.parse(trimmed);
      if (obj && typeof obj === 'object') parsed = obj as Record<string, unknown>;
    } catch {
      // Malformed/partial input — fall through to name-derived defaults.
    }
  }
  const rawKind = parsed['kind'];
  const rawSummary = parsed['summary'];
  const rawDiff = parsed['diff'];
  const kind = typeof rawKind === 'string' && rawKind ? rawKind : toolName;
  const summary =
    typeof rawSummary === 'string' && rawSummary ? rawSummary : `Proposed ${toolName}`;
  const body: SessionActionBody = {
    kind,
    summary,
    ...(rawDiff !== undefined ? { diff: rawDiff } : {}),
  };
  return body;
}

/** Classify a `content_block_start` block kind into our buffer kind. */
function blockKind(type: string): BlockBuffer['type'] {
  if (type === 'thinking') return 'thinking';
  if (type === 'text') return 'text';
  if (type === 'tool_use') return 'tool_use';
  return 'other';
}

/**
 * Translate a stream of raw Anthropic events into the port's activity stream.
 *
 * @remarks
 * Pure and fully unit-testable (no network). Accumulates each content block's deltas
 * and, on `content_block_stop`, emits the corresponding {@link SessionActivity}:
 * - `thinking` block → `thought`
 * - `text` block → `response`
 * - `tool_use` block → `action` (a {@link SessionActionBody}) with `approval: 'proposed'`
 *   — the human-approval gate; side-effecting actions are never auto-executed.
 * A `message_delta` with `stop_reason: 'refusal'` is surfaced as an `error` activity.
 * Blank `thought`/`response` blocks (the adaptive thinking default can omit text) are
 * skipped so the stream carries only meaningful activities.
 *
 * @param events - The async stream of raw Messages-API events.
 * @returns an async iterable of {@link SessionActivity} in emission order.
 */
export async function* translateEvents(
  events: AsyncIterable<RawMessageStreamEvent>,
): AsyncIterable<SessionActivity> {
  const blocks = new Map<number, BlockBuffer>();
  for await (const event of events) {
    switch (event.type) {
      case 'content_block_start': {
        blocks.set(event.index, {
          type: blockKind(event.content_block.type),
          text: '',
          json: '',
          toolName: event.content_block.type === 'tool_use' ? event.content_block.name : '',
        });
        break;
      }
      case 'content_block_delta': {
        const buf = blocks.get(event.index);
        if (!buf) break;
        const delta = event.delta;
        if (delta.type === 'text_delta') buf.text += delta.text;
        else if (delta.type === 'thinking_delta') buf.text += delta.thinking;
        else if (delta.type === 'input_json_delta') buf.json += delta.partial_json;
        break;
      }
      case 'content_block_stop': {
        const buf = blocks.get(event.index);
        if (!buf) break;
        blocks.delete(event.index);
        if (buf.type === 'thinking') {
          const body = buf.text.trim();
          if (body) yield { type: 'thought', body };
        } else if (buf.type === 'text') {
          const body = buf.text.trim();
          if (body) yield { type: 'response', body };
        } else if (buf.type === 'tool_use') {
          yield {
            type: 'action',
            body: toActionBody(buf.toolName, buf.json),
            approval: 'proposed',
          };
        }
        break;
      }
      case 'message_delta': {
        if (event.delta.stop_reason === 'refusal') {
          yield {
            type: 'error',
            body: 'The agent declined to complete this task (model refusal).',
          };
        }
        break;
      }
      default:
        // message_start / message_stop carry no activity payload.
        break;
    }
  }
}

/**
 * A real, env-driven agent runtime backed by the Anthropic Messages API.
 *
 * @remarks
 * `startSession` drives one Claude turn for the delegated task and streams the model's
 * reasoning/tool-use/output as {@link SessionActivity}. The live SDK call is the only
 * non-deterministic edge and is isolated behind {@link MessageStreamer}; all mapping is
 * pure ({@link buildRequest}, {@link translateEvents}, {@link toActionBody}).
 */
export class RealProviderRuntime implements AgentRuntime {
  private readonly config: RealProviderRuntimeConfig;
  private readonly streamer: MessageStreamer;

  /**
   * @param config - Validated Anthropic config from env (API key + optional model/baseURL).
   * @param streamer - The live message streamer; defaults to one backed by the Anthropic SDK.
   */
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

/**
 * Wrap a thrown SDK/network error as a clear, secret-free {@link Error}.
 *
 * @remarks
 * Surfaces the Anthropic API status when present (typed {@link Anthropic.APIError}) and
 * never includes the request body or credentials in the message.
 *
 * @param cause - The original thrown value.
 * @returns a normalized error describing the failure.
 */
export function wrapError(cause: unknown): Error {
  if (cause instanceof Anthropic.APIError) {
    // `status` is the HTTP status of the failed call; read it via an unknown view so
    // the message never depends on the SDK's loosely-typed field. Never include the
    // request body or credentials.
    const rawStatus: unknown = (cause as { status?: unknown }).status;
    const status = typeof rawStatus === 'number' ? rawStatus : 'unknown';
    return new Error(`Anthropic agent runtime failed: ${status} (${cause.name})`);
  }
  if (cause instanceof Error) {
    return new Error(`Anthropic agent runtime failed: ${cause.message}`);
  }
  return new Error('Anthropic agent runtime failed: unknown error');
}

/**
 * Build the default {@link MessageStreamer} backed by the Anthropic SDK.
 *
 * @remarks
 * The SDK client construction and the live `messages.stream` call are the
 * un-unit-testable IO edge (they only run against the real service), so they are
 * excluded from coverage; the translation/mapping around them is fully tested.
 *
 * @param config - The validated runtime config.
 * @returns a streamer that yields raw Messages-API events from the live API.
 */
export function defaultMessageStreamer(config: RealProviderRuntimeConfig): MessageStreamer {
  /* v8 ignore start -- live Anthropic SDK edge; verified by running against the real API */
  const client = new Anthropic({
    apiKey: config.apiKey,
    ...(config.baseURL ? { baseURL: config.baseURL } : {}),
  });
  return (params) => client.messages.stream(params);
  /* v8 ignore stop */
}
