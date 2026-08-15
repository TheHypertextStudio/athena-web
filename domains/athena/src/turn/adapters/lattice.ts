/**
 * Athena turn adapter for a person's own Lattice device.
 *
 * The injected chat port is deliberately a narrow network seam. This domain owns transcript and
 * tool-protocol translation; an API, runner, or desktop delivery layer owns the concrete device
 * connection and can fail honestly when the device is unavailable.
 */
import type { TurnMessage } from '../../turn-protocol';

import type { AgentTurnRuntime, TurnEvent, TurnInput, TurnStopReason } from '../contracts';
import {
  latticeToolUseId,
  parseLatticeReply,
  renderToolCall,
  renderToolInstructions,
  renderToolResult,
} from '../internal/lattice-tool-protocol';

export {
  latticeToolUseId,
  parseLatticeReply,
  renderToolCall,
  renderToolInstructions,
  renderToolResult,
} from '../internal/lattice-tool-protocol';
export type { LatticeToolParse } from '../internal/lattice-tool-protocol';

/** Default output-token ceiling for a local-model turn. */
export const DEFAULT_LATTICE_MAX_TOKENS = 4096;

/** One text-only message on Lattice's OpenAI-compatible wire. */
export interface LatticeChatMessage {
  /** Who authored the message on the wire. */
  readonly role: 'system' | 'user' | 'assistant' | 'developer';
  /** Text-only message content. */
  readonly content: string;
}

/** A completed turn request sent to a paired device. */
export interface LatticeChatPortRequest {
  /** Flattened conversation with the system message first. */
  readonly messages: readonly LatticeChatMessage[];
  /** Output-token ceiling. */
  readonly maxTokens: number;
  /** Optional sampling temperature. */
  readonly temperature?: number;
}

/** The text reply returned from a paired device. */
export interface LatticeChatPortResult {
  /** Model reply text. */
  readonly text: string;
  /** Provider finish reason when the device reports one. */
  readonly finishReason?: string;
  /** Model id the device actually served. */
  readonly model?: string;
}

/** Injected network edge for running one local-model chat turn. */
export interface LatticeChatPort {
  /** Run one chat request on the person's selected device. */
  runChat(request: LatticeChatPortRequest): Promise<LatticeChatPortResult>;
}

/** Configuration for {@link LatticeAgentTurnRuntime}. */
export interface LatticeTurnRuntimeConfig {
  /** Concrete delivery edge to the person's device. */
  readonly chat: LatticeChatPort;
  /** Optional output-token ceiling. */
  readonly maxTokens?: number;
  /** Optional sampling temperature. */
  readonly temperature?: number;
}

/**
 * Flatten Athena's block transcript for Lattice's text-only message wire.
 *
 * Thinking blocks do not cross providers, earlier tool calls are re-rendered in the documented
 * Lattice vocabulary, and tool results move to the user side because the wire has no tool role.
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

    const carriesToolResult = message.content.some((block) => block.type === 'tool_result');
    const role: LatticeChatMessage['role'] =
      message.role === 'assistant' && !carriesToolResult ? 'assistant' : 'user';
    flattened.push({ role, content });
  }

  return flattened;
}

/** Count persisted tool calls so the next generated id remains stable through a resumed turn. */
export function countToolUses(messages: readonly TurnMessage[]): number {
  let count = 0;
  for (const message of messages) {
    for (const block of message.content) {
      if (block.type === 'tool_use') count += 1;
    }
  }
  return count;
}

/** Map a device finish reason to Athena's stable, small turn vocabulary. */
export function toLatticeStopReason(finishReason: string | undefined): TurnStopReason {
  if (finishReason === 'length' || finishReason === 'max_tokens') return 'max_tokens';
  if (finishReason === 'content_filter' || finishReason === 'refusal') return 'refusal';
  return 'end_turn';
}

/** Build the full text-only message list sent to a local device for one Athena turn. */
export function buildLatticeTurnMessages(input: TurnInput): readonly LatticeChatMessage[] {
  return [
    { role: 'system', content: `${input.system}${renderToolInstructions(input.tools)}` },
    ...flattenTranscript(input.messages),
  ];
}

/** Provider-neutral turn runtime whose model computation stays on the person's paired device. */
export class LatticeAgentTurnRuntime implements AgentTurnRuntime {
  private readonly config: LatticeTurnRuntimeConfig;

  /** Create a Lattice runtime around the delivery-layer chat port. */
  constructor(config: LatticeTurnRuntimeConfig) {
    this.config = config;
  }

  /**
   * Run one turn and emit its normal Athena event sequence.
   *
   * Errors intentionally propagate unchanged. A silent fallback would violate the privacy choice a
   * person made by selecting their own device.
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
