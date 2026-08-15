/** Translate Anthropic's streamed Messages events into Athena's provider-neutral turn events. */
import type { RawMessageStreamEvent } from '@anthropic-ai/sdk/resources/messages';

import type { TurnContentBlock } from '../turn-protocol';

import type { TurnEvent, TurnStopReason } from './contracts';

/** Buffer for one provider content block until its stream stop event arrives. */
interface TurnBlockBuffer {
  /** The kind Athena can translate from this provider block. */
  readonly type: 'thinking' | 'text' | 'tool_use' | 'other';
  /** Accumulated text or thinking deltas. */
  text: string;
  /** Accumulated partial JSON input deltas. */
  json: string;
  /** Accumulated provider reasoning-signature deltas. */
  signature: string;
  /** Provider id for a tool-use block. */
  readonly toolUseId: string;
  /** Provider tool name for a tool-use block. */
  readonly toolName: string;
}

/** Classify a raw provider block into the kinds Athena understands. */
function turnBlockKind(type: string): TurnBlockBuffer['type'] {
  if (type === 'thinking') return 'thinking';
  if (type === 'text') return 'text';
  if (type === 'tool_use') return 'tool_use';
  return 'other';
}

/** Parse a complete `input_json_delta` payload without turning malformed input into an exception. */
export function parseToolInput(partialJson: string): unknown {
  const trimmed = partialJson.trim();
  if (!trimmed) return {};

  try {
    const parsed: unknown = JSON.parse(trimmed);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** Map a provider stop reason to the small, delivery-independent Athena vocabulary. */
export function toStopReason(raw: string | null | undefined): TurnStopReason {
  switch (raw) {
    case 'tool_use':
      return 'tool_use';
    case 'refusal':
      return 'refusal';
    case 'max_tokens':
      return 'max_tokens';
    default:
      return 'end_turn';
  }
}

/** The transcript blocks this translator can produce; user-only tool results never enter here. */
type YieldableContentBlock = Extract<TurnContentBlock, { type: 'thinking' | 'text' | 'tool_use' }>;

/** Convert one finished provider block into an appendable transcript block, if it is meaningful. */
function toContentBlock(buffer: TurnBlockBuffer): YieldableContentBlock | null {
  if (buffer.type === 'thinking') {
    const thinking = buffer.text.trim();
    return thinking ? { type: 'thinking', thinking, signature: buffer.signature } : null;
  }

  if (buffer.type === 'text') {
    const text = buffer.text.trim();
    return text ? { type: 'text', text } : null;
  }

  if (buffer.type === 'tool_use') {
    return {
      type: 'tool_use',
      id: buffer.toolUseId,
      name: buffer.toolName,
      input: parseToolInput(buffer.json),
    };
  }

  return null;
}

/**
 * Translate raw provider stream events into durable Athena events.
 *
 * Completed blocks are retained by provider index, then ordered before the terminal message is
 * emitted. That preserves the exact message the host can append and replay on a later turn.
 */
export async function* translateTurnEvents(
  events: AsyncIterable<RawMessageStreamEvent>,
): AsyncIterable<TurnEvent> {
  const inFlight = new Map<number, TurnBlockBuffer>();
  const completed = new Map<number, TurnContentBlock>();
  let stopReason: TurnStopReason = 'end_turn';

  for await (const event of events) {
    switch (event.type) {
      case 'content_block_start': {
        const block = event.content_block;
        inFlight.set(event.index, {
          type: turnBlockKind(block.type),
          text: '',
          json: '',
          signature: '',
          toolUseId: block.type === 'tool_use' ? block.id : '',
          toolName: block.type === 'tool_use' ? block.name : '',
        });
        break;
      }

      case 'content_block_delta': {
        const buffer = inFlight.get(event.index);
        if (!buffer) break;

        const delta = event.delta;
        if (delta.type === 'text_delta') buffer.text += delta.text;
        else if (delta.type === 'thinking_delta') buffer.text += delta.thinking;
        else if (delta.type === 'input_json_delta') buffer.json += delta.partial_json;
        else if (delta.type === 'signature_delta') buffer.signature += delta.signature;
        break;
      }

      case 'content_block_stop': {
        const buffer = inFlight.get(event.index);
        if (!buffer) break;
        inFlight.delete(event.index);

        const block = toContentBlock(buffer);
        if (!block) break;
        completed.set(event.index, block);

        if (block.type === 'thinking') {
          yield { type: 'thinking', text: block.thinking };
        } else if (block.type === 'text') {
          yield { type: 'text', text: block.text };
        } else {
          yield { type: 'tool_use', id: block.id, name: block.name, input: block.input };
        }
        break;
      }

      case 'message_delta':
        stopReason = toStopReason(event.delta.stop_reason);
        break;

      default:
        break;
    }
  }

  const orderedContent = [...completed.entries()]
    .sort(([firstIndex], [secondIndex]) => firstIndex - secondIndex)
    .map(([, block]) => block);

  yield {
    type: 'turn_end',
    stopReason,
    message: { role: 'assistant', content: orderedContent },
  };
}
