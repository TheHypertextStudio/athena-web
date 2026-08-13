import {
  canonicalInternalRequest,
  createExecutionMessage,
  INTERNAL_HMAC_HEADERS,
  INTERNAL_HMAC_WINDOW_MS,
  isExecutionMessage,
  workflowIdFor,
} from '../src/execution-protocol';
import { describe, expect, it } from 'vitest';

describe('Athena execution protocol', () => {
  it('owns the deterministic opaque message used by every execution runtime', () => {
    expect(workflowIdFor('01SESSION', 7)).toBe('01SESSION:7');
    expect(createExecutionMessage('01SESSION', 7)).toEqual({
      sessionId: '01SESSION',
      generation: 7,
      workflowId: '01SESSION:7',
    });
    expect(
      isExecutionMessage({
        sessionId: '01SESSION',
        generation: 7,
        workflowId: '01SESSION:7',
      }),
    ).toBe(true);
    expect(
      isExecutionMessage({
        sessionId: '01SESSION',
        generation: 7,
        workflowId: '01SESSION:7',
        prompt: 'private',
      }),
    ).toBe(false);
  });

  it('owns one exact signed-request vocabulary and canonical form', () => {
    expect(INTERNAL_HMAC_HEADERS).toEqual({
      bodyDigest: 'x-docket-content-sha256',
      nonce: 'x-docket-nonce',
      signature: 'x-docket-signature',
      timestamp: 'x-docket-timestamp',
    });
    expect(INTERNAL_HMAC_WINDOW_MS).toBe(300_000);
    expect(
      canonicalInternalRequest('post', '/internal/athena/execution/advance', 'digest', '42', 'n'),
    ).toBe('POST\n/internal/athena/execution/advance\ndigest\n42\nn');
  });
});
