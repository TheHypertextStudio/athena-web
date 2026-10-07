import { describe, expect, it, vi } from 'vitest';

import { requestSignupCodeWithRateLimit } from '../../e2e/helpers/signup-code';

const response = (status: number, headers: Record<string, string> = {}) => ({
  status: () => status,
  headers: () => headers,
  json: vi.fn().mockResolvedValue({ devCode: '123456' }),
});

describe('authenticated signup request pacing', () => {
  it.each<[Record<string, string>, number]>([
    [{ 'retry-after': '17' }, 18_000],
    [{}, 61_000],
    [{ 'retry-after': 'invalid' }, 61_000],
  ])(
    'waits for the rate-limit window before retrying the same submission',
    async (headers, delay) => {
      const limited = response(429, headers);
      const accepted = response(200);
      const request = vi.fn().mockResolvedValueOnce(limited).mockResolvedValueOnce(accepted);
      const pause = vi.fn().mockResolvedValue(undefined);
      expect(await requestSignupCodeWithRateLimit(request, pause)).toBe('123456');
      expect(limited.json).not.toHaveBeenCalled();
      expect(pause).toHaveBeenCalledExactlyOnceWith(delay);
      expect(request).toHaveBeenCalledTimes(2);
      expect(pause.mock.invocationCallOrder[0]).toBeLessThan(
        request.mock.invocationCallOrder[1] ?? 0,
      );
    },
  );

  it('honors an HTTP-date Retry-After value', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-06T12:00:00Z'));
    try {
      const request = vi
        .fn()
        .mockResolvedValueOnce(response(429, { 'retry-after': 'Tue, 06 Oct 2026 12:00:20 GMT' }))
        .mockResolvedValueOnce(response(200));
      const pause = vi.fn().mockResolvedValue(undefined);
      await requestSignupCodeWithRateLimit(request, pause);
      expect(pause).toHaveBeenCalledExactlyOnceWith(21_000);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('fails after a repeated 429 instead of looping through absent signup controls', async () => {
    const limited = response(429);
    const request = vi.fn().mockResolvedValue(limited);
    const pause = vi.fn().mockResolvedValue(undefined);
    await expect(requestSignupCodeWithRateLimit(request, pause)).rejects.toThrow(
      'Signup stayed rate-limited',
    );
    expect(request).toHaveBeenCalledTimes(2);
    expect(pause).toHaveBeenCalledTimes(1);
    expect(limited.json).not.toHaveBeenCalled();
  });
});
