import { describe, expect, it } from 'vitest';

import { TwilioTelephony } from '../../src/routes/twilio-telephony';

describe('TwilioTelephony', () => {
  it('places callbacks and terminates active calls through the Calls API', async () => {
    const requests: { url: string; init: RequestInit }[] = [];
    const provider = new TwilioTelephony({
      accountSid: 'AC_docket',
      authToken: 'secret',
      from: '+17025550100',
      fetch: async (input, init) => {
        requests.push({
          url: typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
          init: init ?? {},
        });
        return Response.json({ sid: requests.length === 1 ? 'CA_outbound' : 'CA_outbound' });
      },
    });

    await expect(
      provider.placeCallback({
        to: '+14155550123',
        answerUrl: 'https://api.docket.test/internal/telephony/twilio/callback/auth_1/answer',
        statusCallbackUrl: 'https://api.docket.test/internal/telephony/twilio/status',
      }),
    ).resolves.toBe('CA_outbound');
    await provider.endCall('CA_outbound');

    expect(requests.map((request) => request.url)).toEqual([
      'https://api.twilio.com/2010-04-01/Accounts/AC_docket/Calls.json',
      'https://api.twilio.com/2010-04-01/Accounts/AC_docket/Calls/CA_outbound.json',
    ]);
    expect(requests[0]?.init.body).toBeInstanceOf(URLSearchParams);
    expect((requests[0]?.init.body as URLSearchParams | undefined)?.toString()).toContain(
      'To=%2B14155550123',
    );
    expect((requests[0]?.init.body as URLSearchParams | undefined)?.toString()).toContain(
      'From=%2B17025550100',
    );
    expect(requests[1]?.init.body).toBeInstanceOf(URLSearchParams);
    expect((requests[1]?.init.body as URLSearchParams | undefined)?.toString()).toBe(
      'Status=completed',
    );
  });
});
