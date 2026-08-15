import { z } from 'zod';

/** One content block inside a {@link TurnMessage} (the durable conversation unit). */
export const TurnContentBlock = z
  .discriminatedUnion('type', [
    z.object({
      type: z.literal('text'),
      text: z.string().describe('Plain text content.'),
    }),
    z.object({
      type: z.literal('thinking'),
      thinking: z.string().describe('The (possibly summarized) provider reasoning text.'),
      signature: z
        .string()
        .describe('The provider integrity signature required to replay this block verbatim.'),
    }),
    z.object({
      type: z.literal('tool_use'),
      id: z.string().describe('The provider block id; pairs the call with its `tool_result`.'),
      name: z
        .string()
        .describe('The tool name (namespaced for remote connections, e.g. `sunsama__get_...`).'),
      input: z.unknown().describe('The parsed tool input.'),
    }),
    z.object({
      type: z.literal('tool_result'),
      toolUseId: z.string().describe('The `tool_use` block id this result answers.'),
      content: z.string().describe('The serialized result content.'),
      isError: z
        .boolean()
        .describe('Whether the tool call failed (the model reacts instead of assuming success).'),
    }),
  ])
  .describe('One content block of a durable agent-conversation message.');
/** Turn-content-block value. */
export type TurnContentBlock = z.infer<typeof TurnContentBlock>;

/**
 * One message in a session's durable provider transcript.
 *
 * @remarks
 * The canonical cross-runtime shape: an Athena turn port speaks it and the database persists it
 * (`agent_session_transcript.messages`), so the conversation a session resumes from can never
 * drift from what the runtime emitted. `thinking` blocks keep their provider `signature`, which
 * makes replaying a persisted transcript lossless across approvals that take days and server
 * restarts.
 */
export const TurnMessage = z
  .object({
    role: z.enum(['user', 'assistant']).describe('Who produced the message.'),
    content: z.array(TurnContentBlock).describe('The ordered content blocks.'),
  })
  .meta({ id: 'TurnMessage', description: 'One durable agent-conversation message.' });
/** Turn-message value. */
export type TurnMessage = z.infer<typeof TurnMessage>;
