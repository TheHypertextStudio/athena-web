/**
 * `@docket/agent-runtime` — the text tool-calling protocol Athena speaks when its turns run on a
 * person's own device through Lattice.
 *
 * @remarks
 * ## Why a text protocol rather than native tool calling
 *
 * This is not a shortcut; it is forced by the wire. Lattice's OpenAI-compatible surface carries
 * `{ role, content: string }` and nothing else — its request type has no `tools` field, its
 * message type has no `tool_calls` array and no `tool` role, and its response choice carries a
 * single text message (upstream `OpenAiChatMessage` / `OpenAiChatCompletionResponse` in
 * `@lovelace-ai/compute`). Athena's loop, meanwhile, is built on tool calls. Something has to
 * bridge those, and the only place a bridge can live is inside the text.
 *
 * So: tools are described in the system prompt, a call is a fenced JSON block, and a result comes
 * back as a marked user message. This module is that translation and nothing else — it is pure,
 * has no network and no clock, and is exhaustively tested, because a parser that guesses would
 * turn a model's prose into a phantom tool call.
 *
 * ## The rules the parser follows, and why
 *
 * 1. **A tool call is the whole reply, or it is not a tool call.** A response whose non-block text
 *    is more than incidental is treated as prose. A model that says "I could call `create_task`
 *    like this: ```json…```" is explaining, not acting, and acting on it would create real rows in
 *    someone's workspace from a sentence about hypotheticals.
 * 2. **Only the documented envelope counts.** `{"tool": string, "input": object}`. A block missing
 *    either field, or naming a tool that was not offered this turn, is prose.
 * 3. **Unparseable stays prose.** Malformed JSON is never repaired. The turn ends as text and the
 *    loop shows it, which is recoverable; a repaired guess is not.
 *
 * @see {@link ./lattice-turn.ts} for the runtime that uses this.
 */
import type { TurnToolDef } from './agent-turn';

/** The fence language tag a tool call is written in. */
const FENCE_TAG = 'json';

/** Prefix for the ids this protocol synthesizes for tool calls. */
const TOOL_USE_ID_PREFIX = 'toolu_lat_';

/**
 * How much stray text may surround a tool-call block before it is read as prose.
 *
 * @remarks
 * Not zero, because models routinely emit a trailing newline or a bare "Okay." A model that wrote
 * a paragraph around the block was explaining rather than calling — see rule 1 above.
 */
const MAX_INCIDENTAL_TEXT_LENGTH = 40;

/** The marker that introduces a tool result in the user turn that carries it. */
const RESULT_MARKER = 'TOOL RESULT';

/** What the protocol read out of one model reply. */
export type LatticeToolParse =
  | {
      /** The reply asked to call a tool. */
      readonly kind: 'tool_call';
      /** The tool the model named. Guaranteed to be one that was offered. */
      readonly name: string;
      /** The parsed input object. */
      readonly input: unknown;
    }
  | {
      /** The reply is an answer. */
      readonly kind: 'text';
      /** The reply text, trimmed. */
      readonly text: string;
    };

/**
 * Build the tool-use id for the nth tool call in a conversation.
 *
 * @remarks
 * Deterministic rather than random because the id is the join key between a `tool_use` block and
 * the `tool_result` that answers it, and both are persisted in the durable transcript. A
 * conversation replayed after a restart must produce the same pairing it did the first time.
 *
 * @param sequence - How many tool calls precede this one in the conversation.
 * @returns The synthesized block id.
 */
export function latticeToolUseId(sequence: number): string {
  return `${TOOL_USE_ID_PREFIX}${String(sequence).padStart(4, '0')}`;
}

/**
 * Render the tool section appended to the system prompt.
 *
 * @remarks
 * The JSON Schema for each tool goes in verbatim. Summarizing it would be the single most
 * expensive shortcut available here: a local model given a prose paraphrase of a schema produces
 * inputs that fail validation, and the loop's only recourse is to hand back an error and try
 * again, which costs a full turn on the person's own hardware.
 *
 * @param tools - The tools offered this turn.
 * @returns The section to append, or an empty string when no tools are offered.
 */
