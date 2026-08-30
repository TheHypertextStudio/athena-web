import { describe, expect, it } from 'vitest';

import {
  CapturePhoneVerificationProvider,
  TwilioVerifyProvider,
} from '../../src/routes/phone-verification-provider';

describe('TwilioVerifyProvider', () => {
  it('starts and checks an SMS verification through the configured Verify service', async () => {
    const requests: { url: string; init: RequestInit }[] = [];
    const responses = [
      { sid: 'VE_start', status: 'pending' },
      { sid: 'VE_check', status: 'approved' },
    ];
    const provider = new TwilioVerifyProvider({
      accountSid: 'AC_docket',
      authToken: 'secret',
      serviceSid: 'VA_docket',
      fetch: async (input, init) => {
        requests.push({
          url: typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
          init: init ?? {},
        });
        return Response.json(responses.shift(), { status: 200 });
      },
    });

    await expect(provider.start('+14155550123')).resolves.toEqual({
      providerChallengeId: 'VE_start',
      status: 'pending',
    });
    await expect(provider.check('+14155550123', '123456')).resolves.toEqual({
      providerChallengeId: 'VE_check',
      status: 'approved',
    });

    expect(requests.map((request) => request.url)).toEqual([
      'https://verify.twilio.com/v2/Services/VA_docket/Verifications',
      'https://verify.twilio.com/v2/Services/VA_docket/VerificationCheck',
    ]);
    expect(requests[0]?.init.headers).toMatchObject({
      authorization: `Basic ${Buffer.from('AC_docket:secret').toString('base64')}`,
      'content-type': 'application/x-www-form-urlencoded',
    });
    expect(requests[0]?.init.body).toBeInstanceOf(URLSearchParams);
    expect((requests[0]?.init.body as URLSearchParams | undefined)?.toString()).toBe(
      'To=%2B14155550123&Channel=sms',
    );
    expect(requests[1]?.init.body).toBeInstanceOf(URLSearchParams);
    expect((requests[1]?.init.body as URLSearchParams | undefined)?.toString()).toBe(
      'To=%2B14155550123&Code=123456',
    );
  });

  it('captures local challenges without sending an external request', async () => {
    const provider = new CapturePhoneVerificationProvider('654321');

    const started = await provider.start('+14155550124');

    expect(provider.outbox).toEqual([{ to: '+14155550124', code: '654321' }]);
    await expect(provider.check('+14155550124', '000000')).resolves.toMatchObject({
      status: 'pending',
    });
    await expect(provider.check('+14155550124', '654321')).resolves.toMatchObject({
      providerChallengeId: started.providerChallengeId,
      status: 'approved',
    });
  });
});
