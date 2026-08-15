/**
 * Text tool-calling protocol for a turn served by a person's Lattice device.
 *
 * Lattice's chat wire carries text-only messages. Athena therefore teaches the model a fenced JSON
 * envelope, renders persisted tool calls back in that same vocabulary, and treats ambiguous or
 * malformed replies as prose. The conservative parser is intentional: guessing could mutate a
 * person's workspace from a hypothetical example.
 */
import type { TurnToolDef } from '../contracts';

/** Fence language used for tool-call envelopes. */
const FENCE_TAG = 'json';

/** Prefix for deterministic ids that pair a tool use to its later result. */
const TOOL_USE_ID_PREFIX = 'toolu_lat_';

/** Maximum harmless surrounding text before a fenced block becomes ordinary prose. */
const MAX_INCIDENTAL_TEXT_LENGTH = 40;

/** Marker for a tool result returned in a user message on the text-only wire. */
const RESULT_MARKER = 'TOOL RESULT';

/** The safe interpretation of one local-model reply. */
export type LatticeToolParse =
  | {
      /** The reply asks Athena to call an offered tool. */
      readonly kind: 'tool_call';
      /** The offered tool name. */
      readonly name: string;
      /** Parsed input object. */
      readonly input: unknown;
    }
  | {
      /** The reply is ordinary visible text. */
      readonly kind: 'text';
      /** Trimmed reply text. */
      readonly text: string;
    };

/** Generate a stable tool id from the number of preceding tool calls. */
export function latticeToolUseId(sequence: number): string {
  return `${TOOL_USE_ID_PREFIX}${String(sequence).padStart(4, '0')}`;
}

/** Render the tool instructions appended to a Lattice system prompt. */
export function renderToolInstructions(tools: readonly TurnToolDef[]): string {
  if (tools.length === 0) return '';

  const renderedTools = tools
    .map(
      (tool) =>
        `### ${tool.name}\n${tool.description}\n\nInput JSON Schema:\n\`\`\`json\n${JSON.stringify(
          tool.inputSchema,
          null,
          2,
        )}\n\`\`\``,
    )
    .join('\n\n');

  return [
    '',
    '## Calling tools',
    '',
    'You can act by calling one of the tools below.',
    '',
    'To call a tool, reply with ONLY a fenced JSON block and no other text:',
    '',
    '```json',
    '{ "tool": "<tool name>", "input": { /* arguments matching that tool\'s schema */ } }',
    '```',
    '',
    'Rules:',
    '- Call at most one tool per reply.',
    '- Reply with the block and nothing else when you are calling a tool. Any surrounding',
    '  explanation makes it a message rather than a call, and no tool will run.',
    `- A result comes back as a user message beginning "${RESULT_MARKER}". Read it and continue.`,
    '- When you are answering rather than acting, reply in plain prose with no JSON block.',
    '',
    '## Tools',
    '',
    renderedTools,
  ].join('\n');
}

/** Render a persisted assistant tool call exactly as the protocol taught the model to write it. */
export function renderToolCall(name: string, input: unknown): string {
  return `\`\`\`${FENCE_TAG}\n${JSON.stringify({ tool: name, input }, null, 2)}\n\`\`\``;
}

/** Render one tool result as the marked user message that carries it back to the local model. */
export function renderToolResult(toolUseId: string, content: string, isError: boolean): string {
  const outcome = isError ? 'FAILED' : 'OK';
  return `${RESULT_MARKER} (${toolUseId}) ${outcome}\n${content}`;
}

/** One fenced block found in a reply, along with the non-fenced text around it. */
interface FencedBlock {
  /** JSON envelope body. */
  readonly body: string;
  /** Trimmed text before and after the fence. */
  readonly surroundingText: string;
}

/** Find the sole JSON-compatible fenced block, refusing replies with more than one. */
function findSoleFencedBlock(text: string): FencedBlock | null {
  const fence = /```[ \t]*([a-zA-Z0-9_-]*)[ \t]*\r?\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  let found: { body: string; start: number; end: number } | null = null;

  while ((match = fence.exec(text)) !== null) {
    const tag = (match[1] ?? '').toLowerCase();
    if (tag !== '' && tag !== FENCE_TAG) continue;
    if (found) return null;
    found = { body: match[2] ?? '', start: match.index, end: match.index + match[0].length };
  }

  if (!found) return null;
  return {
    body: found.body,
    surroundingText: `${text.slice(0, found.start)}${text.slice(found.end)}`.trim(),
  };
}

/** Whether a parsed value has the only envelope shape Athena accepts. */
function isToolEnvelope(value: unknown): value is { tool: string; input?: unknown } {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as { tool?: unknown }).tool === 'string' &&
    (value as { tool: string }).tool.length > 0
  );
}

/**
 * Read a local-model reply as an offered tool call or as visible prose.
 *
 * A response may name only a tool it was actually offered. Invalid JSON, an unknown tool, too much
 * surrounding explanation, or multiple fences always remain prose rather than becoming a guess.
 */
export function parseLatticeReply(reply: string, toolNames: readonly string[]): LatticeToolParse {
  const text = reply.trim();
  const block = findSoleFencedBlock(text);
  if (!block || block.surroundingText.length > MAX_INCIDENTAL_TEXT_LENGTH) {
    return { kind: 'text', text };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(block.body);
  } catch {
    return { kind: 'text', text };
  }

  if (!isToolEnvelope(parsed) || !toolNames.includes(parsed.tool)) {
    return { kind: 'text', text };
  }

  return { kind: 'tool_call', name: parsed.tool, input: parsed.input ?? {} };
}
