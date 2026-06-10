import type { RawMessageStreamEvent } from '@anthropic-ai/sdk/resources/messages';

import type { SessionActionBody, SessionActivity } from '../ports/agent-runtime';

/** Internal accumulator for an in-flight content block while its deltas stream in. */
export interface BlockBuffer {
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
 * the tool name as `kind` and a generic summary. Always yields a well-formed body.
 *
 * @param toolName - The tool the model invoked.
 * @param partialJson - The concatenated `input_json_delta` payload (may be empty).
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

/** Classify a `content_block_start` block type into our buffer kind. */
export function blockKind(type: string): BlockBuffer['type'] {
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
 * - `tool_use` block → `action` with `approval: 'proposed'` (human-approval gate)
 * A `message_delta` with `stop_reason: 'refusal'` is surfaced as an `error`.
 * Blank `thought`/`response` blocks are skipped.
 *
 * @param events - The async stream of raw Messages-API events.
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
        break;
    }
  }
}
