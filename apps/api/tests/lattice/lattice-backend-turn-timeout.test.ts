import { describe, expect, it } from 'vitest';

import {
  PERSONAL_RUNTIME_TURN_TIMEOUT_MS,
  turnGatewayContext,
} from '../../src/routes/lattice-backend';

describe('turnGatewayContext', () => {
  it('gives a turn the local-model timeout when the grant context has none', () => {
    const context = turnGatewayContext({ accessToken: 'tok', baseUrl: 'https://gw.example' });

    expect(context.timeoutMs).toBe(PERSONAL_RUNTIME_TURN_TIMEOUT_MS);
    expect(context.accessToken).toBe('tok');
    expect(context.baseUrl).toBe('https://gw.example');
  });

  it('keeps a timeout the caller already chose', () => {
    const context = turnGatewayContext({ accessToken: 'tok', timeoutMs: 7_000 });

    expect(context.timeoutMs).toBe(7_000);
  });

  it('allows a local model longer than the SDK default of two minutes', () => {
    // The gateway allows a personal runtime five minutes for a standard turn; Docket must not
    // give up before the gateway does, or a finished answer is recorded as a stop.
    expect(PERSONAL_RUNTIME_TURN_TIMEOUT_MS).toBeGreaterThan(120_000);
    expect(PERSONAL_RUNTIME_TURN_TIMEOUT_MS).toBeLessThanOrEqual(300_000);
  });
});
