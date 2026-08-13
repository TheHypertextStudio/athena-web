/**
 * Athena's framework-independent durable-execution wire contract.
 *
 * @remarks
 * API, Queue, Workflow, and future native clients may agree on this small, opaque message without
 * importing a delivery runtime. Prompts, credentials, owner identity, and provider state never
 * cross this boundary.
 */

/** Signed internal-request header names used by the API and Cloudflare runner. */
export const INTERNAL_HMAC_HEADERS = {
  bodyDigest: 'x-docket-content-sha256',
  nonce: 'x-docket-nonce',
  signature: 'x-docket-signature',
  timestamp: 'x-docket-timestamp',
} as const;

/** Maximum accepted clock skew and replay-window duration for signed internal requests. */
export const INTERNAL_HMAC_WINDOW_MS = 300_000;

/** The only message shape permitted to cross Athena's queue and workflow boundary. */
export interface ExecutionMessage {
  readonly sessionId: string;
  readonly generation: number;
  readonly workflowId: string;
}

/** Derive the deterministic Workflow identity for one persisted session generation. */
export function workflowIdFor(sessionId: string, generation: number): string {
  return `${sessionId}:${String(generation)}`;
}

/** Build the opaque execution message after the API has persisted its generation. */
export function createExecutionMessage(sessionId: string, generation: number): ExecutionMessage {
  return { sessionId, generation, workflowId: workflowIdFor(sessionId, generation) };
}

/** Validate an untrusted queue or HTTP payload without accepting private extension fields. */
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

/** Build the exact method/path/digest/timestamp/nonce string protected by a directional HMAC. */
export function canonicalInternalRequest(
  method: string,
  path: string,
  bodyDigest: string,
  timestamp: string,
  nonce: string,
): string {
  return [method.toUpperCase(), path, bodyDigest, timestamp, nonce].join('\n');
}
