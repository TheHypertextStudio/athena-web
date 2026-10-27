import type { agentDelegation } from '@docket/db';

type Receipt = Pick<typeof agentDelegation.$inferInsert, 'terminalOutcome' | 'resultReceivedAt'>;

/** Persist a terminal payload and its receipt date together at the delegation's settlement edge. */
export function latticeResultReceipt(
  terminalOutcome: Receipt['terminalOutcome'],
  now: Date,
): Receipt {
  return { terminalOutcome, resultReceivedAt: terminalOutcome ? now : undefined };
}
