/**
 * Tests for the SMTP (`nodemailer`) mailer transport: the pure env parsing + message
 * mapping, and `SmtpMailer.send` driven through an injected fake transport. The live
 * `transporter.sendMail` is the I/O boundary (`v8`-ignored in src) and is not exercised
 * here — only the behavior around it (mapping, error wrapping, rejection handling).
 */
import { describe, expect, it } from 'vitest';

import type { OutboundMessage } from '../../src/ports/mailer';
import {
  SmtpMailer,
  smtpConfigFromEnv,
  toSendMailOptions,
  type SendMailOptions,
  type SmtpEnv,
  type SmtpMailerConfig,
  type SmtpTransport,
} from '../../src/real/mailer';

/** A fake SMTP transport that records sends and returns a scripted result. */
function fakeTransport(result: { rejected?: readonly unknown[] } | (() => never) = {}): {
  transport: SmtpTransport;
  sent: SendMailOptions[];
} {
  const sent: SendMailOptions[] = [];
  const transport: SmtpTransport = {
    async sendMail(options: SendMailOptions) {
      sent.push(options);
      if (typeof result === 'function') return result();
      return result;
    },
  };
  return { transport, sent };
}

describe('smtpConfigFromEnv', () => {
  it('returns null when SMTP_HOST is absent', () => {
    expect(smtpConfigFromEnv({ MAIL_FROM: 'a@b.com' })).toBeNull();
  });

  it('returns null when MAIL_FROM is absent', () => {
    expect(smtpConfigFromEnv({ SMTP_HOST: 'localhost' })).toBeNull();
  });

  it('treats blank/whitespace values as absent', () => {
    expect(smtpConfigFromEnv({ SMTP_HOST: '   ', MAIL_FROM: 'a@b.com' })).toBeNull();
    expect(smtpConfigFromEnv({ SMTP_HOST: 'localhost', MAIL_FROM: '  ' })).toBeNull();
  });

  it('parses a minimal unauthenticated config and defaults the port to 587', () => {
    const config = smtpConfigFromEnv({ SMTP_HOST: 'localhost', MAIL_FROM: 'Docket <a@b.com>' });
    expect(config).toEqual({
      host: 'localhost',
      port: 587,
      secure: false,
      from: 'Docket <a@b.com>',
    });
    // No auth keys when user/pass are absent.
    expect(config && 'user' in config).toBe(false);
    expect(config && 'pass' in config).toBe(false);
  });

  it('trims values and coerces an explicit port', () => {
    const config = smtpConfigFromEnv({
      SMTP_HOST: '  mail.example.com ',
      SMTP_PORT: ' 2525 ',
      MAIL_FROM: ' a@b.com ',
    });
    expect(config?.host).toBe('mail.example.com');
    expect(config?.port).toBe(2525);
    expect(config?.from).toBe('a@b.com');
  });

  it('defaults secure to true on port 465 and false otherwise', () => {
    expect(smtpConfigFromEnv({ SMTP_HOST: 'h', SMTP_PORT: '465', MAIL_FROM: 'f@x' })?.secure).toBe(
      true,
    );
    expect(smtpConfigFromEnv({ SMTP_HOST: 'h', SMTP_PORT: '587', MAIL_FROM: 'f@x' })?.secure).toBe(
      false,
    );
  });

  it('honors an explicit SMTP_SECURE over the port default (both directions)', () => {
    expect(
      smtpConfigFromEnv({
        SMTP_HOST: 'h',
        SMTP_PORT: '465',
        SMTP_SECURE: 'false',
        MAIL_FROM: 'f@x',
      })?.secure,
    ).toBe(false);
    expect(
      smtpConfigFromEnv({ SMTP_HOST: 'h', SMTP_PORT: '587', SMTP_SECURE: 'TRUE', MAIL_FROM: 'f@x' })
        ?.secure,
    ).toBe(true);
  });

  it('includes auth only when both user and pass are present', () => {
    const both = smtpConfigFromEnv({
      SMTP_HOST: 'h',
      MAIL_FROM: 'f@x',
      SMTP_USER: 'u',
      SMTP_PASS: 'p',
    });
    expect(both).toMatchObject({ user: 'u', pass: 'p' });

    const userOnly = smtpConfigFromEnv({ SMTP_HOST: 'h', MAIL_FROM: 'f@x', SMTP_USER: 'u' });
    expect(userOnly && 'pass' in userOnly).toBe(false);
    expect(userOnly).toMatchObject({ user: 'u' });
  });

  it.each([['0'], ['-1'], ['1.5'], ['abc']])(
    'throws when SMTP_PORT is not a positive integer (%s)',
    (raw) => {
      const env: SmtpEnv = { SMTP_HOST: 'h', SMTP_PORT: raw, MAIL_FROM: 'f@x' };
      expect(() => smtpConfigFromEnv(env)).toThrow(/SMTP_PORT must be a positive integer/);
    },
  );
});

