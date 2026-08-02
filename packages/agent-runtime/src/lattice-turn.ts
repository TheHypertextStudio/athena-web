/**
 * `@docket/agent-runtime` — the turn runtime that runs Athena on a person's own device.
 *
 * @remarks
 * This is the same {@link AgentTurnRuntime} port the Cloudflare-routed and direct backends
 * implement, which is the whole point of the seam: the durable loop, approval gating, transcript
 * persistence and resume behave identically no matter whose hardware answered.
 *
 * ## Why this file declares a port instead of importing the gateway client
 *
 * `@docket/agent-runtime` deliberately depends on nothing but `@docket/types` and a provider SDK.
 * Reaching into `@docket/integrations` for the Lattice HTTP client would put a boundary adapter
 * inside the package that defines the ports, and would make the loop's own package transitively
 * own OAuth. So the network edge arrives as {@link LatticeChatPort}, injected by `apps/api`, which
 * already depends on both. The translation below — which is the part with real logic — stays here
 * and stays testable with no network at all.
 *
 * ## Two differences from the provider-native backends, both forced by the wire
 *
 * 1. **Tool calling is a text protocol.** Lattice's compatibility surface carries text-only
 *    messages, so tools are described in the system prompt and a call is a fenced JSON block. See
 *    {@link ./lattice-tool-protocol.ts} for the format and the reasoning.
 * 2. **A turn arrives whole, not streamed.** The gateway's chat route is request/response. The
 *    port is an async iterable, so this emits the same event sequence a streaming backend would —
 *    just all at once at the end. Chunking a finished string to look like streaming would be a
 *    lie about latency, so it is not done.
 *
 * ## There is no fallback
 *
 * If the device is asleep, the port throws and the turn fails. This runtime never catches that and
 * never substitutes another model. Someone who chose local inference for privacy must be able to
 * tell, from Docket, whether their data left the machine — and a quiet hop to a cloud model would
 * take that away silently.
 */
import type {
  AgentTurnRuntime,
  TurnEvent,
  TurnInput,
  TurnMessage,
  TurnStopReason,
} from './agent-turn';
import {
  latticeToolUseId,
  parseLatticeReply,
  renderToolCall,
  renderToolInstructions,
  renderToolResult,
} from './lattice-tool-protocol';

/** Default output ceiling for a turn served by a local model. */
export const DEFAULT_LATTICE_MAX_TOKENS = 4096;

/**
 * One message on Lattice's OpenAI-compatible wire.
 *
 * @remarks
 * Structurally the gateway's `OpenAiChatMessage`. Restated here rather than imported so this
 * package keeps its dependency-free port boundary; the API layer passes the same objects straight
 * through to the SDK, so a drift would fail to typecheck at the wiring site.
 */
export interface LatticeChatMessage {
  /** Who authored the message. */
  readonly role: 'system' | 'user' | 'assistant' | 'developer';
  /** The message text. */
  readonly content: string;
}

/** One turn dispatched to the person's device. */
export interface LatticeChatPortRequest {
  /** The flattened conversation, system message first. */
  readonly messages: readonly LatticeChatMessage[];
  /** Output token ceiling. */
  readonly maxTokens: number;
  /** Sampling temperature, when the caller set one. */
  readonly temperature?: number;
}

/** What the device sent back. */
export interface LatticeChatPortResult {
  /** The reply text. */
  readonly text: string;
  /** The provider's finish reason, when it reported one. */
  readonly finishReason?: string;
  /** The model id the device actually served with, for attribution. */
  readonly model?: string;
}

/**
 * The injected network edge: run one chat turn on the chosen device.
 *
 * @remarks
 * Implementations must fail loudly. A port that answers with cloud output when the device is
 * unreachable would silently break the guarantee this whole backend exists to provide.
 */
export interface LatticeChatPort {
  /**
   * Run one turn on the person's device.
   *
   * @param request - The conversation and sampling options.
   */
  runChat(request: LatticeChatPortRequest): Promise<LatticeChatPortResult>;
}

/** What the runtime needs to run one person's turns. */
export interface LatticeTurnRuntimeConfig {
  /** The injected network edge. */
  readonly chat: LatticeChatPort;
  /** Output token ceiling. */
  readonly maxTokens?: number;
  /** Sampling temperature. */
  readonly temperature?: number;
}

/**
 * Flatten Athena's block-structured transcript into the gateway's text-only messages.
 *
 * @remarks
 * Three deliberate decisions:
 *
 * - **`thinking` blocks are dropped.** They exist to be replayed verbatim with a provider
 *   integrity signature only their original provider can validate. Forwarding a foreign signature
 *   to a local model is meaningless, and re-sending the reasoning text alone invites the model to
 *   treat another model's private deliberation as instruction.
 * - **An assistant `tool_use` is re-rendered in the protocol's own vocabulary** so the model sees
 *   its earlier call written exactly the way it was taught to write one.
 * - **A `tool_result` becomes a user message**, because the wire has no `tool` role. It is marked
 *   so the model can tell a returned result from something the person typed.
 *
 * @param messages - The durable transcript.
 * @returns The flattened conversation, with empty messages dropped.
 */
