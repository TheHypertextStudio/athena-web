import { expect, it, vi } from 'vitest';
import { ResendInboundReceiver } from '../../src/resend-inbound';
import { signSvixPayload } from '../../src/svix-signature';

it('captures authenticated metadata before independently retrying provider hydration', async () => {
  const secret = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw'; // gitleaks:allow
  const now = new Date();
  const timestamp = String(Math.floor(now.getTime() / 1000));
  const body = JSON.stringify({
    type: 'email.received',
    data: {
      email_id: 'received-one',
      from: 'owner@example.com',
      to: ['athena@example.com'],
    },
  });
  const http = vi
    .fn()
    .mockResolvedValueOnce(new Response('', { status: 503 }))
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          text: 'Recovered body',
          authentication: { spf: 'pass', dkim: 'pass', dmarc: 'pass' },
        }),
      ),
    );
  const receiver = new ResendInboundReceiver({ signingSecret: secret, apiKey: 're_test' }, http);
  const result = await receiver.receive({
    rawBody: body,
    now,
    headers: {
      'svix-id': 'event-one',
      'svix-timestamp': timestamp,
      'svix-signature': `v1,${signSvixPayload(secret, 'event-one', timestamp, body)}`,
    },
  });
  expect(result.status === 'received' && result.message.bodyStatus).toBe('metadata-only');
  expect(http).not.toHaveBeenCalled();
  expect(await receiver.retrieve('received-one')).toBeNull();
  expect(await receiver.retrieve('received-one')).toMatchObject({
    text: 'Recovered body',
    authentication: { spf: 'pass', dkim: 'pass', dmarc: 'pass' },
  });
});
