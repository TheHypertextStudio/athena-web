/** The only data permitted to cross Docket's Queue and Workflow boundary. */
export interface ExecutionMessage {
  readonly sessionId: string;
  readonly generation: number;
  readonly workflowId: string;
}

/** Derive the durable Workflow identity owned by one persisted run generation. */
export function workflowIdFor(sessionId: string, generation: number): string {
  return `${sessionId}:${String(generation)}`;
}

/** Build the opaque message for a persisted Docket generation. */
export function createExecutionMessage(sessionId: string, generation: number): ExecutionMessage {
  return { sessionId, generation, workflowId: workflowIdFor(sessionId, generation) };
}

/** Validate an untrusted Queue or HTTP body without accepting private extension fields. */
export function isExecutionMessage(value: unknown): value is ExecutionMessage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.join(',') !== 'generation,sessionId,workflowId') return false;
  if (typeof record['sessionId'] !== 'string' || record['sessionId'].length === 0) return false;
  if (
    typeof record['generation'] !== 'number' ||
    !Number.isSafeInteger(record['generation']) ||
    record['generation'] < 1
  ) {
    return false;
  }
  return (
    typeof record['workflowId'] === 'string' &&
    record['workflowId'] === workflowIdFor(record['sessionId'], record['generation']) &&
    record['workflowId'].length <= 100
  );
}
