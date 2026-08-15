/**
 * `@docket/api` — what Athena is told before she opens her mouth.
 *
 * @remarks
 * One prompt, both channels. The browser pins it into the realtime session at mint time; the
 * telephone hands it to the text model that produces the words Twilio synthesizes. Keeping it in
 * one module is what stops the two channels developing different personalities, which is the most
 * visible way a "shared session" claim falls apart in practice.
 *
 * Three of the instructions carry real weight, and each exists because of a specific way voice
 * differs from text:
 *
 * - **Act while you speak.** A chat-tuned model's default is to narrate its plan and act
 *   afterwards. On a phone call that reads as nothing having happened, so the instruction is
 *   explicit and negative: do not collect actions and do them at the end.
 * - **Say what you did.** There is no diff to look at. The sentence is the receipt.
 * - **Stay interruptible.** Short turns. A monologue is not a conversation, and a person cannot
 *   skim audio.
 */
import { PROVENANCE_SYSTEM_RULE } from '../agent/provenance';

/** How much recent conversation is replayed into a session's instructions. */
export const VOICE_HISTORY_HEADING =
  'Here is the recent conversation you have both been having, across every channel. Continue it; do not reintroduce yourself.';

/** The standing instruction block, identical on both channels. */
const PREAMBLE = [
  "You are Athena, the caller's chief of staff inside Docket. You are speaking out loud.",
  'Keep turns short — two or three sentences — and let them interrupt you. Never monologue.',
  'When they ask for something you can do, call the tool immediately, while you are still speaking. Do not collect actions and do them at the end of your reply.',
  'Say plainly what you did after you do it — they cannot see a screen.',
  'If a request needs a screen (reviewing many changes, reading a long document), say so and offer to leave it for them in Docket.',
  'Never read out identifiers, URLs, or error text.',
  // The history block below can contain lines that reached this conversation from outside, and this
  // channel calls tools without an approval step, so the rule that explains the marker has to
  // travel with it. Shared with the text loop's system prompt so the tag has one meaning.
  PROVENANCE_SYSTEM_RULE,
].join(' ');

/**
 * Build the system prompt for one voice session.
 *
 * @param speakerName - The person's name, so the greeting sounds like it knows them.
 * @param recentContext - Recent conversation from every channel, oldest first.
 * @returns the complete system prompt.
 */
export function voiceInstructions(speakerName: string, recentContext = ''): string {
  const who = speakerName ? `You are speaking with ${speakerName}.` : '';
  const history = recentContext
    ? `${VOICE_HISTORY_HEADING}\n${recentContext}`
    : 'This is the first thing they have said to you.';
  return [PREAMBLE, who, history].filter(Boolean).join('\n\n');
}
