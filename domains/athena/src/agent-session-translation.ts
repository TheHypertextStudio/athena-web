import type { RawMessageStreamEvent } from '@anthropic-ai/sdk/resources/messages';

import type { SessionActionBody, SessionActivity } from './agent-session-contracts';

/** Accumulates provider deltas for one content block until that block closes. */
export interface BlockBuffer {
  /** Provider block category normalized to Athena's supported kinds. */
  readonly type: 'thinking' | 'text' | 'tool_use' | 'other';
  /** Accumulated text or thinking deltas. */
  text: string;
  /** Accumulated partial JSON tool-input deltas. */
  json: string;
  /** Tool name when the block represents a tool invocation. */
  toolName: string;
}

/** Parse a partial provider tool-input payload into a safe, human-reviewable action. */
export function toActionBody(toolName: string, partialJson: string): SessionActionBody {
  let parsed: Record<string, unknown> = {};
  const trimmed = partialJson.trim();
  if (trimmed) {
    try {
      const value: unknown = JSON.parse(trimmed);
      if (value && typeof value === 'object') parsed = value as Record<string, unknown>;
    } catch {
      // A provider can finish a tool block with no JSON deltas or malformed partial JSON.
    }
  }
  const kind = parsed['kind'];
  const summary = parsed['summary'];
  const diff = parsed['diff'];
  return {
    kind: typeof kind === 'string' && kind ? kind : toolName,
    summary: typeof summary === 'string' && summary ? summary : `Proposed ${toolName}`,
    ...(diff === undefined ? {} : { diff }),
  };
}

/** Normalize a provider block kind to the subset Athena represents in its session stream. */
export function blockKind(type: string): BlockBuffer['type'] {
  if (type === 'thinking') return 'thinking';
  if (type === 'text') return 'text';
  if (type === 'tool_use') return 'tool_use';
  return 'other';
}

/**
 * Translate raw Anthropic stream events into Athena's provider-neutral activity stream.
 *
 * Tool use is deliberately always emitted as `approval: 'proposed'`: this edge may describe a
 * mutation but never performs it.
 */
export async function* translateEvents(
  events: AsyncIterable<RawMessageStreamEvent>,
): AsyncIterable<SessionActivity> {
  const blocks = new Map<number, BlockBuffer>();
  for await (const event of events) {
    switch (event.type) {
      case 'content_block_start':
        blocks.set(event.index, {
          type: blockKind(event.content_block.type),
          text: '',
          json: '',
          toolName: event.content_block.type === 'tool_use' ? event.content_block.name : '',
        });
        break;
      case 'content_block_delta': {
        const block = blocks.get(event.index);
        if (!block) break;
        if (event.delta.type === 'text_delta') block.text += event.delta.text;
        else if (event.delta.type === 'thinking_delta') block.text += event.delta.thinking;
        else if (event.delta.type === 'input_json_delta') block.json += event.delta.partial_json;
        break;
      }
      case 'content_block_stop': {
        const block = blocks.get(event.index);
        if (!block) break;
        blocks.delete(event.index);
        if (block.type === 'thinking' && block.text.trim()) {
          yield { type: 'thought', body: block.text.trim() };
        } else if (block.type === 'text' && block.text.trim()) {
          yield { type: 'response', body: block.text.trim() };
        } else if (block.type === 'tool_use') {
          yield {
            type: 'action',
            body: toActionBody(block.toolName, block.json),
            approval: 'proposed',
          };
        }
        break;
      }
      case 'message_delta':
        if (event.delta.stop_reason === 'refusal') {
          yield {
            type: 'error',
            body: 'The agent declined to complete this task (model refusal).',
          };
        }
        break;
      default:
        break;
    }
  }
}
