import { describe, expect, it, vi } from 'vitest';
import { retrieveResendAttachment, validateTextAttachment } from '../../src/attachments';

const encoder = new TextEncoder();
describe('inert email attachments', () => {
  it('decodes UTF-8 without executing Markdown or CSV content', () => {
    expect(
      validateTextAttachment(
        'notes.md',
        'text/markdown',
        encoder.encode('# Notes\n<script>bad()</script>'),
      ).text,
    ).toContain('<script>');
    expect(
      validateTextAttachment(
        'data.csv',
        'text/csv',
        encoder.encode('name,value\na,=HYPERLINK("x")'),
      ).text,
    ).toContain('HYPERLINK');
  });
  it('rejects executable names, invalid UTF8, binary controls and oversize', () => {
    expect(() =>
      validateTextAttachment('run.sh', 'text/plain', encoder.encode('echo hi')),
    ).toThrow();
    expect(() =>
      validateTextAttachment('notes.txt', 'text/plain', new Uint8Array([255])),
    ).toThrow();
    expect(() => validateTextAttachment('notes.txt', 'text/plain', new Uint8Array([0]))).toThrow();
    expect(() =>
      validateTextAttachment('notes.txt', 'text/plain', new Uint8Array(65537)),
    ).toThrow();
  });
});
describe('provider controlled retrieval', () => {
  it('rejects attacker hosts without fetching or leaking authorization', async () => {
    const http = vi.fn(async () =>
      Response.json({ id: 'a', size: 3, download_url: 'http://127.0.0.1/secret' }),
    );
    await expect(retrieveResendAttachment({ apiKey: 'secret' }, 'e', 'a', http)).rejects.toThrow();
    expect(http).toHaveBeenCalledTimes(1);
  });
  it('refuses redirects and caps bytes even when content length lies', async () => {
    const http = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          id: 'a',
          size: 3,
          download_url: 'https://inbound-cdn.resend.com/e/attachments/a?signature=x',
        }),
      )
      .mockResolvedValueOnce(new Response(new Uint8Array(65537)));
    await expect(retrieveResendAttachment({ apiKey: 'secret' }, 'e', 'a', http)).rejects.toThrow();
    expect(http.mock.calls[1]?.[1]).toMatchObject({ redirect: 'error' });
    expect(http.mock.calls[1]?.[1]?.headers).toBeUndefined();
  });
  it('fetches only the exact attachment path and checks actual byte size', async () => {
    const http = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          id: 'a',
          size: 3,
          download_url: 'https://inbound-cdn.resend.com/e/attachments/a?signature=x',
        }),
      )
      .mockResolvedValueOnce(new Response('abc'));
    expect(await retrieveResendAttachment({ apiKey: 'secret' }, 'e', 'a', http)).toEqual(
      encoder.encode('abc'),
    );
  });
  it('accepts the live Resend CDN receiving path without forwarding the API credential', async () => {
    const http = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          id: 'a',
          size: 3,
          download_url:
            'https://cdn.resend.app/receiving/e/attachments/a?Expires=123&Signature=example&Key-Pair-Id=example',
        }),
      )
      .mockResolvedValueOnce(new Response('abc'));
    expect(await retrieveResendAttachment({ apiKey: 'secret' }, 'e', 'a', http)).toEqual(
      encoder.encode('abc'),
    );
    expect(http.mock.calls[1]?.[1]).toMatchObject({ redirect: 'error' });
    expect(http.mock.calls[1]?.[1]?.headers).toBeUndefined();
  });
  it.each([
    'https://cdn.resend.app/receiving/other/attachments/a',
    'https://cdn.resend.app/receiving/e/attachments/other',
    'https://cdn.resend.app/e/attachments/a',
    'https://cdn.resend.app.evil.test/receiving/e/attachments/a',
    'https://secret@cdn.resend.app/receiving/e/attachments/a',
    'http://cdn.resend.app/receiving/e/attachments/a',
  ])('rejects unapproved CDN identity or origin: %s', async (download_url) => {
    const http = vi.fn(async () => Response.json({ id: 'a', size: 3, download_url }));
    await expect(retrieveResendAttachment({ apiKey: 'secret' }, 'e', 'a', http)).rejects.toThrow(
      'attachment_invalid_url',
    );
    expect(http).toHaveBeenCalledTimes(1);
  });
});
