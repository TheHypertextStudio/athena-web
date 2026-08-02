/**
 * `@docket/api` — generating Athena's spoken reply on the channel where nobody else will.
 *
 * @remarks
 * ## Which channel needs this, and why only one
 *
 * The browser channel talks to a **speech-to-speech** model: the model hears the person and
 * produces audio, and the browser relays its transcript and tool calls to us. Generation is
 * already happening inside the audio link, so there is nothing for this module to do there.
 *
 * Twilio ConversationRelay is different: it does speech-to-text and text-to-speech and **no
 * language model at all**. Somebody has to turn "what the caller just said" into words, and on the
 * phone channel that somebody is here. This is the honest boundary of "one shared engine" — the
 * turn machine, the transcript, the tool dispatch and the barge-in handling are shared; the model
 * is reached differently because the two providers are differently shaped. There is still exactly
 * one conversation loop; what differs is who holds the model.
 *
 * ## Tokens, not a reply
 *
 * {@link VoiceResponder.respond} yields **fragments as they arrive** and a tool call the moment
 * the model asks for one. It never assembles a finished reply and hands it over — that would be
 * the text-to-speech-on-a-completed-string shape this whole design exists to avoid. Twilio starts
 * synthesizing from the first token, so audio is already playing while later tokens are still
 * being generated.
 */
import type { AgentTurnRuntime, TurnMessage, TurnToolDef } from '@docket/agent-runtime';

import type {
  VoiceReplyChunk,
  VoiceResponder,
  VoiceSessionContext,
  VoiceToolDefinition,
} from './voice-engine';

export type { VoiceReplyChunk, VoiceResponder };

/** Split a text block into speakable fragments at sentence boundaries. */
export function speakableFragments(text: string): readonly string[] {
  return text
    .split(/(?<=[.!?…])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * The real responder: Athena's own model, reached through the model-backend seam.
 *
 * @remarks
 * Uses the same {@link AgentTurnRuntime} the text conversation uses, so the phone channel gets
 * whichever backend the deployment configured (Cloudflare's router, a self-hosted Lattice, or the
 * deterministic local script) with no telephony-specific model configuration to drift.
 *
 * Text blocks are split into sentence-sized fragments before being yielded. That is a speech
 * decision, not a formatting one: a synthesizer given one long string produces a monologue with no
 * natural break for the caller to speak into, and barge-in stops feeling like a conversation.
 */
export class AthenaVoiceResponder implements VoiceResponder {
  constructor(
    private readonly runtime: AgentTurnRuntime,
    private readonly systemPrompt: string,
  ) {}

  /** Stream one reply. */
  async *respond(
    _ctx: VoiceSessionContext,
    history: readonly TurnMessage[],
    tools: readonly VoiceToolDefinition[],
  ): AsyncIterable<VoiceReplyChunk> {
    const turnTools: TurnToolDef[] = tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.parameters,
    }));

    for await (const event of this.runtime.streamTurn({
      system: this.systemPrompt,
      messages: history,
      tools: turnTools,
    })) {
      if (event.type === 'text') {
        for (const fragment of speakableFragments(event.text)) {
          yield { type: 'token', text: fragment };
        }
      } else if (event.type === 'tool_use') {
        yield {
          type: 'tool',
          callId: event.id,
          name: event.name,
          arguments:
            typeof event.input === 'object' && event.input !== null
              ? (event.input as Record<string, unknown>)
              : {},
        };
      } else if (event.type === 'turn_end') {
        yield { type: 'done' };
        return;
      }
      // `thinking` blocks are deliberately not spoken. Reasoning read aloud is noise on a phone
      // call, and the person cannot skim past it the way they can on a screen.
    }
    yield { type: 'done' };
  }
}
