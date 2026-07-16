import {
  INTERNAL_HMAC_WINDOW_MS,
  signInternalRequest,
  verifyInternalRequest,
} from '../../src/agent/execution-hmac';
import { describe, expect, it, vi } from 'vitest';

const SECRET = 'docket-direction-test-secret';
const NOW = Date.parse('2026-07-16T12:00:00.000Z');

describe('Docket execution HMAC', () => {
  it('authenticates the complete canonical request and claims the nonce once', async () => {
    const body = JSON.stringify({ sessionId: '01SESSION', generation: 1 });
    const headers = signInternalRequest({
      secret: SECRET,
      method: 'POST',
      path: '/enqueue',
      body,
      timestampMs: NOW,
      nonce: 'nonce-1',
    });
    const claimNonce = vi.fn().mockResolvedValue(true);

    await expect(
      verifyInternalRequest({
        secret: SECRET,
        method: 'POST',
        path: '/enqueue',
        body,
        headers,
        nowMs: NOW,
        claimNonce,
      }),
    ).resolves.toEqual({ ok: true, nonce: 'nonce-1' });
    expect(claimNonce).toHaveBeenCalledWith('nonce-1', new Date(NOW + INTERNAL_HMAC_WINDOW_MS));
  });

  it('rejects body tampering, stale timestamps, the opposite secret, and replay', async () => {
    const headers = signInternalRequest({
      secret: SECRET,
      method: 'POST',
      path: '/enqueue',
      body: '{}',
      timestampMs: NOW,
      nonce: 'nonce-2',
    });
    const base = { method: 'POST', path: '/enqueue', body: '{}', headers } as const;

    await expect(
      verifyInternalRequest({
        ...base,
        secret: SECRET,
        body: '{ }',
        nowMs: NOW,
        claimNonce: vi.fn().mockResolvedValue(true),
      }),
    ).resolves.toMatchObject({ ok: false, reason: 'signature' });
    await expect(
      verifyInternalRequest({
        ...base,
        secret: SECRET,
        nowMs: NOW + INTERNAL_HMAC_WINDOW_MS + 1,
        claimNonce: vi.fn().mockResolvedValue(true),
      }),
    ).resolves.toMatchObject({ ok: false, reason: 'timestamp' });
    await expect(
      verifyInternalRequest({
        ...base,
        secret: 'wrong-direction-secret',
        nowMs: NOW,
        claimNonce: vi.fn().mockResolvedValue(true),
      }),
    ).resolves.toMatchObject({ ok: false, reason: 'signature' });
    await expect(
      verifyInternalRequest({
        ...base,
        secret: SECRET,
        nowMs: NOW,
        claimNonce: vi.fn().mockResolvedValue(false),
      }),
    ).resolves.toMatchObject({ ok: false, reason: 'replay' });
  });
});