export function renderToolInstructions(tools: readonly TurnToolDef[]): string {
  if (tools.length === 0) return '';
  const rendered = tools
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
    rendered,
  ].join('\n');
}

/**
 * Render one tool call the way the model itself would have written it.
 *
 * @remarks
 * Used when replaying an assistant turn from the durable transcript. The model must see its own
 * earlier call in the same vocabulary the protocol taught it, or the conversation reads as if
 * something else were speaking.
 *
 * @param name - The tool that was called.
 * @param input - The input it was called with.
 * @returns The fenced block.
 */
export function renderToolCall(name: string, input: unknown): string {
  return `\`\`\`${FENCE_TAG}\n${JSON.stringify({ tool: name, input }, null, 2)}\n\`\`\``;
}

/**
 * Render a tool result as the user message that carries it back.
 *
 * @param toolUseId - The call this answers.
 * @param content - The serialized result.
 * @param isError - Whether the call failed.
 * @returns The message text.
 */
export function renderToolResult(toolUseId: string, content: string, isError: boolean): string {
  const outcome = isError ? 'FAILED' : 'OK';
  return `${RESULT_MARKER} (${toolUseId}) ${outcome}\n${content}`;
}

/** One fenced block found in a reply, with the text that surrounded it. */
interface FencedBlock {
  readonly body: string;
  readonly surroundingText: string;
}

/**
 * Find the single fenced JSON block in a reply, if there is exactly one.
 *
 * @remarks
 * Two or more blocks is deliberately not a tool call: the protocol allows one call per reply, and
 * picking one of several would be a guess about which the model meant.
 */
function findSoleFencedBlock(text: string): FencedBlock | null {
  const fence = /```[ \t]*([a-zA-Z0-9_-]*)[ \t]*\r?\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  let found: { body: string; start: number; end: number } | null = null;
  while ((match = fence.exec(text)) !== null) {
    /* v8 ignore start -- unreachable: both capture groups use `*` (not `?`), so the group always
       participates in the match (possibly capturing an empty string); this only narrows the
       `RegExpExecArray` element type's `noUncheckedIndexedAccess` `string | undefined`. */
    const tag = (match[1] ?? '').toLowerCase();
    if (tag !== '' && tag !== FENCE_TAG) continue;
    if (found) return null;
    found = { body: match[2] ?? '', start: match.index, end: match.index + match[0].length };
    /* v8 ignore stop */
  }
  if (!found) return null;
  const surroundingText = `${text.slice(0, found.start)}${text.slice(found.end)}`.trim();
  return { body: found.body, surroundingText };
}

/** Whether a parsed envelope is the documented `{ tool, input }` shape. */
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
 * Read one model reply as either a tool call or an answer.
 *
 * @remarks
 * `toolNames` is required rather than optional so a call to a tool that was not offered this turn
 * degrades to prose. Emitting a `tool_use` for an unknown name would push the failure into the
 * loop's dispatcher, where the only available response is an error the person has to read.
 *
 * @param reply - The raw text the model returned.
 * @param toolNames - The tools that were offered this turn.
 * @returns The parsed reply.
 */
export function parseLatticeReply(reply: string, toolNames: readonly string[]): LatticeToolParse {
  const text = reply.trim();
  const block = findSoleFencedBlock(text);
  if (!block) return { kind: 'text', text };
  if (block.surroundingText.length > MAX_INCIDENTAL_TEXT_LENGTH) {
    return { kind: 'text', text };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(block.body);
  } catch {
    return { kind: 'text', text };
  }
  if (!isToolEnvelope(parsed)) return { kind: 'text', text };
  if (!toolNames.includes(parsed.tool)) return { kind: 'text', text };
  return { kind: 'tool_call', name: parsed.tool, input: parsed.input ?? {} };
}
