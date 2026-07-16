import { signInternalRequest, verifyInternalRequest } from '../src/hmac';
import { describe, expect, it, vi } from 'vitest';

const SECRET = 'cloudflare-direction-test-secret';
const NOW = Date.parse('2026-07-16T12:00:00.000Z');

describe('directional internal HMAC', () => {
  it('covers method, path, body digest, timestamp, and nonce', async () => {
    const body = JSON.stringify({ sessionId: '01SESSION', generation: 1 });
    const headers = await signInternalRequest({
      secret: SECRET,
      method: 'POST',
      path: '/internal/athena/execution/advance',
      body,
      timestampMs: NOW,
      nonce: 'nonce-1',
    });
    const claimNonce = vi.fn().mockResolvedValue(true);

    await expect(
      verifyInternalRequest({
        secret: SECRET,
        method: 'POST',
        path: '/internal/athena/execution/advance',
        body,
        headers,
        nowMs: NOW,
        claimNonce,
      }),
    ).resolves.toEqual({ ok: true, nonce: 'nonce-1' });
    expect(claimNonce).toHaveBeenCalledWith('nonce-1', NOW + 300_000);

    for (const tampered of [
      { method: 'PUT', path: '/internal/athena/execution/advance', body },
      { method: 'POST', path: '/internal/athena/execution/wake', body },
      { method: 'POST', path: '/internal/athena/execution/advance', body: `${body} ` },
    ]) {
      await expect(
        verifyInternalRequest({
          secret: SECRET,
          ...tampered,
          headers,
          nowMs: NOW,
          claimNonce,
        }),
      ).resolves.toMatchObject({ ok: false, reason: 'signature' });
    }
  });

  it('rejects stale requests, replayed nonces, and the opposite-direction secret', async () => {
    const body = '{}';
    const headers = await signInternalRequest({
      secret: SECRET,
      method: 'POST',
      path: '/enqueue',
      body,
      timestampMs: NOW,
      nonce: 'nonce-2',
    });

    await expect(
      verifyInternalRequest({
        secret: SECRET,
        method: 'POST',
        path: '/enqueue',
        body,
        headers,
        nowMs: NOW + 300_001,
        claimNonce: vi.fn().mockResolvedValue(true),
      }),
    ).resolves.toMatchObject({ ok: false, reason: 'timestamp' });
    await expect(
      verifyInternalRequest({
        secret: SECRET,
        method: 'POST',
        path: '/enqueue',
        body,
        headers,
        nowMs: NOW,
        claimNonce: vi.fn().mockResolvedValue(false),
      }),
    ).resolves.toMatchObject({ ok: false, reason: 'replay' });
    await expect(
      verifyInternalRequest({
        secret: 'different-direction-secret',
        method: 'POST',
        path: '/enqueue',
        body,
        headers,
        nowMs: NOW,
        claimNonce: vi.fn().mockResolvedValue(true),
      }),
    ).resolves.toMatchObject({ ok: false, reason: 'signature' });
  });
});