describe('toSendMailOptions', () => {
  it('forwards only the body fields that are present (html + text)', () => {
    const message: OutboundMessage = {
      to: 'a@b.com',
      subject: 'Hi',
      html: '<p>hi</p>',
      text: 'hi',
    };
    expect(toSendMailOptions('from@x', message)).toEqual({
      from: 'from@x',
      to: 'a@b.com',
      subject: 'Hi',
      html: '<p>hi</p>',
      text: 'hi',
    });
  });

  it('keeps a text-only message text-only (no html key)', () => {
    const options = toSendMailOptions('from@x', { to: 'a@b.com', subject: 'S', text: 'body' });
    expect('html' in options).toBe(false);
    expect(options.text).toBe('body');
  });

  it('keeps an html-only message html-only (no text key)', () => {
    const options = toSendMailOptions('from@x', { to: 'a@b.com', subject: 'S', html: '<p>x</p>' });
    expect('text' in options).toBe(false);
    expect(options.html).toBe('<p>x</p>');
  });

  it('throws when neither html nor text is set', () => {
    expect(() => toSendMailOptions('from@x', { to: 'a@b.com', subject: 'S' })).toThrow(
      /at least one of `html`\/`text`/,
    );
  });
});

describe('SmtpMailer', () => {
  const config: SmtpMailerConfig = {
    host: 'localhost',
    port: 1025,
    secure: false,
    from: 'Docket <no-reply@docket.dev>',
  };

  it('builds the transport from config via the injected factory once', () => {
    const seen: SmtpMailerConfig[] = [];
    const { transport } = fakeTransport();
    new SmtpMailer(config, (c) => {
      seen.push(c);
      return transport;
    });
    expect(seen).toEqual([config]);
  });

  it('maps the message with the configured from and hands it to the transport', async () => {
    const { transport, sent } = fakeTransport({ rejected: [] });
    const mailer = new SmtpMailer(config, () => transport);
    await mailer.send({ to: 'a@b.com', subject: 'Welcome', html: '<p>hi</p>', text: 'hi' });
    expect(sent).toEqual([
      {
        from: 'Docket <no-reply@docket.dev>',
        to: 'a@b.com',
        subject: 'Welcome',
        html: '<p>hi</p>',
        text: 'hi',
      },
    ]);
  });

  it('throws a clear, secret-free error when the transport throws', async () => {
    const { transport } = fakeTransport(() => {
      throw new Error('ECONNECTION connect refused');
    });
    const mailer = new SmtpMailer(config, () => transport);
    await expect(mailer.send({ to: 'x@y.com', subject: 'S', text: 'b' })).rejects.toThrow(
      /SmtpMailer send to x@y\.com failed: ECONNECTION connect refused/,
    );
  });

  it('preserves the original cause and stringifies a non-Error throw', async () => {
    const { transport } = fakeTransport(() => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw 'boom';
    });
    const mailer = new SmtpMailer(config, () => transport);
    await expect(mailer.send({ to: 'x@y.com', subject: 'S', text: 'b' })).rejects.toThrow(
      /SmtpMailer send to x@y\.com failed: boom/,
    );
  });

  it('throws when the SMTP server rejects every recipient', async () => {
    const { transport } = fakeTransport({ rejected: ['x@y.com'] });
    const mailer = new SmtpMailer(config, () => transport);
    await expect(mailer.send({ to: 'x@y.com', subject: 'S', text: 'b' })).rejects.toThrow(
      /was rejected by the SMTP server/,
    );
  });

  it('resolves when rejected is undefined (server accepted)', async () => {
    const { transport } = fakeTransport({});
    const mailer = new SmtpMailer(config, () => transport);
    await expect(mailer.send({ to: 'a@b.com', subject: 'S', text: 'b' })).resolves.toBeUndefined();
  });
});
