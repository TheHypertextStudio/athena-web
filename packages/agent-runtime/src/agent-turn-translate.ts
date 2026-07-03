/**
 * Pure Anthropic-stream to {@link TurnEvent} translation for one agent turn.
 */
import type { RawMessageStreamEvent } from '@anthropic-ai/sdk/resources/messages';

import type { TurnContentBlock, TurnEvent, TurnStopReason } from './agent-turn';

/** Internal accumulator for an in-flight content block. */
interface TurnBlockBuffer {
  /** The block kind. */
  readonly type: 'thinking' | 'text' | 'tool_use' | 'other';
  /** Accumulated text/thinking deltas. */
  text: string;
  /** Accumulated partial JSON deltas. */
  json: string;
  /** Accumulated thinking signature deltas. */
  signature: string;
  /** The provider block id for tool-use blocks. */
  readonly toolUseId: string;
  /** The tool name for tool-use blocks. */
  readonly toolName: string;
}

/** Classify a provider content block. */
function turnBlockKind(type: string): TurnBlockBuffer['type'] {
  if (type === 'thinking') return 'thinking';
  if (type === 'text') return 'text';
  if (type === 'tool_use') return 'tool_use';
  return 'other';
}

/**
 * Parse an accumulated `input_json_delta` payload into a tool input object.
 *
 * @param partialJson - The concatenated JSON delta payload.
 */
export function parseToolInput(partialJson: string): unknown {
  const trimmed = partialJson.trim();
  if (!trimmed) return {};
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object') return parsed;
    return {};
  } catch {
    return {};
  }
}

/** Map a provider stop reason onto the port's stop reason. */
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

/** Convert a completed block buffer into a transcript content block. */
function toContentBlock(buf: TurnBlockBuffer): TurnContentBlock | null {
  if (buf.type === 'thinking') {
    const thinking = buf.text.trim();
    if (!thinking) return null;
    return { type: 'thinking', thinking, signature: buf.signature };
  }
  if (buf.type === 'text') {
    const text = buf.text.trim();
    if (!text) return null;
    return { type: 'text', text };
  }
  if (buf.type === 'tool_use') {
    return {
      type: 'tool_use',
      id: buf.toolUseId,
      name: buf.toolName,
      input: parseToolInput(buf.json),
    };
  }
  return null;
}

/**
 * Translate raw Messages API stream events into turn events.
 *
 * @param events - The raw Anthropic event stream.
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
        const buf = inFlight.get(event.index);
        if (!buf) break;
        const delta = event.delta;
        if (delta.type === 'text_delta') buf.text += delta.text;
        else if (delta.type === 'thinking_delta') buf.text += delta.thinking;
        else if (delta.type === 'input_json_delta') buf.json += delta.partial_json;
        else if (delta.type === 'signature_delta') buf.signature += delta.signature;
        break;
      }
      case 'content_block_stop': {
        const buf = inFlight.get(event.index);
        if (!buf) break;
        inFlight.delete(event.index);
        const block = toContentBlock(buf);
        if (!block) break;
        completed.set(event.index, block);
        if (block.type === 'thinking') {
          yield { type: 'thinking', text: block.thinking };
        } else if (block.type === 'text') {
          yield { type: 'text', text: block.text };
        } else if (block.type === 'tool_use') {
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

  const ordered = [...completed.entries()].sort(([a], [b]) => a - b).map(([, block]) => block);
  yield { type: 'turn_end', stopReason, message: { role: 'assistant', content: ordered } };
}