export function flattenTranscript(messages: readonly TurnMessage[]): readonly LatticeChatMessage[] {
  const flattened: LatticeChatMessage[] = [];
  for (const message of messages) {
    const parts: string[] = [];
    for (const block of message.content) {
      switch (block.type) {
        case 'text':
          if (block.text.trim().length > 0) parts.push(block.text);
          break;
        case 'thinking':
          break;
        case 'tool_use':
          parts.push(renderToolCall(block.name, block.input));
          break;
        case 'tool_result':
          parts.push(renderToolResult(block.toolUseId, block.content, block.isError));
          break;
      }
    }
    const content = parts.join('\n\n').trim();
    if (content.length === 0) continue;
    // A `tool_result` is authored by the host, not the model, so it rides on the user side no
    // matter which transcript message carried it.
    const carriesToolResult = message.content.some((block) => block.type === 'tool_result');
    const role: LatticeChatMessage['role'] =
      message.role === 'assistant' && !carriesToolResult ? 'assistant' : 'user';
    flattened.push({ role, content });
  }
  return flattened;
}

/**
 * Count the tool calls already in a transcript.
 *
 * @remarks
 * The next synthesized tool-use id continues this count, which is what keeps ids unique and stable
 * across a resume — the id is the join key between a `tool_use` block and the `tool_result` that
 * answers it, and both are persisted.
 *
 * @param messages - The durable transcript.
 * @returns How many `tool_use` blocks it already holds.
 */
export function countToolUses(messages: readonly TurnMessage[]): number {
  let count = 0;
  for (const message of messages) {
    for (const block of message.content) {
      if (block.type === 'tool_use') count += 1;
    }
  }
  return count;
}

/**
 * Map the device's finish reason onto the port's stop reason.
 *
 * @param finishReason - Whatever the device's model server reported, if anything.
 * @returns The port-level stop reason for a reply that was not a tool call.
 */
export function toLatticeStopReason(finishReason: string | undefined): TurnStopReason {
  if (finishReason === 'length' || finishReason === 'max_tokens') return 'max_tokens';
  if (finishReason === 'content_filter' || finishReason === 'refusal') return 'refusal';
  return 'end_turn';
}

/**
 * Build the full message list for one turn, system prompt and tool instructions included.
 *
 * @remarks
 * Exported because it is the exact payload that reaches someone's own machine, and a test that
 * asserts on it is the only way to be sure Athena is not shipping more than it means to.
 *
 * @param input - The system prompt, transcript, and tools for this turn.
 * @returns The messages to dispatch.
 */
export function buildLatticeTurnMessages(input: TurnInput): readonly LatticeChatMessage[] {
  return [
    { role: 'system', content: `${input.system}${renderToolInstructions(input.tools)}` },
    ...flattenTranscript(input.messages),
  ];
}

/** A turn runtime whose model work executes on the person's own paired device. */
export class LatticeAgentTurnRuntime implements AgentTurnRuntime {
  private readonly config: LatticeTurnRuntimeConfig;

  /**
   * @param config - The injected chat edge and sampling options.
   */
  constructor(config: LatticeTurnRuntimeConfig) {
    this.config = config;
  }

  /**
   * Run one turn on the device and emit the port's events.
   *
   * @remarks
   * Nothing here catches. A failure from the injected port carries its own actionable reason, and
   * wrapping it would either lose that reason or invite a fallback.
   *
   * @param input - The system prompt, transcript, and tools for this turn.
   * @yields {TurnEvent} The turn's text or tool call, then `turn_end`.
   */
  async *streamTurn(input: TurnInput): AsyncIterable<TurnEvent> {
    const result = await this.config.chat.runChat({
      messages: buildLatticeTurnMessages(input),
      maxTokens: this.config.maxTokens ?? DEFAULT_LATTICE_MAX_TOKENS,
      ...(this.config.temperature === undefined ? {} : { temperature: this.config.temperature }),
    });

    const parsed = parseLatticeReply(
      result.text,
      input.tools.map((tool) => tool.name),
    );

    if (parsed.kind === 'tool_call') {
      const id = latticeToolUseId(countToolUses(input.messages));
      const message: TurnMessage = {
        role: 'assistant',
        content: [{ type: 'tool_use', id, name: parsed.name, input: parsed.input }],
      };
      yield { type: 'tool_use', id, name: parsed.name, input: parsed.input };
      yield { type: 'turn_end', stopReason: 'tool_use', message };
      return;
    }

    const message: TurnMessage = {
      role: 'assistant',
      content: [{ type: 'text', text: parsed.text }],
    };
    yield { type: 'text', text: parsed.text };
    yield { type: 'turn_end', stopReason: toLatticeStopReason(result.finishReason), message };
  }
}
