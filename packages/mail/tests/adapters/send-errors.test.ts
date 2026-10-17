import { expect, it } from 'vitest';
import { MailSendError } from '../../src/send-error';
import { RealMailer } from '../../src/smtp';

it.each([400, 401, 403, 422])(
  'marks HTTP %s as a confirmed permanent rejection',
  async (status) => {
    const mailer = new RealMailer(
      { endpoint: 'https://mail.example.com', apiKey: 're_test', from: 'sender@example.com' },
      async () => new Response('Never expose this provider body.', { status }),
    );
    await expect(
      mailer.send({ to: 'owner@example.com', subject: 'Test', text: 'Hello' }),
    ).rejects.toMatchObject({ disposition: 'rejected', status });
  },
);
it.each([408, 409, 429, 500, 503])('permits bounded stable-key retry for HTTP %s', (status) => {
  expect(new MailSendError(status).disposition).toBe('retryable');
});
it('does not classify an unreadable accepted response as confirmed rejection', async () => {
  const mailer = new RealMailer(
    { endpoint: 'https://mail.example.com', apiKey: 're_test', from: 'sender@example.com' },
    async () => new Response('Lost receipt', { status: 200 }),
  );
  try {
    await mailer.send({ to: 'owner@example.com', subject: 'Test', text: 'Hello' });
    throw new Error('Expected receipt parsing failure');
  } catch (error) {
    expect(error).not.toBeInstanceOf(MailSendError);
  }
});
