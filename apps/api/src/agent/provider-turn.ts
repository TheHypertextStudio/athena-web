/** Collect streamed provider output while the caller owns activity persistence. */
import type { AgentTurnRuntime, TurnUsage } from '@docket/athena/turn';
import type { TurnMessage } from '@docket/athena/turn-protocol';

/** Await one terminal provider message, forwarding streamed thoughts and text to the generation fence. */
export async function collectProviderTurn(
  runtime: AgentTurnRuntime,
  request: Parameters<AgentTurnRuntime['streamTurn']>[0],
  onActivity: (type: 'thought' | 'response', text: string) => Promise<void>,
): Promise<{ message: TurnMessage; stopReason: string; usage: TurnUsage | undefined }> {
  let message: TurnMessage | undefined;
  let stopReason = 'end_turn';
  let usage: TurnUsage | undefined;
  for await (const event of runtime.streamTurn(request)) {
    if (event.type === 'thinking') await onActivity('thought', event.text);
    else if (event.type === 'text') await onActivity('response', event.text);
    else if (event.type === 'turn_end') {
      message = event.message;
      stopReason = event.stopReason;
      usage = event.usage;
    }
  }
  if (!message) throw new Error('turn ended without a terminal message');
  return { message, stopReason, usage };
}
