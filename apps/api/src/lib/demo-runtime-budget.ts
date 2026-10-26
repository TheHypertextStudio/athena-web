/** Charge actual model turns, including voice and automatic agent continuations. */
import { consumeDemoBudget, type DemoBudgetSubject } from '@docket/auth/demo-budget';
import type { AgentTurnRuntime } from '@docket/athena/turn';

const metered = new WeakSet<AgentTurnRuntime>();

/** Preserve ordinary runtimes; wrap reviewer runtimes at the last shared provider boundary. */
export async function withDemoRuntimeBudget(
  runtime: AgentTurnRuntime,
  subject: DemoBudgetSubject,
): Promise<AgentTurnRuntime> {
  if (metered.has(runtime)) return runtime;
  const demoId = await consumeDemoBudget(subject, []);
  if (!demoId) return runtime;
  const wrapped: AgentTurnRuntime = {
    async *streamTurn(input) {
      await consumeDemoBudget({ demoId }, [{ kind: 'generations' }]);
      yield* runtime.streamTurn(input);
    },
  };
  metered.add(wrapped);
  return wrapped;
}
